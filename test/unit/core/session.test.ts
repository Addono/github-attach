import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveSessionPath,
  loadSession,
  saveSession,
  isSessionExpired,
  getSessionCookies,
  getSessionToken,
} from "../../../src/core/session.js";
import type { SessionData } from "../../../src/core/session.js";

describe("session helpers", () => {
  let testDir: string;
  let origStatePath: string | undefined;
  let origXdgState: string | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `gh-attach-session-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    origStatePath = process.env.GH_ATTACH_STATE_PATH;
    origXdgState = process.env.XDG_STATE_HOME;
  });

  afterEach(() => {
    if (origStatePath !== undefined) {
      process.env.GH_ATTACH_STATE_PATH = origStatePath;
    } else {
      delete process.env.GH_ATTACH_STATE_PATH;
    }
    if (origXdgState !== undefined) {
      process.env.XDG_STATE_HOME = origXdgState;
    } else {
      delete process.env.XDG_STATE_HOME;
    }
  });

  describe("resolveSessionPath", () => {
    it("uses explicit statePath option first", () => {
      process.env.GH_ATTACH_STATE_PATH = "/env/path";
      const path = resolveSessionPath({ statePath: "/explicit/path" });
      expect(path).toBe("/explicit/path");
    });

    it("falls back to GH_ATTACH_STATE_PATH env var", () => {
      process.env.GH_ATTACH_STATE_PATH = "/env/path";
      const path = resolveSessionPath();
      expect(path).toBe("/env/path");
    });

    it("falls back to XDG state dir", () => {
      delete process.env.GH_ATTACH_STATE_PATH;
      process.env.XDG_STATE_HOME = "/xdg/state";
      const path = resolveSessionPath();
      expect(path).toBe("/xdg/state/gh-attach/session.json");
    });

    it("defaults to ~/.local/state when no env vars set", () => {
      delete process.env.GH_ATTACH_STATE_PATH;
      delete process.env.XDG_STATE_HOME;
      const path = resolveSessionPath();
      expect(path).toContain(".local/state/gh-attach/session.json");
    });
  });

  describe("loadSession", () => {
    it("returns null when file does not exist", () => {
      const session = loadSession({
        statePath: join(testDir, "nonexistent.json"),
      });
      expect(session).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      const path = join(testDir, "bad.json");
      writeFileSync(path, "not-json");
      const session = loadSession({ statePath: path });
      expect(session).toBeNull();
    });

    it("returns parsed session data", () => {
      const path = join(testDir, "session.json");
      const data: SessionData = {
        cookies: "user_session=abc; logged_in=yes",
        username: "testuser",
        expires: Date.now() + 86400000,
      };
      writeFileSync(path, JSON.stringify(data));
      const session = loadSession({ statePath: path });
      expect(session).toEqual(data);
    });
  });

  describe("saveSession", () => {
    it("saves session data and creates parent directories", () => {
      const path = join(testDir, "sub", "dir", "session.json");
      const data: SessionData = {
        cookies: "user_session=abc",
        username: "user",
        expires: Date.now() + 86400000,
      };
      saveSession(data, { statePath: path });
      expect(existsSync(path)).toBe(true);
      const content = JSON.parse(readFileSync(path, "utf8"));
      expect(content.cookies).toBe("user_session=abc");
    });
  });

  describe("isSessionExpired", () => {
    it("returns false when no expiry is set", () => {
      expect(isSessionExpired({ cookies: "abc" })).toBe(false);
    });

    it("returns false when session is not expired", () => {
      expect(
        isSessionExpired({ cookies: "abc", expires: Date.now() + 86400000 }),
      ).toBe(false);
    });

    it("returns true when session is expired", () => {
      expect(
        isSessionExpired({ cookies: "abc", expires: Date.now() - 1000 }),
      ).toBe(true);
    });
  });

  describe("getSessionCookies", () => {
    it("returns null for null session", () => {
      expect(getSessionCookies(null)).toBeNull();
    });

    it("returns null when no cookies are present", () => {
      expect(getSessionCookies({ username: "user" })).toBeNull();
    });

    it("returns null when session is expired", () => {
      expect(
        getSessionCookies({
          cookies: "user_session=abc",
          expires: Date.now() - 1000,
        }),
      ).toBeNull();
    });

    it("returns cookies when session is valid", () => {
      const cookies = getSessionCookies({
        cookies: "user_session=abc",
        expires: Date.now() + 86400000,
      });
      expect(cookies).toBe("user_session=abc");
    });

    it("returns cookies when no expiry is set", () => {
      const cookies = getSessionCookies({ cookies: "user_session=abc" });
      expect(cookies).toBe("user_session=abc");
    });
  });

  describe("getSessionToken", () => {
    it("returns null for null session", () => {
      expect(getSessionToken(null)).toBeNull();
    });

    it("returns null when no token is present", () => {
      expect(getSessionToken({ username: "user" })).toBeNull();
    });

    it("returns null when session is expired", () => {
      expect(
        getSessionToken({
          token: "ghp_abc",
          expires: Date.now() - 1000,
        }),
      ).toBeNull();
    });

    it("returns token when session is valid", () => {
      const token = getSessionToken({
        token: "ghp_abc",
        expires: Date.now() + 86400000,
      });
      expect(token).toBe("ghp_abc");
    });

    it("returns token when no expiry is set", () => {
      const token = getSessionToken({ token: "ghp_abc" });
      expect(token).toBe("ghp_abc");
    });
  });
});
