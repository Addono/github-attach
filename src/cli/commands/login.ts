import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { chromium } from "playwright";

interface SessionData {
  cookies?: string;
  username?: string;
  expires?: number;
}

/**
 * Timeout in milliseconds for the login flow (5 minutes).
 */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Get the session state file path (XDG compliant).
 */
function getStatePath(): string {
  const envPath = process.env.GH_ATTACH_STATE_PATH;
  if (envPath) {
    return envPath;
  }
  const stateDir =
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(stateDir, "gh-attach", "session.json");
}

/**
 * Load session data from file.
 */
function loadSession(): SessionData | null {
  const path = getStatePath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as SessionData;
  } catch {
    return null;
  }
}

/**
 * Save session data to file.
 * @internal
 */
export function saveSession(session: SessionData): void {
  const path = getStatePath();
  const dir = path.substring(0, path.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(session, null, 2), "utf-8");
}

interface LoginOptions {
  status?: boolean;
  statePath?: string;
}

/**
 * Login command implementation.
 */
export async function loginCommand(options: LoginOptions) {
  if (options.status) {
    // Check current auth status
    const session = loadSession();
    if (!session) {
      console.log("Status: not authenticated");
      process.exit(1);
    }

    // Check if session is expired
    if (session.expires && session.expires < Date.now()) {
      console.log("Status: session expired");
      process.exit(1);
    }

    if (session.username) {
      console.log(`Status: authenticated as ${session.username}`);
    } else {
      console.log("Status: session found but username not set");
    }
  } else {
    // Interactive browser login using Playwright
    console.log("Opening browser for GitHub authentication...");
    console.log("Please log in to GitHub in the browser window that opens.");

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Navigate to GitHub login
      await page.goto("https://github.com/login");

      // Wait for successful login by watching for the user avatar or profile menu
      // This indicates the user has completed authentication
      await page.waitForSelector('img[alt*="@"]', {
        timeout: LOGIN_TIMEOUT_MS,
      });

      // Get the username from the page using Playwright's locator
      const usernameElement = page.locator('meta[name="user-login"]');
      const username = await usernameElement
        .getAttribute("content")
        .catch(() => null);

      // Extract relevant cookies (user_session, __Host-user_session_same_site, logged_in)
      const allCookies = await context.cookies("https://github.com");
      const relevantCookies = allCookies.filter(
        (c) =>
          c.name === "user_session" ||
          c.name === "__Host-user_session_same_site" ||
          c.name === "logged_in" ||
          c.name === "_gh_sess",
      );

      if (relevantCookies.length === 0) {
        throw new Error("Failed to extract GitHub session cookies");
      }

      // Format cookies as a cookie header string
      const cookieString = relevantCookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");

      // Calculate expiry (use the earliest expiry or 30 days from now)
      const minExpiry = relevantCookies.reduce((min, c) => {
        const exp = c.expires && c.expires > 0 ? c.expires * 1000 : Infinity;
        return Math.min(min, exp);
      }, Infinity);
      const expires =
        minExpiry === Infinity
          ? Date.now() + 30 * 24 * 60 * 60 * 1000
          : minExpiry;

      // Save the session
      const session: SessionData = {
        cookies: cookieString,
        username: username ?? undefined,
        expires,
      };
      saveSession(session);

      console.log(
        `Successfully authenticated as ${username ?? "unknown user"}`,
      );
      console.log(
        "Session saved. You can now use gh-attach with browser-session strategy.",
      );
    } finally {
      await browser.close();
    }
  }
}
