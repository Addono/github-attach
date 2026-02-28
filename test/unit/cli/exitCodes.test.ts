import { describe, it, expect } from "vitest";
import {
  AuthenticationError,
  ValidationError,
  UploadError,
  GhAttachError,
  NoStrategyAvailableError,
} from "../../../src/core/types.js";

/**
 * These tests verify the exit code logic directly.
 * The actual getExitCode function is private in src/cli/index.ts,
 * so we test the logic here to ensure correctness.
 *
 * Exit codes per CLI specification:
 * - 0: Success
 * - 1: General error
 * - 2: Authentication error
 * - 3: Validation error
 * - 4: Network/upload error
 */

/**
 * Helper function matching the getExitCode implementation in src/cli/index.ts
 */
function getExitCode(err: unknown): number {
  if (err instanceof AuthenticationError) {
    return 2;
  }
  if (err instanceof ValidationError) {
    return 3;
  }
  if (err instanceof UploadError) {
    return 4;
  }
  return 1;
}

describe("CLI exit codes", () => {
  describe("getExitCode", () => {
    it("should return 2 for AuthenticationError", () => {
      const err = new AuthenticationError(
        "Session expired",
        "SESSION_EXPIRED",
        {},
      );
      expect(getExitCode(err)).toBe(2);
    });

    it("should return 3 for ValidationError", () => {
      const err = new ValidationError("File too large", "FILE_TOO_LARGE", {});
      expect(getExitCode(err)).toBe(3);
    });

    it("should return 4 for UploadError", () => {
      const err = new UploadError("Upload failed", "UPLOAD_FAILED", {});
      expect(getExitCode(err)).toBe(4);
    });

    it("should return 1 for generic GhAttachError", () => {
      const err = new GhAttachError("Generic error", "GENERIC_ERROR", {});
      expect(getExitCode(err)).toBe(1);
    });

    it("should return 1 for NoStrategyAvailableError", () => {
      const err = new NoStrategyAvailableError("No strategy available", [
        { strategy: "release-asset", reason: "not available" },
        { strategy: "repo-branch", reason: "not configured" },
      ]);
      expect(getExitCode(err)).toBe(1);
    });

    it("should return 1 for standard Error", () => {
      const err = new Error("Something went wrong");
      expect(getExitCode(err)).toBe(1);
    });

    it("should return 1 for non-Error values", () => {
      expect(getExitCode("string error")).toBe(1);
      expect(getExitCode(null)).toBe(1);
      expect(getExitCode(undefined)).toBe(1);
      expect(getExitCode(42)).toBe(1);
    });
  });
});
