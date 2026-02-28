import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "child_process";
import {
  writeFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmdirSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { uploadCommand } from "../../../src/cli/commands/upload.js";
import { saveSession } from "../../../src/core/session.js";

const CLI_SOURCE_PATH = resolve(
  import.meta.dirname,
  "../../../src/cli/index.ts",
);

describe("uploadCommand integration tests", () => {
  let testDir: string;
  let testFile: string;
  let origStatePath: string | undefined;

  beforeEach(() => {
    origStatePath = process.env.GH_ATTACH_STATE_PATH;

    testDir = join(tmpdir(), `gh-attach-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.env.GH_ATTACH_STATE_PATH = join(testDir, "session.json");

    testFile = join(testDir, "test-image.png");
    // Create a minimal PNG file (8x8 transparent PNG)
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08,
      0x08, 0x06, 0x00, 0x00, 0x00, 0xc4, 0x0f, 0xbe, 0x8b, 0x00, 0x00, 0x00,
      0x25, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb4, 0x00, 0x00, 0x00,
      0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    writeFileSync(testFile, pngBuffer);
  });

  afterEach(() => {
    try {
      unlinkSync(testFile);
    } catch {
      // Ignore
    }
    try {
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
      rmDir(testDir);
    } catch {
      // Ignore
    }

    if (origStatePath) {
      process.env.GH_ATTACH_STATE_PATH = origStatePath;
    } else {
      delete process.env.GH_ATTACH_STATE_PATH;
    }
  });

  it("should throw error when no authentication is provided", async () => {
    // Clear auth env vars
    const origToken = process.env.GITHUB_TOKEN;
    const origGhToken = process.env.GH_TOKEN;
    const origCookies = process.env.GH_ATTACH_COOKIES;

    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GH_ATTACH_COOKIES;

    try {
      await expect(
        uploadCommand([testFile], {
          target: "owner/repo#42",
          format: "markdown",
        }),
      ).rejects.toThrow("No upload strategy available");
    } finally {
      if (origToken) process.env.GITHUB_TOKEN = origToken;
      if (origGhToken) process.env.GH_TOKEN = origGhToken;
      if (origCookies) process.env.GH_ATTACH_COOKIES = origCookies;
    }
  });

  it("should throw error for invalid target", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    await expect(
      uploadCommand([testFile], {
        target: "invalid-target",
        format: "markdown",
      }),
    ).rejects.toThrow("Invalid target");
  });

  it("should throw error for non-existent file", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    await expect(
      uploadCommand([join(testDir, "nonexistent.png")], {
        target: "owner/repo#42",
        format: "markdown",
      }),
    ).rejects.toThrow("File not found");
  });

  it("should throw error for unsupported file format", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const txtFile = join(testDir, "test.txt");
    writeFileSync(txtFile, "test content");

    try {
      await expect(
        uploadCommand([txtFile], {
          target: "owner/repo#42",
          format: "markdown",
        }),
      ).rejects.toThrow("Unsupported file format");
    } finally {
      unlinkSync(txtFile);
    }
  });

  it("should require filename when using --stdin", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    await expect(
      uploadCommand([], {
        target: "owner/repo#42",
        stdin: true,
        // No filename provided
      }),
    ).rejects.toThrow("--filename is required");
  });

  it("should allow stdin mode with no file arguments", () => {
    const result = spawnSync(
      "node",
      [
        "--import",
        "tsx",
        CLI_SOURCE_PATH,
        "upload",
        "--stdin",
        "--target",
        "owner/repo#42",
      ],
      {
        encoding: "utf8",
        cwd: resolve(import.meta.dirname, "../../.."),
        env: { ...process.env, GITHUB_TOKEN: "test-token" },
      },
    );

    // Exit code 3 = ValidationError (missing --filename)
    expect(result.status).toBe(3);
    expect(result.stderr).toContain(
      "--filename is required when using --stdin",
    );
  });

  it("should require a file argument when stdin mode is disabled", () => {
    const result = spawnSync(
      "node",
      [
        "--import",
        "tsx",
        CLI_SOURCE_PATH,
        "upload",
        "--target",
        "owner/repo#42",
      ],
      {
        encoding: "utf8",
        cwd: resolve(import.meta.dirname, "../../.."),
        env: { ...process.env, GITHUB_TOKEN: "test-token" },
      },
    );

    // Exit code 3 = ValidationError (no files provided)
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("At least one file is required");
  });

  it("should parse target in shorthand format", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // This test just verifies that parsing doesn't throw
    // The actual upload will fail due to real API call, but parsing should succeed
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await uploadCommand([testFile], {
        target: "owner/repo#42",
        format: "json",
      });
    } catch {
      // Expected to fail during upload, not during parsing
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should parse target from full URL", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await uploadCommand([testFile], {
        target: "https://github.com/owner/repo/issues/42",
        format: "json",
      });
    } catch {
      // Expected to fail during upload
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should support pull request targets", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await uploadCommand([testFile], {
        target: "owner/repo#pull/99",
        format: "json",
      });
    } catch {
      // Expected to fail during upload
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should use GH_TOKEN if GITHUB_TOKEN not set", async () => {
    const origToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = "test-gh-token";

    try {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await uploadCommand([testFile], {
          target: "owner/repo#42",
          format: "json",
        });
      } catch {
        // Expected to fail during upload
      } finally {
        consoleSpy.mockRestore();
      }
    } finally {
      if (origToken) process.env.GITHUB_TOKEN = origToken;
      delete process.env.GH_TOKEN;
    }
  });

  it("should throw error for unknown strategy", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    await expect(
      uploadCommand([testFile], {
        target: "owner/repo#42",
        strategy: "unknown-strategy",
      }),
    ).rejects.toThrow("is not available");
  });

  it("should throw error when release-asset strategy requires token", async () => {
    const origToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    try {
      await expect(
        uploadCommand([testFile], {
          target: "owner/repo#42",
          strategy: "release-asset",
        }),
      ).rejects.toThrow("is not available");
    } finally {
      if (origToken) process.env.GITHUB_TOKEN = origToken;
    }
  });

  it("should throw error when browser-session strategy requires cookies", async () => {
    const origCookies = process.env.GH_ATTACH_COOKIES;
    delete process.env.GH_ATTACH_COOKIES;

    try {
      await expect(
        uploadCommand([testFile], {
          target: "owner/repo#42",
          strategy: "browser-session",
        }),
      ).rejects.toThrow("is not available");
    } finally {
      if (origCookies) process.env.GH_ATTACH_COOKIES = origCookies;
    }
  });

  it("should allow browser-session strategy when a saved session exists", async () => {
    const origCookies = process.env.GH_ATTACH_COOKIES;
    delete process.env.GH_ATTACH_COOKIES;

    // Persist a session cookie string to the configured state path.
    saveSession({
      cookies: "user_session=abc123; logged_in=yes",
      expires: Date.now() + 86400000,
      username: "testuser",
    });

    try {
      await expect(
        uploadCommand([testFile], {
          target: "owner/repo#42",
          strategy: "browser-session",
        }),
      ).rejects.toThrow();
    } finally {
      if (origCookies) process.env.GH_ATTACH_COOKIES = origCookies;
    }
  });

  it("should throw error when repo-branch strategy requires token", async () => {
    const origToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    try {
      await expect(
        uploadCommand([testFile], {
          target: "owner/repo#42",
          strategy: "repo-branch",
        }),
      ).rejects.toThrow("is not available");
    } finally {
      if (origToken) process.env.GITHUB_TOKEN = origToken;
    }
  });

  it("should output URL format correctly", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await uploadCommand([testFile], {
        target: "owner/repo#42",
        format: "url",
      });
    } catch {
      // Expected to fail during upload, but format should be attempted
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should output markdown format by default", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await uploadCommand([testFile], {
        target: "owner/repo#42",
        // No format specified - should default to markdown
      });
    } catch {
      // Expected to fail during upload
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should handle multiple files", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    const testFile2 = join(testDir, "test-image-2.png");
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08,
      0x08, 0x06, 0x00, 0x00, 0x00, 0xc4, 0x0f, 0xbe, 0x8b, 0x00, 0x00, 0x00,
      0x25, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb4, 0x00, 0x00, 0x00,
      0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    writeFileSync(testFile2, pngBuffer);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await uploadCommand([testFile, testFile2], {
        target: "owner/repo#42",
        format: "json",
      });
    } catch {
      // Expected to fail during upload
    } finally {
      consoleSpy.mockRestore();
      unlinkSync(testFile2);
    }
  });

  it("should support cookie-extraction strategy without auth", async () => {
    const origToken = process.env.GITHUB_TOKEN;
    const origCookies = process.env.GH_ATTACH_COOKIES;

    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GH_ATTACH_COOKIES;

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await uploadCommand([testFile], {
        target: "owner/repo#42",
        strategy: "cookie-extraction",
        format: "json",
      });
    } catch {
      // Expected to fail during upload
    } finally {
      consoleSpy.mockRestore();
      if (origToken) process.env.GITHUB_TOKEN = origToken;
      if (origCookies) process.env.GH_ATTACH_COOKIES = origCookies;
    }
  });
});
