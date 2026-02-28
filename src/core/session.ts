/**
 * Session state helpers for gh-attach.
 *
 * The CLI and MCP server can persist a browser-session cookie string to disk so
 * future runs can authenticate without requiring env vars.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Serialized session data stored on disk.
 */
export interface SessionData {
  /** Cookie header string (e.g. "user_session=...; logged_in=yes") */
  cookies?: string;
  /** GitHub username associated with the session, if available */
  username?: string;
  /** Expiry time as epoch milliseconds */
  expires?: number;
}

/**
 * Options that influence where session state is read/written.
 */
export interface SessionPathOptions {
  /** Explicit session file path (highest precedence). */
  statePath?: string;
}

/**
 * Resolve the session state file path.
 *
 * Precedence:
 * 1) `options.statePath`
 * 2) `GH_ATTACH_STATE_PATH`
 * 3) XDG state dir (`XDG_STATE_HOME` or `~/.local/state`)
 */
export function resolveSessionPath(options: SessionPathOptions = {}): string {
  if (options.statePath) {
    return options.statePath;
  }

  const envPath = process.env.GH_ATTACH_STATE_PATH;
  if (envPath) {
    return envPath;
  }

  const stateDir =
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(stateDir, "gh-attach", "session.json");
}

/**
 * Load a persisted session from disk.
 *
 * Returns null when the file does not exist or cannot be parsed.
 */
export function loadSession(
  options: SessionPathOptions = {},
): SessionData | null {
  const path = resolveSessionPath(options);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, "utf8");
    return JSON.parse(content) as SessionData;
  } catch {
    return null;
  }
}

/**
 * Persist session state to disk (creating parent directories as needed).
 */
export function saveSession(
  session: SessionData,
  options: SessionPathOptions = {},
): void {
  const path = resolveSessionPath(options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(session, null, 2), "utf8");
}

/**
 * Returns true if the session is expired.
 */
export function isSessionExpired(
  session: SessionData,
  nowMs: number = Date.now(),
): boolean {
  return typeof session.expires === "number" && session.expires < nowMs;
}

/**
 * Get a usable cookie header string from a session, or null if unavailable/expired.
 */
export function getSessionCookies(
  session: SessionData | null,
  nowMs: number = Date.now(),
): string | null {
  if (!session) {
    return null;
  }
  if (!session.cookies) {
    return null;
  }
  if (isSessionExpired(session, nowMs)) {
    return null;
  }
  return session.cookies;
}
