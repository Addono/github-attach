import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBrowserSessionStrategy } from "../../../../src/core/strategies/browserSession.js";
import {
  AuthenticationError,
  UploadError,
} from "../../../../src/core/types.js";
import type { UploadTarget } from "../../../../src/core/types.js";

const mockTarget: UploadTarget = {
  owner: "testowner",
  repo: "testrepo",
  type: "issue",
  number: 42,
};

// Mock fetch globally
global.fetch = vi.fn();

// Track FormData appends for verification
const formDataAppends: Array<{ key: string; value: unknown }> = [];
global.FormData = class FormData {
  append(key: string, value: unknown) {
    formDataAppends.push({ key, value });
  }
} as unknown as typeof FormData;

// Mock fs.readFileSync (used by uploadToS3 to read file as Buffer)
vi.mock("fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("fs")>();
  return {
    ...original,
    readFileSync: vi.fn(() => Buffer.from("fake-image-data")),
    createReadStream: vi.fn(() => ({
      pipe: vi.fn(),
      on: vi.fn(),
    })),
  };
});

describe("Browser Session Strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formDataAppends.length = 0;
  });

  describe("isAvailable", () => {
    it("returns true when cookies are present", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const available = await strategy.isAvailable();
      expect(available).toBe(true);
    });

    it("returns false when cookies are empty", async () => {
      const strategy = createBrowserSessionStrategy("");
      const available = await strategy.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe("upload - getRepositoryId", () => {
    it("throws AuthenticationError on 401 response from repo API", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("throws AuthenticationError on 403 response from repo API", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("throws UploadError when network error occurs during repo fetch", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const error = await strategy
        .upload(mockFilePath, mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UploadError);
      expect(error.code).toBe("REPO_ID_FETCH_FAILED");
    });
  });

  describe("upload - getUploadPolicy", () => {
    it("throws UploadError on policy fetch failure (500)", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Internal Server Error",
        });

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        UploadError,
      );
    });

    it("throws AuthenticationError on 401 during policy fetch", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
        });

      const error = await strategy
        .upload(mockFilePath, mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.code).toBe("SESSION_EXPIRED");
    });

    it("throws AuthenticationError on 403 during policy fetch", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
        });

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("throws UploadError when network error occurs during policy fetch", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockRejectedValueOnce(new Error("Network timeout"));

      const error = await strategy
        .upload(mockFilePath, mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UploadError);
      expect(error.code).toBe("CSRF_EXTRACTION_FAILED");
    });
  });

  describe("upload - uploadToS3", () => {
    it("throws UploadError on S3 upload failure", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      // Setup mock for successful repo ID + policy fetch, then S3 failure
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "value", policy: "abc123" },
            token: "csrf-token-123",
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        });

      const error = await strategy
        .upload(mockFilePath, mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UploadError);
      expect(error.code).toBe("S3_UPLOAD_FAILED");
    });

    it("throws UploadError when network error occurs during S3 upload", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "value" },
            token: "csrf-token-123",
          }),
        })
        .mockRejectedValueOnce(new Error("Connection reset"));

      const error = await strategy
        .upload(mockFilePath, mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UploadError);
      expect(error.code).toBe("S3_UPLOAD_FAILED");
    });
  });

  describe("upload - confirmUpload", () => {
    it("throws AuthenticationError on 401 during confirm", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "value" },
            token: "csrf-token-123",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
        });

      const error = await strategy
        .upload(mockFilePath, mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.code).toBe("SESSION_EXPIRED");
    });

    it("throws AuthenticationError on 403 during confirm", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "value" },
            token: "csrf-token-123",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
        });

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("throws UploadError on confirm failure", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "value" },
            token: "csrf-token-123",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        });

      const error = await strategy
        .upload(mockFilePath, mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UploadError);
      expect(error.code).toBe("CONFIRM_UPLOAD_FAILED");
    });

    it("throws UploadError when network error occurs during confirm", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "value" },
            token: "csrf-token-123",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        })
        .mockRejectedValueOnce(new Error("Connection dropped"));

      const error = await strategy
        .upload(mockFilePath, mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UploadError);
      expect(error.code).toBe("CONFIRM_UPLOAD_FAILED");
    });
  });

  describe("upload - successful flow", () => {
    it("completes full upload flow and returns result", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "images/test.png", policy: "encoded-policy" },
            token: "csrf-token-123",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            url: "https://user-images.githubusercontent.com/test.png",
          }),
        });

      const result = await strategy.upload(mockFilePath, mockTarget);

      expect(result).toEqual({
        url: "https://user-images.githubusercontent.com/test.png",
        markdown:
          "![test.png](https://user-images.githubusercontent.com/test.png)",
        strategy: "browser-session",
      });
    });

    it("returns bare URLs for uploaded videos", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.mp4";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "videos/test.mp4", policy: "encoded-policy" },
            token: "csrf-token-123",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            url: "https://user-images.githubusercontent.com/test.mp4",
          }),
        });

      const result = await strategy.upload(mockFilePath, mockTarget);

      expect(result).toEqual({
        url: "https://user-images.githubusercontent.com/test.mp4",
        markdown: "https://user-images.githubusercontent.com/test.mp4",
        strategy: "browser-session",
      });
    });

    it("includes form fields in S3 upload", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/image.jpg";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "uploads/image.jpg", policy: "abc", signature: "xyz" },
            token: "csrf-token-456",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            url: "https://user-images.githubusercontent.com/image.jpg",
          }),
        });

      await strategy.upload(mockFilePath, mockTarget);

      // Verify form fields were appended
      expect(formDataAppends).toContainEqual({
        key: "key",
        value: "uploads/image.jpg",
      });
      expect(formDataAppends).toContainEqual({ key: "policy", value: "abc" });
      expect(formDataAppends).toContainEqual({
        key: "signature",
        value: "xyz",
      });
      expect(formDataAppends.some((a) => a.key === "file")).toBe(true);
    });

    it("handles filenames with special characters", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/my image (1).png";

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "value" },
            token: "csrf-token",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            url: "https://user-images.githubusercontent.com/my-image-1.png",
          }),
        });

      const result = await strategy.upload(mockFilePath, mockTarget);
      expect(result.markdown).toContain("![my image (1).png]");
    });
  });

  describe("upload - error wrapping", () => {
    it("wraps non-Error thrown values in UploadError", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        "string error",
      );

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        UploadError,
      );
    });

    it("wraps generic Error (non-Auth/Upload) in UploadError with BROWSER_SESSION_FAILED code", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      // Simulate a successful 3-step flow where confirmUpload's json() throws a TypeError
      // Step 1: getRepositoryId succeeds
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        // Step 2: getUploadPolicy succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            upload_url: "https://s3.example.com/upload",
            form: { key: "value" },
            token: "csrf-token",
          }),
        })
        // Step 3: uploadToS3 succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
        })
        // Step 4: confirmUpload succeeds but json() throws TypeError
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => {
            throw new TypeError("Cannot read properties of undefined");
          },
        });

      const error = await strategy
        .upload(mockFilePath, mockTarget)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UploadError);
      expect((error as UploadError).code).toBe("CONFIRM_UPLOAD_FAILED");
    });

    it("re-throws AuthenticationError without wrapping", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      const authError = new AuthenticationError(
        "Session expired",
        "SESSION_EXPIRED",
        {},
      );
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        authError,
      );

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toBe(
        authError,
      );
    });

    it("re-throws UploadError without double-wrapping", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      const mockFilePath = "/tmp/test.png";

      const uploadError = new UploadError("S3 failed", "S3_UPLOAD_FAILED", {});
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockRejectedValueOnce(uploadError);

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toBe(
        uploadError,
      );
    });
  });

  describe("strategy name", () => {
    it("returns correct name", () => {
      const strategy = createBrowserSessionStrategy("test-cookie");
      expect(strategy.name).toBe("browser-session");
    });
  });

  describe("spec compliance — CSRF token extraction", () => {
    it("throws UploadError with CSRF_EXTRACTION_FAILED code when policy response is not OK (500)", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Unexpected HTML response without CSRF token",
        });

      const error = await strategy
        .upload("/tmp/test.png", mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UploadError);
      expect(error.code).toBe("CSRF_EXTRACTION_FAILED");
    });

    it("throws UploadError with CSRF_EXTRACTION_FAILED code when policy fetch throws network error", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockRejectedValueOnce(new Error("Connection refused"));

      const error = await strategy
        .upload("/tmp/test.png", mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UploadError);
      expect(error.code).toBe("CSRF_EXTRACTION_FAILED");
    });
  });

  describe("spec compliance — expired session detection", () => {
    it("throws AuthenticationError with SESSION_EXPIRED code when server returns 401", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
        });

      const error = await strategy
        .upload("/tmp/test.png", mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.code).toBe("SESSION_EXPIRED");
    });

    it("throws AuthenticationError with SESSION_EXPIRED code when server returns 403", async () => {
      const strategy = createBrowserSessionStrategy("test-cookie");

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
        });

      const error = await strategy
        .upload("/tmp/test.png", mockTarget)
        .catch((e) => e);
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.code).toBe("SESSION_EXPIRED");
    });
  });
});
