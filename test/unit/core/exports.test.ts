import { describe, it, expect } from "vitest";

/**
 * Tests that the library entry point exports all required public APIs
 * per Core/spec.md: types, error hierarchy, strategies, and utilities.
 */
describe("Library public API exports", () => {
  it("exports all required types", async () => {
    const lib = await import("../../../src/index.js");

    // upload function
    expect(typeof lib.upload).toBe("function");
  });

  it("exports the full error hierarchy", async () => {
    const lib = await import("../../../src/index.js");

    expect(lib.GhAttachError).toBeDefined();
    expect(lib.AuthenticationError).toBeDefined();
    expect(lib.UploadError).toBeDefined();
    expect(lib.ValidationError).toBeDefined();
    expect(lib.NoStrategyAvailableError).toBeDefined();

    // Verify inheritance chain
    const base = new lib.GhAttachError("test", "TEST");
    expect(base).toBeInstanceOf(Error);
    expect(base).toBeInstanceOf(lib.GhAttachError);
    expect(base.code).toBe("TEST");
    expect(base.message).toBe("test");

    const auth = new lib.AuthenticationError("auth", "AUTH_ERR");
    expect(auth).toBeInstanceOf(lib.GhAttachError);
    expect(auth).toBeInstanceOf(Error);

    const upload = new lib.UploadError("upload", "UPLOAD_ERR");
    expect(upload).toBeInstanceOf(lib.GhAttachError);

    const validation = new lib.ValidationError("val", "VAL_ERR");
    expect(validation).toBeInstanceOf(lib.GhAttachError);

    const noStrategy = new lib.NoStrategyAvailableError("none", [
      { strategy: "test", reason: "unavailable" },
    ]);
    expect(noStrategy).toBeInstanceOf(lib.GhAttachError);
    expect(noStrategy.code).toBe("NO_STRATEGY_AVAILABLE");
  });

  it("exports all strategy factory functions", async () => {
    const lib = await import("../../../src/index.js");

    expect(typeof lib.createReleaseAssetStrategy).toBe("function");
    expect(typeof lib.createBrowserSessionStrategy).toBe("function");
    expect(typeof lib.createCookieExtractionStrategy).toBe("function");
    expect(typeof lib.createRepoBranchStrategy).toBe("function");
  });

  it("exports utility functions", async () => {
    const lib = await import("../../../src/index.js");

    expect(typeof lib.validateFile).toBe("function");
    expect(typeof lib.parseTarget).toBe("function");
  });

  it("strategy factories return valid UploadStrategy objects", async () => {
    const lib = await import("../../../src/index.js");

    const releaseAsset = lib.createReleaseAssetStrategy("token");
    expect(releaseAsset.name).toBe("release-asset");
    expect(typeof releaseAsset.upload).toBe("function");
    expect(typeof releaseAsset.isAvailable).toBe("function");

    const browserSession = lib.createBrowserSessionStrategy("cookies");
    expect(browserSession.name).toBe("browser-session");
    expect(typeof browserSession.upload).toBe("function");
    expect(typeof browserSession.isAvailable).toBe("function");

    const cookieExtraction = lib.createCookieExtractionStrategy();
    expect(cookieExtraction.name).toBe("cookie-extraction");
    expect(typeof cookieExtraction.upload).toBe("function");
    expect(typeof cookieExtraction.isAvailable).toBe("function");

    const repoBranch = lib.createRepoBranchStrategy("token");
    expect(repoBranch.name).toBe("repo-branch");
    expect(typeof repoBranch.upload).toBe("function");
    expect(typeof repoBranch.isAvailable).toBe("function");
  });

  it("parseTarget parses full URLs correctly", async () => {
    const { parseTarget } = await import("../../../src/index.js");

    const target = parseTarget("https://github.com/owner/repo/issues/42");
    expect(target).toEqual({
      owner: "owner",
      repo: "repo",
      type: "issue",
      number: 42,
    });
  });

  it("parseTarget parses shorthand references", async () => {
    const { parseTarget } = await import("../../../src/index.js");

    const target = parseTarget("owner/repo#99");
    expect(target).toEqual({
      owner: "owner",
      repo: "repo",
      type: "issue",
      number: 99,
    });
  });

  it("parseTarget throws ValidationError for invalid targets", async () => {
    const { parseTarget, ValidationError } =
      await import("../../../src/index.js");

    expect(() => parseTarget("not-a-valid-target")).toThrow(ValidationError);
  });

  it("error classes include optional details field", async () => {
    const { UploadError } = await import("../../../src/index.js");

    const err = new UploadError("test", "CODE", { key: "value" });
    expect(err.details).toEqual({ key: "value" });
    expect(err.code).toBe("CODE");
    expect(err.message).toBe("test");
    expect(err.name).toBe("UploadError");
  });
});
