import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";

// Mock dependencies BEFORE importing the module under test
vi.mock("fs");
vi.mock("os");

// Create hoisted mock for execFile
const { execFileMock } = vi.hoisted(() => {
  return { execFileMock: vi.fn() };
});

// Mock child_process module
vi.mock("child_process", async () => {
  return {
    execFile: execFileMock,
    default: {
      execFile: execFileMock,
    },
  };
});

// Mock browserSession strategy
const { mockBrowserSessionUpload } = vi.hoisted(() => {
  return { mockBrowserSessionUpload: vi.fn() };
});

vi.mock("../../../../src/core/strategies/browserSession.js", () => {
  return {
    createBrowserSessionStrategy: vi.fn(() => ({
      name: "browser-session",
      isAvailable: async () => true,
      upload: mockBrowserSessionUpload.mockResolvedValue(
        "https://github.com/test/asset",
      ),
    })),
  };
});

// Import module AFTER mocking
import {
  createCookieExtractionStrategy,
  cookieExtractionInternals,
} from "../../../../src/core/strategies/cookieExtraction.js";
import {
  UploadError,
  AuthenticationError,
} from "../../../../src/core/types.js";

// Helper to mock platform
const originalPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, "platform", {
    value: platform,
  });
};

const mockTarget = {
  owner: "testowner",
  repo: "testrepo",
  type: "issue" as const,
  number: 42,
};

describe("Cookie Extraction Strategy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue("/home/user");
    vi.mocked(os.tmpdir).mockReturnValue("/tmp");

    // Default implementation for execFile mock to simulate success
    execFileMock.mockImplementation(
      (
        file: string,
        args:
          | string[]
          | ((err: Error | null, result: { stdout: string }) => void),
        cb?: (err: Error | null, result: { stdout: string }) => void,
      ) => {
        const callback = typeof args === "function" ? args : cb;
        if (callback) {
          callback(null, { stdout: "" });
        }
        return {} as Record<string, unknown>;
      },
    );
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  describe("findCookieSources", () => {
    it("finds Chrome cookies on Linux", () => {
      setPlatform("linux");
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return (p as string).includes(".config/google-chrome");
      });

      const sources = cookieExtractionInternals.findCookieSources();
      expect(sources).toContainEqual(
        expect.objectContaining({
          browser: "chrome",
          path: "/home/user/.config/google-chrome/Default/Cookies",
          hostColumn: "host_key",
        }),
      );
    });

    it("finds Chrome cookies on macOS", () => {
      setPlatform("darwin");
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return (p as string).includes(
          "Library/Application Support/Google/Chrome",
        );
      });

      const sources = cookieExtractionInternals.findCookieSources();
      expect(sources).toContainEqual(
        expect.objectContaining({
          browser: "chrome",
          path: "/home/user/Library/Application Support/Google/Chrome/Default/Cookies",
          hostColumn: "host_key",
        }),
      );
    });

    it("finds Chrome cookies on Windows", () => {
      setPlatform("win32");
      process.env.LOCALAPPDATA = "C:\\Users\\User\\AppData\\Local";
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return (p as string).includes("Google/Chrome/User Data");
      });

      const sources = cookieExtractionInternals.findCookieSources();

      const foundSource = sources.find(
        (s) => s.browser === "chrome" && s.path.includes("Google"),
      );
      expect(foundSource).toBeDefined();
      expect(foundSource?.hostColumn).toBe("host_key");

      delete process.env.LOCALAPPDATA;
    });
  });

  describe("Firefox profile parsing", () => {
    it("parses profiles.ini correctly", () => {
      const iniContent = `
[Profile0]
Name=default
IsRelative=1
Path=Profiles/k2345678.default
Default=1

[Profile1]
Name=dev-edition
IsRelative=0
Path=/opt/firefox/dev
`;
      vi.mocked(fs.readFileSync).mockReturnValue(iniContent);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const paths = cookieExtractionInternals.parseFirefoxProfilesIni(
        "/home/user/.mozilla/firefox/profiles.ini",
        "/home/user/.mozilla/firefox",
      );

      // Normalize paths for comparison
      const normalizedPaths = paths.map((p) => p.replace(/\\/g, "/"));

      expect(
        normalizedPaths.some((p) =>
          p.includes("Profiles/k2345678.default/cookies.sqlite"),
        ),
      ).toBe(true);
      expect(
        normalizedPaths.some((p) =>
          p.includes("/opt/firefox/dev/cookies.sqlite"),
        ),
      ).toBe(true);
    });

    it("falls back to directory scanning if profiles.ini missing", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = p as string;
        if (pathStr.endsWith("profiles.ini")) return false;
        if (pathStr.endsWith("cookies.sqlite")) return true;
        return true; // base dir exists
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        "k2345678.default",
        "random.profile",
      ] as unknown as fs.Dirent[]);

      const paths = cookieExtractionInternals.findFirefoxCookiePaths(
        "/home/user/.mozilla/firefox",
      );

      expect(paths.some((p) => p.includes("k2345678.default"))).toBe(true);
      expect(paths.some((p) => p.includes("random.profile"))).toBe(true);
    });
  });

  describe("buildCookieHeader", () => {
    it("constructs cookie string from raw rows", () => {
      const raw = [
        "user_session\tuser123",
        "logged_in\tyes",
        "_gh_sess\tsess123",
        "other_cookie\tvalue123",
      ].join("\n");

      const header = cookieExtractionInternals.buildCookieHeader(raw);
      expect(header).toContain("user_session=user123");
      expect(header).toContain("logged_in=yes");
      expect(header).toContain("_gh_sess=sess123");
      expect(header).toContain("other_cookie=value123");
    });

    it("returns null if user_session is missing", () => {
      const raw = `logged_in\tyes`;
      expect(cookieExtractionInternals.buildCookieHeader(raw)).toBeNull();
    });

    it("handles tab in value correctly", () => {
      const raw = ["user_session\tvalid", "complex_cookie\tpart1\tpart2"].join(
        "\n",
      );
      const header = cookieExtractionInternals.buildCookieHeader(raw);
      expect(header).toContain("complex_cookie=part1\tpart2");
    });
  });

  describe("extractCookiesFromDatabase", () => {
    it("executes sqlite3 command and parses output", async () => {
      const source = {
        browser: "chrome" as const,
        path: "/path/to/cookies",
        hostColumn: "host_key" as const,
      };

      vi.mocked(fs.copyFileSync).mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});
      // Allow unlinkSync to be called by mocking existsSync to return true for temp files too
      vi.mocked(fs.existsSync).mockImplementation((_p) => {
        return true;
      });

      // Update mock implementation for this test
      execFileMock.mockImplementation(
        (
          file: string,
          args:
            | string[]
            | ((err: Error | null, result: { stdout: string }) => void),
          cb?: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          const callback = typeof args === "function" ? args : cb;
          callback?.(null, { stdout: "user_session\tvalid_session\n" });
          return {} as Record<string, unknown>;
        },
      );

      const result =
        await cookieExtractionInternals.extractCookiesFromDatabase(source);
      expect(result).toBe("user_session=valid_session");
      expect(fs.copyFileSync).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(execFileMock).toHaveBeenCalledWith(
        "sqlite3",
        expect.arrayContaining([
          expect.stringContaining("gh-attach-chrome-"),
          expect.stringContaining("SELECT name, value"),
        ]),
        expect.any(Function),
      );
    });

    it("throws UploadError on failure", async () => {
      const source = {
        browser: "chrome" as const,
        path: "/path/to/cookies",
        hostColumn: "host_key" as const,
      };

      execFileMock.mockImplementation(
        (
          file: string,
          args:
            | string[]
            | ((err: Error | null, result: { stdout: string }) => void),
          cb?: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          const callback = typeof args === "function" ? args : cb;
          callback?.(new Error("sqlite error"));
          return {} as Record<string, unknown>;
        },
      );

      vi.mocked(fs.copyFileSync).mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await expect(
        cookieExtractionInternals.extractCookiesFromDatabase(source),
      ).rejects.toThrow(UploadError);

      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe("Strategy Integration", () => {
    it("isAvailable returns true when cookies are found", async () => {
      // Must match what findCookieSources looks for
      setPlatform("linux");

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = p as string;
        // Return true for chrome paths AND temp files (which contain gh-attach-)
        return (
          pathStr.includes(".config/google-chrome") ||
          pathStr.includes("Default/Cookies") ||
          pathStr.includes("gh-attach-")
        );
      });

      execFileMock.mockImplementation(
        (
          file: string,
          args:
            | string[]
            | ((err: Error | null, result: { stdout: string }) => void),
          cb?: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          const callback = typeof args === "function" ? args : cb;
          // Only return cookies for chrome to simulate finding it
          const argsList = args as string[];
          if (argsList && argsList[3] && argsList[3].includes("host_key")) {
            callback?.(null, { stdout: "user_session\tvalid_session\n" });
          } else {
            callback?.(new Error("No cookies"));
          }
          return {} as Record<string, unknown>;
        },
      );

      vi.mocked(fs.copyFileSync).mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      const strategy = createCookieExtractionStrategy();
      expect(await strategy.isAvailable()).toBe(true);
    });

    it("upload throws UploadError if cookies null but errors exist", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return (p as string).includes(".config/google-chrome");
      });

      execFileMock.mockImplementation(
        (
          file: string,
          args:
            | string[]
            | ((err: Error | null, result: { stdout: string }) => void),
          cb?: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          const callback = typeof args === "function" ? args : cb;
          callback?.(new Error("Database locked"));
          return {} as Record<string, unknown>;
        },
      );

      vi.mocked(fs.copyFileSync).mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      const strategy = createCookieExtractionStrategy();
      await expect(strategy.upload("file.png", mockTarget)).rejects.toThrow(
        UploadError,
      );
    });

    it("upload succeeds when cookies are found", async () => {
      setPlatform("linux");
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = p as string;
        // Return true for chrome paths AND temp files (which contain gh-attach-)
        return (
          pathStr.includes(".config/google-chrome") ||
          pathStr.includes("Default/Cookies") ||
          pathStr.includes("gh-attach-")
        );
      });

      execFileMock.mockImplementation(
        (
          file: string,
          args:
            | string[]
            | ((err: Error | null, result: { stdout: string }) => void),
          cb?: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          const callback = typeof args === "function" ? args : cb;
          const argsList = args as string[];
          if (argsList && argsList[3] && argsList[3].includes("host_key")) {
            callback?.(null, { stdout: "user_session\tvalid_session\n" });
          } else {
            callback?.(new Error("No cookies"));
          }
          return {} as Record<string, unknown>;
        },
      );

      const strategy = createCookieExtractionStrategy();
      const result = await strategy.upload("file.png", mockTarget);

      expect(result).toBe("https://github.com/test/asset");
      expect(mockBrowserSessionUpload).toHaveBeenCalled();
    });
    it("upload throws AuthenticationError if no cookies found and no errors", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const strategy = createCookieExtractionStrategy();
      await expect(strategy.upload("file.png", mockTarget)).rejects.toThrow(
        AuthenticationError,
      );
    });
  });
});
