import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionData } from "../../../../src/core/session.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
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
import { execFile as execFileCb } from "node:child_process";

const execFileMock = vi.mocked(execFileCb) as unknown as ReturnType<
  typeof vi.fn
>;

describe("loginCommand unit tests", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let origExitCode: number | undefined;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ login: "octocat" }), { status: 200 }),
      );
    origExitCode = process.exitCode;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fetchSpy.mockRestore();
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
        token: "ghp_abc",
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
        token: "ghp_abc",
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
        token: "ghp_abc",
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

  describe("interactive gh auth login", () => {
    function setupGhTokenMock(token: string) {
      execFileMock.mockImplementation(
        (
          _cmd: unknown,
          _args: unknown,
          callback: (err: null, result: { stdout: string }) => void,
        ) => {
          callback(null, { stdout: `${token}\n` });
        },
      );
    }

    it("authenticates via gh auth token and saves session", async () => {
      setupGhTokenMock("ghp_testtoken123");

      await loginCommand({});

      expect(saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "ghp_testtoken123",
          username: "octocat",
        }),
        { statePath: undefined },
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "Successfully authenticated as octocat",
      );
    });

    it("handles login when username API call fails", async () => {
      setupGhTokenMock("ghp_testtoken123");
      fetchSpy.mockRejectedValue(new Error("Network error"));

      await loginCommand({});

      expect(saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "ghp_testtoken123",
          username: undefined,
        }),
        { statePath: undefined },
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "Successfully authenticated as unknown user",
      );
    });

    it("throws AuthenticationError when gh auth token fails", async () => {
      execFileMock.mockImplementation(
        (_cmd: unknown, _args: unknown, callback: (err: Error) => void) => {
          callback(new Error("not logged in"));
        },
      );

      await expect(loginCommand({})).rejects.toThrow(
        /Failed to retrieve GitHub token/,
      );
    });

    it("throws AuthenticationError when gh auth token returns empty string", async () => {
      setupGhTokenMock("");

      await expect(loginCommand({})).rejects.toThrow(
        /empty token/,
      );
    });

    it("passes statePath option through to session saver", async () => {
      setupGhTokenMock("ghp_testtoken123");

      await loginCommand({ statePath: "/custom/path" });

      expect(saveSession).toHaveBeenCalledWith(
        expect.objectContaining({ token: "ghp_testtoken123" }),
        { statePath: "/custom/path" },
      );
    });
  });
});
