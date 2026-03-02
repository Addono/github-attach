import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  isSessionExpired,
  loadSession,
  saveSession,
  type SessionData,
} from "../../core/session.js";
import { AuthenticationError } from "../../core/types.js";
import { debug, info } from "../output.js";

const execFile = promisify(execFileCallback);

/** Token lifetime when saved from `gh auth token` (90 days). */
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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

  // Authenticate via `gh auth token`
  info("Authenticating via GitHub CLI...");

  let token: string;
  try {
    const { stdout } = await execFile("gh", [
      "auth",
      "token",
      "--hostname",
      "github.com",
    ]);
    token = stdout.trim();
  } catch (err) {
    throw new AuthenticationError(
      `Failed to retrieve GitHub token from 'gh auth token': ${err instanceof Error ? err.message : String(err)}. ` +
        "Ensure you are authenticated with the GitHub CLI ('gh auth login').",
      "AUTH_FAILED",
    );
  }

  if (!token) {
    throw new AuthenticationError(
      "GitHub CLI returned an empty token. Run 'gh auth login' to authenticate.",
      "AUTH_FAILED",
    );
  }

  // Resolve the GitHub username via the API.
  let username: string | undefined;
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (response.ok) {
      const data = (await response.json()) as { login?: string };
      username = data.login ?? undefined;
    }
  } catch {
    // Username is optional – continue without it.
  }

  const session: SessionData = {
    token,
    username,
    expires: Date.now() + TOKEN_TTL_MS,
  };

  saveSession(session, sessionPathOptions);

  console.log(`Successfully authenticated as ${username ?? "unknown user"}`);
  console.log(
    "Session saved. You can now use gh-attach with browser-session strategy.",
  );
}
