import { chromium } from "playwright";
import { execFileSync } from "child_process";
import {
  isSessionExpired,
  loadSession,
  saveSession,
  type SessionData,
} from "../../core/session.js";
import { AuthenticationError } from "../../core/types.js";
import { debug, info } from "../output.js";

/**
 * Timeout in milliseconds for the login flow (5 minutes).
 */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface LoginOptions {
  status?: boolean;
  /** Overrides where the session is read/written for this invocation. */
  statePath?: string;
}

/**
 * Login command implementation.
 */
export async function loginCommand(options: LoginOptions) {
  debug(
    `Running login command (status=${options.status ? "true" : "false"}, statePath=${options.statePath ?? "(default)"})`,
  );

  const sessionPathOptions = { statePath: options.statePath };

  if (options.status) {
    const session = loadSession(sessionPathOptions);
    if (!session) {
      console.log("Status: not authenticated");
      process.exitCode = 2;
      return;
    }

    if (isSessionExpired(session)) {
      console.log("Status: session expired");
      process.exitCode = 2;
      return;
    }

    if (session.username) {
      console.log(`Status: authenticated as ${session.username}`);
    } else {
      console.log("Status: authenticated (username unknown)");
    }

    return;
  }

  // Interactive browser login using Playwright
  info("Opening browser for GitHub authentication...");
  info("Please log in to GitHub in the browser window that opens.");

  // Ensure Playwright browsers are installed before attempting to launch
  const browserPath = chromium.executablePath();
  if (!browserPath || !(await fileExists(browserPath))) {
    info("Playwright browsers not found. Installing Chromium...");
    try {
      execFileSync("npx", ["playwright", "install", "chromium"], {
        stdio: "inherit",
      });
    } catch {
      throw new AuthenticationError(
        "Failed to install Playwright browsers. Run 'npx playwright install chromium' manually.",
        "PLAYWRIGHT_INSTALL_FAILED",
      );
    }
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto("https://github.com/login");

    // Wait for successful login by watching for the user avatar.
    await page.waitForSelector('img[alt*="@"]', {
      timeout: LOGIN_TIMEOUT_MS,
    });

    const usernameElement = page.locator('meta[name="user-login"]');
    const username = await usernameElement
      .getAttribute("content")
      .catch(() => null);

    const allCookies = await context.cookies("https://github.com");
    const relevantCookies = allCookies.filter(
      (c) =>
        c.name === "user_session" ||
        c.name === "__Host-user_session_same_site" ||
        c.name === "logged_in" ||
        c.name === "_gh_sess",
    );

    if (relevantCookies.length === 0) {
      throw new AuthenticationError(
        "Failed to extract GitHub session cookies",
        "INVALID_SESSION",
      );
    }

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

    const session: SessionData = {
      cookies: cookieString,
      username: username ?? undefined,
      expires,
    };

    saveSession(session, sessionPathOptions);

    console.log(`Successfully authenticated as ${username ?? "unknown user"}`);
    console.log(
      "Session saved. You can now use gh-attach with browser-session strategy.",
    );
  } finally {
    await browser.close();
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { access } = await import("fs/promises");
    await access(path);
    return true;
  } catch {
    return false;
  }
}
