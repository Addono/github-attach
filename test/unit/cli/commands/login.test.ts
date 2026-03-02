import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionData } from "../../../../src/core/session.js";

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(),
    executablePath: vi.fn().mockReturnValue("/bin/sh"),
  },
}));

vi.mock("../../../../src/core/session.js", () => ({
  loadSession: vi.fn(),
  isSessionExpired: vi.fn(),
  saveSession: vi.fn(),
}));

vi.mock("../../../../src/cli/output.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  globalOptions: { verbose: false, quiet: false, noColor: false },
}));

import { loginCommand } from "../../../../src/cli/commands/login.js";
import {
  loadSession,
  isSessionExpired,
  saveSession,
} from "../../../../src/core/session.js";
import { chromium } from "playwright";

describe("loginCommand unit tests", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let origExitCode: number | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    origExitCode = process.exitCode;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = origExitCode;
  });

  describe("--status flag", () => {
    it("reports 'not authenticated' when no session exists", async () => {
      vi.mocked(loadSession).mockReturnValue(null);

      await loginCommand({ status: true });

      expect(consoleSpy).toHaveBeenCalledWith("Status: not authenticated");
      expect(process.exitCode).toBe(2);
    });

    it("reports 'session expired' when session is expired", async () => {
      const expired: SessionData = {
        cookies: "user_session=abc",
        expires: Date.now() - 1000,
      };
      vi.mocked(loadSession).mockReturnValue(expired);
      vi.mocked(isSessionExpired).mockReturnValue(true);

      await loginCommand({ status: true });

      expect(consoleSpy).toHaveBeenCalledWith("Status: session expired");
      expect(process.exitCode).toBe(2);
    });

    it("reports authenticated with username when available", async () => {
      const session: SessionData = {
        cookies: "user_session=abc",
        username: "octocat",
        expires: Date.now() + 100000,
      };
      vi.mocked(loadSession).mockReturnValue(session);
      vi.mocked(isSessionExpired).mockReturnValue(false);

      await loginCommand({ status: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        "Status: authenticated as octocat",
      );
      expect(process.exitCode).not.toBe(2);
    });

    it("reports authenticated without username when username is missing", async () => {
      const session: SessionData = {
        cookies: "user_session=abc",
        expires: Date.now() + 100000,
      };
      vi.mocked(loadSession).mockReturnValue(session);
      vi.mocked(isSessionExpired).mockReturnValue(false);

      await loginCommand({ status: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        "Status: authenticated (username unknown)",
      );
    });

    it("passes statePath option through to session loader", async () => {
      vi.mocked(loadSession).mockReturnValue(null);

      await loginCommand({ status: true, statePath: "/custom/path" });

      expect(loadSession).toHaveBeenCalledWith({
        statePath: "/custom/path",
      });
    });
  });

  describe("interactive browser login", () => {
    function setupBrowserMock(
      cookies: Array<{ name: string; value: string; expires?: number }>,
      username: string | null = "octocat",
    ) {
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue(username),
        }),
      };
      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        cookies: vi.fn().mockResolvedValue(cookies),
      };
      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(chromium.launch).mockResolvedValue(
        mockBrowser as ReturnType<typeof chromium.launch> extends Promise<
          infer T
        >
          ? T
          : never,
      );
      return { mockBrowser, mockContext, mockPage };
    }

    it("launches browser and extracts cookies on successful login", async () => {
      const cookies = [
        {
          name: "user_session",
          value: "session123",
          expires: (Date.now() + 86400000) / 1000,
        },
        { name: "logged_in", value: "yes", expires: -1 },
      ];
      const { mockBrowser } = setupBrowserMock(cookies, "testuser");

      await loginCommand({});

      expect(chromium.launch).toHaveBeenCalledWith({ headless: false });
      expect(saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cookies: "user_session=session123; logged_in=yes",
          username: "testuser",
        }),
        { statePath: undefined },
      );
      expect(mockBrowser.close).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        "Successfully authenticated as testuser",
      );
    });

    it("handles login when username extraction fails", async () => {
      const cookies = [
        { name: "user_session", value: "session123", expires: -1 },
      ];
      setupBrowserMock(cookies, null);

      await loginCommand({});

      expect(saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cookies: "user_session=session123",
          username: undefined,
        }),
        { statePath: undefined },
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "Successfully authenticated as unknown user",
      );
    });

    it("throws AuthenticationError when no relevant cookies are found", async () => {
      const cookies = [{ name: "unrelated", value: "cookie" }];
      setupBrowserMock(cookies);

      await expect(loginCommand({})).rejects.toThrow(
        "Failed to extract GitHub session cookies",
      );
    });

    it("closes browser even when login fails", async () => {
      const mockPage = {
        goto: vi.fn().mockRejectedValue(new Error("Network error")),
        waitForSelector: vi.fn(),
        locator: vi.fn(),
      };
      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        cookies: vi.fn(),
      };
      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(chromium.launch).mockResolvedValue(
        mockBrowser as ReturnType<typeof chromium.launch> extends Promise<
          infer T
        >
          ? T
          : never,
      );

      await expect(loginCommand({})).rejects.toThrow("Network error");
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("filters out non-GitHub cookies from extracted set", async () => {
      const cookies = [
        { name: "user_session", value: "s1", expires: -1 },
        { name: "_tracking", value: "track", expires: -1 },
        { name: "__Host-user_session_same_site", value: "s2", expires: -1 },
        { name: "_gh_sess", value: "s3", expires: -1 },
      ];
      setupBrowserMock(cookies);

      await loginCommand({});

      expect(saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cookies:
            "user_session=s1; __Host-user_session_same_site=s2; _gh_sess=s3",
        }),
        { statePath: undefined },
      );
    });
  });
});
