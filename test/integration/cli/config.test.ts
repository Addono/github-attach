import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  unlinkSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  rmdirSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { configCommand } from "../../../src/cli/commands/config.js";

describe("configCommand integration tests", () => {
  let testConfigDir: string;
  let origConfigEnv: string | undefined;

  beforeEach(() => {
    origConfigEnv = process.env.GH_ATTACH_CONFIG;
    testConfigDir = join(homedir(), `.test-gh-attach-config-${Date.now()}`);
    process.env.GH_ATTACH_CONFIG = join(testConfigDir, "config.json");
  });

  afterEach(() => {
    // Cleanup
    try {
      const configFile = process.env.GH_ATTACH_CONFIG;
      if (configFile && existsSync(configFile)) {
        unlinkSync(configFile);
      }
      if (existsSync(testConfigDir)) {
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
        rmDir(testConfigDir);
      }
    } catch {
      // Ignore cleanup errors
    }

    if (origConfigEnv) {
      process.env.GH_ATTACH_CONFIG = origConfigEnv;
    } else {
      delete process.env.GH_ATTACH_CONFIG;
    }
  });

  it("should list empty config", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await configCommand("list");

    expect(consoleSpy).toHaveBeenCalledWith("No configuration set");
    consoleSpy.mockRestore();
  });

  it("should set a configuration value", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await configCommand("set", "test-key", "test-value");

    expect(consoleSpy).toHaveBeenCalledWith("test-key set to test-value");
    consoleSpy.mockRestore();
  });

  it("should get a configuration value", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await configCommand("set", "test-key", "test-value");
    consoleSpy.mockClear();

    await configCommand("get", "test-key");

    expect(consoleSpy).toHaveBeenCalledWith("test-value");
    consoleSpy.mockRestore();
  });

  it("should list all configuration values", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await configCommand("set", "key1", "value1");
    await configCommand("set", "key2", "value2");
    consoleSpy.mockClear();

    await configCommand("list");

    expect(consoleSpy).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith("key1: value1");
    expect(consoleSpy).toHaveBeenCalledWith("key2: value2");
    consoleSpy.mockRestore();
  });

  it("should handle strategy-order as comma-separated array", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await configCommand(
      "set",
      "strategy-order",
      "release-asset,browser-session",
    );
    consoleSpy.mockClear();

    await configCommand("get", "strategy-order");

    expect(consoleSpy).toHaveBeenCalledWith("release-asset, browser-session");
    consoleSpy.mockRestore();
  });

  it("should report non-existent key", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await configCommand("get", "nonexistent-key");

    expect(consoleSpy).toHaveBeenCalledWith("nonexistent-key is not set");
    consoleSpy.mockRestore();
  });

  it("should throw error for set without key", async () => {
    await expect(configCommand("set", undefined, "value")).rejects.toThrow(
      "Key and value are required",
    );
  });

  it("should throw error for set without value", async () => {
    await expect(configCommand("set", "key", undefined)).rejects.toThrow(
      "Key and value are required",
    );
  });

  it("should throw error for get without key", async () => {
    await expect(configCommand("get", undefined)).rejects.toThrow(
      "Key is required",
    );
  });

  it("should throw error for unknown action", async () => {
    await expect(
      configCommand("unknown-action", "key", "value"),
    ).rejects.toThrow("Unknown config action");
  });

  it("should persist configuration across calls", async () => {
    await configCommand("set", "persistent-key", "persistent-value");

    const configFile = process.env.GH_ATTACH_CONFIG ?? "";
    expect(existsSync(configFile)).toBe(true);

    const content = readFileSync(configFile, "utf-8");
    const config = JSON.parse(content);
    expect(config["persistent-key"]).toBe("persistent-value");
  });

  it("should create config directory if it doesn't exist", async () => {
    const configFile = process.env.GH_ATTACH_CONFIG ?? "";
    const configDir = configFile.substring(0, configFile.lastIndexOf("/"));

    await configCommand("set", "new-key", "new-value");

    expect(existsSync(configDir)).toBe(true);
  });
});
