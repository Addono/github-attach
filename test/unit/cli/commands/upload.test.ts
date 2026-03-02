import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "stream";
import { uploadCommand } from "../../../../src/cli/commands/upload.js";
import {
  ValidationError,
  NoStrategyAvailableError,
} from "../../../../src/core/types.js";

// Mock the core modules
vi.mock("../../../../src/core/upload.js", () => ({
  upload: vi.fn(),
}));
vi.mock("../../../../src/core/validation.js", () => ({
  validateFile: vi.fn(),
}));
vi.mock("../../../../src/core/session.js", () => ({
  loadSession: vi.fn(() => null),
  getSessionCookies: vi.fn(() => null),
  getSessionToken: vi.fn(() => null),
}));
vi.mock("../../../../src/cli/commands/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

import { upload } from "../../../../src/core/upload.js";
import { validateFile } from "../../../../src/core/validation.js";
import { loadConfig } from "../../../../src/cli/commands/config.js";

describe("uploadCommand unit tests", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let origToken: string | undefined;
  let origGhToken: string | undefined;
  let origCookies: string | undefined;
  let origStrategy: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    origToken = process.env.GITHUB_TOKEN;
    origGhToken = process.env.GH_TOKEN;
    origCookies = process.env.GH_ATTACH_COOKIES;
    origStrategy = process.env.GH_ATTACH_STRATEGY;
    process.env.GITHUB_TOKEN = "test-token";
    delete process.env.GH_TOKEN;
    delete process.env.GH_ATTACH_COOKIES;
    delete process.env.GH_ATTACH_STRATEGY;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
    else delete process.env.GITHUB_TOKEN;
    if (origGhToken !== undefined) process.env.GH_TOKEN = origGhToken;
    else delete process.env.GH_TOKEN;
    if (origCookies !== undefined) process.env.GH_ATTACH_COOKIES = origCookies;
    else delete process.env.GH_ATTACH_COOKIES;
    if (origStrategy !== undefined)
      process.env.GH_ATTACH_STRATEGY = origStrategy;
    else delete process.env.GH_ATTACH_STRATEGY;
  });

  it("throws ValidationError when --stdin is used without --filename", async () => {
    await expect(
      uploadCommand([], { target: "owner/repo#1", stdin: true }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when no files are provided", async () => {
    await expect(uploadCommand([], { target: "owner/repo#1" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("throws ValidationError when target is missing and no config default", async () => {
    await expect(uploadCommand(["file.png"], {})).rejects.toThrow(
      ValidationError,
    );
  });

  it("uses default-target from config when --target not specified", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      "default-target": "owner/repo#5",
    });
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://example.com/img.png",
      markdown: "![file.png](https://example.com/img.png)",
      strategy: "release-asset",
    });

    await uploadCommand(["file.png"], {});

    expect(upload).toHaveBeenCalled();
  });

  it("outputs markdown format by default", async () => {
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://example.com/img.png",
      markdown: "![test.png](https://example.com/img.png)",
      strategy: "release-asset",
    });

    await uploadCommand(["test.png"], { target: "owner/repo#1" });

    expect(consoleSpy).toHaveBeenCalledWith(
      "![test.png](https://example.com/img.png)",
    );
  });

  it("outputs URL format when --format url", async () => {
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://example.com/img.png",
      markdown: "![test.png](https://example.com/img.png)",
      strategy: "release-asset",
    });

    await uploadCommand(["test.png"], {
      target: "owner/repo#1",
      format: "url",
    });

    expect(consoleSpy).toHaveBeenCalledWith("https://example.com/img.png");
  });

  it("outputs JSON format when --format json", async () => {
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://example.com/img.png",
      markdown: "![test.png](https://example.com/img.png)",
      strategy: "release-asset",
    });

    await uploadCommand(["test.png"], {
      target: "owner/repo#1",
      format: "json",
    });

    const logged = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(logged);
    expect(parsed.url).toBe("https://example.com/img.png");
    expect(parsed.strategy).toBe("release-asset");
  });

  it("uploads multiple files sequentially", async () => {
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload)
      .mockResolvedValueOnce({
        url: "https://example.com/a.png",
        markdown: "![a.png](https://example.com/a.png)",
        strategy: "release-asset",
      })
      .mockResolvedValueOnce({
        url: "https://example.com/b.png",
        markdown: "![b.png](https://example.com/b.png)",
        strategy: "release-asset",
      });

    await uploadCommand(["a.png", "b.png"], { target: "owner/repo#1" });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it("still has cookie-extraction available even without explicit auth", async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GH_ATTACH_COOKIES;
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://example.com/img.png",
      markdown: "![file.png](https://example.com/img.png)",
      strategy: "cookie-extraction",
    });

    // Cookie-extraction strategy is always instantiable
    await uploadCommand(["file.png"], { target: "owner/repo#1" });
    expect(upload).toHaveBeenCalled();
  });

  it("throws NoStrategyAvailableError for unknown explicit strategy", async () => {
    await expect(
      uploadCommand(["file.png"], {
        target: "owner/repo#1",
        strategy: "nonexistent",
      }),
    ).rejects.toThrow(NoStrategyAvailableError);
  });

  it("uses GH_ATTACH_STRATEGY environment variable for strategy override", async () => {
    process.env.GH_ATTACH_STRATEGY = "release-asset";
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://example.com/img.png",
      markdown: "![file.png](https://example.com/img.png)",
      strategy: "release-asset",
    });

    await uploadCommand(["file.png"], { target: "owner/repo#1" });

    expect(upload).toHaveBeenCalled();
  });

  it("uses strategy-order from config", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      "strategy-order": ["release-asset"],
    });
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://example.com/img.png",
      markdown: "![file.png](https://example.com/img.png)",
      strategy: "release-asset",
    });

    await uploadCommand(["file.png"], { target: "owner/repo#1" });

    expect(upload).toHaveBeenCalled();
  });

  it("uses GH_ATTACH_COOKIES for browser-session strategy", async () => {
    process.env.GH_ATTACH_COOKIES = "user_session=abc123";
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://user-images.githubusercontent.com/img.png",
      markdown:
        "![file.png](https://user-images.githubusercontent.com/img.png)",
      strategy: "browser-session",
    });

    await uploadCommand(["file.png"], { target: "owner/repo#1" });

    expect(upload).toHaveBeenCalled();
  });

  it("uses GH_TOKEN when GITHUB_TOKEN is not set", async () => {
    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = "gh-token-value";
    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://example.com/img.png",
      markdown: "![file.png](https://example.com/img.png)",
      strategy: "release-asset",
    });

    await uploadCommand(["file.png"], { target: "owner/repo#1" });

    expect(upload).toHaveBeenCalled();
    delete process.env.GH_TOKEN;
  });

  it("throws NoStrategyAvailableError when config strategy-order yields no available strategies", async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GH_ATTACH_COOKIES;
    // Only token-requiring strategies in the order, but no token is set
    vi.mocked(loadConfig).mockReturnValue({
      "strategy-order": ["release-asset", "repo-branch"],
    });

    await expect(
      uploadCommand(["file.png"], { target: "owner/repo#1" }),
    ).rejects.toThrow(NoStrategyAvailableError);
  });

  it("handles stdin mode by writing temp file and cleaning up", async () => {
    const fakeStdin = new Readable({ read() {} });
    const origStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: fakeStdin,
      writable: true,
    });

    vi.mocked(validateFile).mockResolvedValue(undefined);
    vi.mocked(upload).mockResolvedValue({
      url: "https://example.com/img.png",
      markdown: "![img.png](https://example.com/img.png)",
      strategy: "release-asset",
    });

    const promise = uploadCommand([], {
      target: "owner/repo#1",
      stdin: true,
      filename: "img.png",
    });

    // Emit data and end on the fake stdin
    fakeStdin.push(Buffer.from("fake-image-data"));
    fakeStdin.push(null);

    await promise;

    expect(upload).toHaveBeenCalled();
    Object.defineProperty(process, "stdin", {
      value: origStdin,
      writable: true,
    });
  });
});
