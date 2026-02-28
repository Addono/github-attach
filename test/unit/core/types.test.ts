import { describe, it, expect } from "vitest";
import {
  GhAttachError,
  AuthenticationError,
  UploadError,
  ValidationError,
  NoStrategyAvailableError,
} from "../../../src/core/types.js";

describe("Error hierarchy", () => {
  it("GhAttachError has code and details", () => {
    const err = new GhAttachError("test", "TEST_CODE", { key: "val" });
    expect(err.message).toBe("test");
    expect(err.code).toBe("TEST_CODE");
    expect(err.details).toEqual({ key: "val" });
    expect(err.name).toBe("GhAttachError");
  });

  it("AuthenticationError extends GhAttachError", () => {
    const err = new AuthenticationError("auth fail", "SESSION_EXPIRED");
    expect(err).toBeInstanceOf(GhAttachError);
    expect(err.name).toBe("AuthenticationError");
    expect(err.code).toBe("SESSION_EXPIRED");
  });

  it("UploadError extends GhAttachError", () => {
    const err = new UploadError("upload fail", "CSRF_EXTRACTION_FAILED");
    expect(err).toBeInstanceOf(GhAttachError);
    expect(err.name).toBe("UploadError");
  });

  it("ValidationError extends GhAttachError", () => {
    const err = new ValidationError("bad input", "UNSUPPORTED_FORMAT");
    expect(err).toBeInstanceOf(GhAttachError);
    expect(err.name).toBe("ValidationError");
  });

  it("NoStrategyAvailableError lists tried strategies", () => {
    const err = new NoStrategyAvailableError(["s1", "s2"]);
    expect(err).toBeInstanceOf(GhAttachError);
    expect(err.code).toBe("NO_STRATEGY_AVAILABLE");
    expect(err.details).toEqual({ tried: ["s1", "s2"] });
    expect(err.message).toContain("s1, s2");
  });
});
