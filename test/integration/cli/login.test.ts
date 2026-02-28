import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { unlinkSync, existsSync, readdirSync, statSync, rmdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loginCommand } from "../../../src/cli/commands/login.js";
import { saveSession } from "../../../src/core/session.js";

describe("loginCommand integration tests", () => {
  let testStateDir: string;
  let origStateEnv: string | undefined;
  let origExitCode: number | undefined;

  beforeEach(() => {
    origStateEnv = process.env.GH_ATTACH_STATE_PATH;
    origExitCode = process.exitCode;
    process.exitCode = undefined;

    testStateDir = join(homedir(), `.test-gh-attach-state-${Date.now()}`);
    process.env.GH_ATTACH_STATE_PATH = join(testStateDir, "session.json");
  });

  afterEach(() => {
    // Cleanup
    try {
      const stateFile = process.env.GH_ATTACH_STATE_PATH;
      if (stateFile && existsSync(stateFile)) {
        unlinkSync(stateFile);
      }
      if (existsSync(testStateDir)) {
        const rmDir = (dir: string) => {
          const files = readdirSync(dir);
          for (const file of files) {
            const filePath = join(dir, file);
            if (statSync(filePath).isDirectory()) {
              rmDir(filePath);
            } else {
              unlinkSync(filePath);
            }
          }
          rmdirSync(dir);
        };
        rmDir(testStateDir);
      }
    } catch {
      // Ignore cleanup errors
    }

    if (origStateEnv) {
      process.env.GH_ATTACH_STATE_PATH = origStateEnv;
    } else {
      delete process.env.GH_ATTACH_STATE_PATH;
    }

    process.exitCode = origExitCode;
  });

  it("should check status when no session exists", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await loginCommand({ status: true });

    expect(consoleSpy).toHaveBeenCalledWith("Status: not authenticated");
    expect(process.exitCode).toBe(2);

    consoleSpy.mockRestore();
  });

  it("should check status when session exists and is valid", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create a valid session
    await saveSession({
      username: "testuser",
      expires: Date.now() + 86400000, // 1 day from now
    });

    await loginCommand({ status: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Status: authenticated as testuser",
    );
    consoleSpy.mockRestore();
  });

  it("should honor --state-path over GH_ATTACH_STATE_PATH", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const envPath = join(testStateDir, "env-session.json");
    const flagPath = join(testStateDir, "flag-session.json");
    process.env.GH_ATTACH_STATE_PATH = envPath;

    await saveSession(
      {
        username: "flaguser",
        expires: Date.now() + 86400000,
      },
      { statePath: flagPath },
    );

    await loginCommand({ status: true, statePath: flagPath });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Status: authenticated as flaguser",
    );
    consoleSpy.mockRestore();
  });

  it("should check status when session is expired", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create an expired session
    await saveSession({
      username: "testuser",
      expires: Date.now() - 1000, // 1 second ago
    });

    await loginCommand({ status: true });

    expect(consoleSpy).toHaveBeenCalledWith("Status: session expired");
    expect(process.exitCode).toBe(2);

    consoleSpy.mockRestore();
  });

  it("should attempt interactive login with browser", async () => {
    // Skip this test if Playwright browsers are not installed
    // The interactive login is verified via the console output
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await loginCommand({});
    } catch (err) {
      // Expected: Playwright browser launch may fail in CI environments
      // The important thing is that the login flow was initiated
      if (
        err instanceof Error &&
        !err.message.includes("browserType.launch") &&
        !err.message.includes("Executable doesn't exist")
      ) {
        throw err; // Re-throw unexpected errors
      }
    }

    // Verify the opening message was logged before browser launch attempt
    expect(consoleSpy).toHaveBeenCalledWith(
      "Opening browser for GitHub authentication...",
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "Please log in to GitHub in the browser window that opens.",
    );

    consoleSpy.mockRestore();
  });

  it("should gracefully handle browser launch failures", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // The actual browser launch will fail in CI without browsers installed
    await expect(loginCommand({})).rejects.toThrow();

    // Verify the opening message was logged before browser launch attempt
    expect(consoleSpy).toHaveBeenCalledWith(
      "Opening browser for GitHub authentication...",
    );

    consoleSpy.mockRestore();
  });

  it("should handle session without username", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create a session without username
    await saveSession({
      expires: Date.now() + 86400000,
    });

    await loginCommand({ status: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Status: authenticated (username unknown)",
    );
    consoleSpy.mockRestore();
  });

  it("should persist session state", async () => {
    await saveSession({
      username: "saveduser",
      expires: Date.now() + 86400000,
    });

    const stateFile = process.env.GH_ATTACH_STATE_PATH ?? "";
    expect(existsSync(stateFile)).toBe(true);

    const content = readFileSync(stateFile, "utf-8");
    const session = JSON.parse(content);
    expect(session.username).toBe("saveduser");
  });

  it("should create state directory if it doesn't exist", async () => {
    await saveSession({
      username: "newuser",
    });

    const stateFile = process.env.GH_ATTACH_STATE_PATH ?? "";
    const stateDir = stateFile.substring(0, stateFile.lastIndexOf("/"));

    expect(existsSync(stateDir)).toBe(true);
  });
});
