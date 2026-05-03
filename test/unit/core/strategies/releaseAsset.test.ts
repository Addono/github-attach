import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createReleaseAssetStrategy } from "../../../../src/core/strategies/releaseAsset.js";
import {
  AuthenticationError,
  UploadError,
} from "../../../../src/core/types.js";
import type { UploadTarget } from "../../../../src/core/types.js";

// Create a shared mock object that will be reused
let mockOctokitInstance: Record<string, unknown>;

// Mock the Octokit module
vi.mock("@octokit/rest", () => {
  return {
    Octokit: vi.fn(function (this: Record<string, unknown>) {
      if (!mockOctokitInstance) {
        mockOctokitInstance = {
          rest: {
            users: {
              getAuthenticated: vi.fn(),
            },
            repos: {
              getReleaseByTag: vi.fn(),
              createRelease: vi.fn(),
              listReleaseAssets: vi.fn(),
              uploadReleaseAsset: vi.fn(),
            },
          },
        };
      }
      return mockOctokitInstance;
    }),
  };
});

vi.mock("fs", () => ({
  readFileSync: vi.fn(() => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  promises: {
    stat: vi.fn(),
  },
}));

const mockTarget: UploadTarget = {
  owner: "testowner",
  repo: "testrepo",
  type: "issue",
  number: 42,
};

describe("Release Asset Strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOctokitInstance = null;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("isAvailable", () => {
    it("returns true when token is valid", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      mockOctokitInstance.rest.users.getAuthenticated.mockResolvedValue({
        success: true,
      });

      const available = await strategy.isAvailable();
      expect(available).toBe(true);
      expect(
        mockOctokitInstance.rest.users.getAuthenticated,
      ).toHaveBeenCalled();
    });

    it("returns false when token is empty", async () => {
      const strategy = createReleaseAssetStrategy("");

      const available = await strategy.isAvailable();
      expect(available).toBe(false);
    });

    it("returns false when authentication fails", async () => {
      const strategy = createReleaseAssetStrategy("invalid-token");
      mockOctokitInstance.rest.users.getAuthenticated.mockRejectedValue(
        new Error("Invalid token"),
      );

      const available = await strategy.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe("upload", () => {
    it("uploads file to existing release", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      const mockFilePath = "/tmp/test.png";

      const mockRelease = {
        id: 123,
        tag_name: "_gh-attach-assets",
        draft: false,
        prerelease: true,
      };

      const mockAsset = {
        name: "test.png",
        browser_download_url: "https://github.com/releases/download/test.png",
      };

      mockOctokitInstance.rest.repos.getReleaseByTag.mockResolvedValue({
        data: mockRelease,
      });
      mockOctokitInstance.rest.repos.listReleaseAssets.mockResolvedValue({
        data: [],
      });
      mockOctokitInstance.rest.repos.uploadReleaseAsset.mockResolvedValue({
        data: mockAsset,
      });

      const result = await strategy.upload(mockFilePath, mockTarget);

      expect(result.url).toBe(mockAsset.browser_download_url);
      expect(result.markdown).toContain("![test.png]");
      expect(result.strategy).toBe("release-asset");
      expect(
        mockOctokitInstance.rest.repos.getReleaseByTag,
      ).toHaveBeenCalledWith({
        owner: mockTarget.owner,
        repo: mockTarget.repo,
        tag: "_gh-attach-assets",
      });
    });

    it("returns bare URLs for uploaded videos", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      const mockFilePath = "/tmp/test.mp4";

      const mockRelease = {
        id: 123,
        tag_name: "_gh-attach-assets",
        draft: false,
        prerelease: true,
      };

      const mockAsset = {
        name: "test.mp4",
        browser_download_url: "https://github.com/releases/download/test.mp4",
      };

      mockOctokitInstance.rest.repos.getReleaseByTag.mockResolvedValue({
        data: mockRelease,
      });
      mockOctokitInstance.rest.repos.listReleaseAssets.mockResolvedValue({
        data: [],
      });
      mockOctokitInstance.rest.repos.uploadReleaseAsset.mockResolvedValue({
        data: mockAsset,
      });

      const result = await strategy.upload(mockFilePath, mockTarget);

      expect(result.url).toBe(mockAsset.browser_download_url);
      expect(result.markdown).toBe(mockAsset.browser_download_url);
      expect(result.strategy).toBe("release-asset");
    });

    it("creates release on first upload", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      const mockFilePath = "/tmp/test.png";

      const mockNewRelease = {
        id: 456,
        tag_name: "_gh-attach-assets",
        draft: false,
        prerelease: true,
      };

      const mockAsset = {
        name: "test.png",
        browser_download_url: "https://github.com/releases/download/test.png",
      };

      const err404 = Object.assign(new Error("404 Not Found"), { status: 404 });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err404);
      mockOctokitInstance.rest.repos.createRelease.mockResolvedValue({
        data: mockNewRelease,
      });
      mockOctokitInstance.rest.repos.listReleaseAssets.mockResolvedValue({
        data: [],
      });
      mockOctokitInstance.rest.repos.uploadReleaseAsset.mockResolvedValue({
        data: mockAsset,
      });

      const result = await strategy.upload(mockFilePath, mockTarget);

      expect(result.url).toBe(mockAsset.browser_download_url);
      expect(mockOctokitInstance.rest.repos.createRelease).toHaveBeenCalledWith(
        {
          owner: mockTarget.owner,
          repo: mockTarget.repo,
          tag_name: "_gh-attach-assets",
          name: "gh-attach attachments",
          body: "This is a dummy release used by [gh-attach](https://github.com/Addono/gh-attach) as storage for attachment files linked from issues and pull requests.\n\n> [!WARNING]\n> Do not delete this release or its assets — doing so will break attachment links and embeds that reference them.",
          draft: false,
          prerelease: true,
        },
      );
    });

    it("handles filename collision with hash suffix", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      const mockFilePath = "/tmp/test.png";

      const mockRelease = {
        id: 123,
        tag_name: "_gh-attach-assets",
      };

      const existingAsset = {
        name: "test.png",
        browser_download_url: "https://github.com/releases/download/test.png",
      };

      const newAsset = {
        name: "test-abc123.png",
        browser_download_url:
          "https://github.com/releases/download/test-abc123.png",
      };

      mockOctokitInstance.rest.repos.getReleaseByTag.mockResolvedValue({
        data: mockRelease,
      });
      mockOctokitInstance.rest.repos.listReleaseAssets.mockResolvedValue({
        data: [existingAsset],
      });
      mockOctokitInstance.rest.repos.uploadReleaseAsset.mockResolvedValue({
        data: newAsset,
      });

      const result = await strategy.upload(mockFilePath, mockTarget);

      expect(result.url).toBe(newAsset.browser_download_url);
      // Verify that uploadReleaseAsset was called with a modified filename
      const uploadCall =
        mockOctokitInstance.rest.repos.uploadReleaseAsset.mock.calls[0][0];
      expect(uploadCall.name).toMatch(/test-[a-z0-9]{6}\.png/);
    });

    it("throws AuthenticationError on insufficient permissions for release creation", async () => {
      const strategy = createReleaseAssetStrategy("limited-token");
      const mockFilePath = "/tmp/test.png";

      const err404 = Object.assign(new Error("404 Not Found"), { status: 404 });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err404);
      mockOctokitInstance.rest.repos.createRelease.mockRejectedValue(
        new Error("403 Forbidden - insufficient permissions"),
      );

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("throws AuthenticationError on 403 Forbidden", async () => {
      const strategy = createReleaseAssetStrategy("invalid-token");
      const mockFilePath = "/tmp/test.png";

      const err403 = Object.assign(new Error("403 Forbidden"), { status: 403 });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err403);

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("throws UploadError on asset upload failure", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      const mockFilePath = "/tmp/test.png";

      const mockRelease = {
        id: 123,
      };

      mockOctokitInstance.rest.repos.getReleaseByTag.mockResolvedValue({
        data: mockRelease,
      });
      mockOctokitInstance.rest.repos.listReleaseAssets.mockResolvedValue({
        data: [],
      });
      mockOctokitInstance.rest.repos.uploadReleaseAsset.mockRejectedValue(
        new Error("Upload failed"),
      );

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        UploadError,
      );
    });

    it("has correct strategy name", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      expect(strategy.name).toBe("release-asset");
    });

    it("throws AuthenticationError on 401 from getReleaseByTag", async () => {
      const strategy = createReleaseAssetStrategy("bad-token");
      const err401 = Object.assign(new Error("401 Unauthorized"), {
        status: 401,
      });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err401);

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toThrow(AuthenticationError);
    });

    it("throws UploadError RATE_LIMIT_EXCEEDED on 403 rate limit from getReleaseByTag", async () => {
      const strategy = createReleaseAssetStrategy("token");
      const err403 = Object.assign(new Error("rate limit"), {
        status: 403,
        response: { headers: { "x-ratelimit-remaining": "0" } },
      });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err403);

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "RATE_LIMIT_EXCEEDED",
      );
    });

    it("throws AuthenticationError on 401 when creating release", async () => {
      const strategy = createReleaseAssetStrategy("token");
      const err404 = Object.assign(new Error("404 Not Found"), { status: 404 });
      const err401 = Object.assign(new Error("401 Bad Credentials"), {
        status: 401,
      });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err404);
      mockOctokitInstance.rest.repos.createRelease.mockRejectedValue(err401);

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toThrow(AuthenticationError);
    });

    it("throws UploadError RATE_LIMIT_EXCEEDED on 403 rate limit when creating release", async () => {
      const strategy = createReleaseAssetStrategy("token");
      const err404 = Object.assign(new Error("404 Not Found"), { status: 404 });
      const err403 = Object.assign(new Error("rate limit exceeded"), {
        status: 403,
        response: { headers: { "x-ratelimit-remaining": "0" } },
      });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err404);
      mockOctokitInstance.rest.repos.createRelease.mockRejectedValue(err403);

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "RATE_LIMIT_EXCEEDED",
      );
    });

    it("throws UploadError RELEASE_CREATE_FAILED on 422 when creating release", async () => {
      const strategy = createReleaseAssetStrategy("token");
      const err404 = Object.assign(new Error("404 Not Found"), { status: 404 });
      const err422 = Object.assign(new Error("Validation Failed"), {
        status: 422,
      });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err404);
      mockOctokitInstance.rest.repos.createRelease.mockRejectedValue(err422);

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "RELEASE_CREATE_FAILED",
      );
    });

    it("throws UploadError RELEASE_CREATE_FAILED on generic error when creating release", async () => {
      const strategy = createReleaseAssetStrategy("token");
      const err404 = Object.assign(new Error("404 Not Found"), { status: 404 });
      const genericErr = Object.assign(new Error("Internal Server Error"), {
        status: 500,
      });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err404);
      mockOctokitInstance.rest.repos.createRelease.mockRejectedValue(
        genericErr,
      );

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "RELEASE_CREATE_FAILED",
      );
    });

    it("throws UploadError RELEASE_LOOKUP_FAILED on generic getReleaseByTag error", async () => {
      const strategy = createReleaseAssetStrategy("token");
      const err500 = Object.assign(new Error("Server Error"), { status: 500 });
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(err500);

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "RELEASE_LOOKUP_FAILED",
      );
    });

    it("throws AuthenticationError on 401 from uploadReleaseAsset", async () => {
      const strategy = createReleaseAssetStrategy("token");
      const mockRelease = { id: 123 };
      mockOctokitInstance.rest.repos.getReleaseByTag.mockResolvedValue({
        data: mockRelease,
      });
      mockOctokitInstance.rest.repos.listReleaseAssets.mockResolvedValue({
        data: [],
      });
      const err401 = Object.assign(new Error("401 Unauthorized"), {
        status: 401,
      });
      mockOctokitInstance.rest.repos.uploadReleaseAsset.mockRejectedValue(
        err401,
      );

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toThrow(AuthenticationError);
    });

    it("throws UploadError RATE_LIMIT_EXCEEDED on 403 rate limit from uploadReleaseAsset", async () => {
      const strategy = createReleaseAssetStrategy("token");
      const mockRelease = { id: 123 };
      mockOctokitInstance.rest.repos.getReleaseByTag.mockResolvedValue({
        data: mockRelease,
      });
      mockOctokitInstance.rest.repos.listReleaseAssets.mockResolvedValue({
        data: [],
      });
      const err403 = Object.assign(new Error("rate limit"), {
        status: 403,
        response: { headers: { "x-ratelimit-remaining": "0" } },
      });
      mockOctokitInstance.rest.repos.uploadReleaseAsset.mockRejectedValue(
        err403,
      );

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "RATE_LIMIT_EXCEEDED",
      );
    });

    it("handles filename collision for files without extension", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      const mockFilePath = "/tmp/Makefile";
      const mockRelease = { id: 123 };
      const existingAsset = {
        name: "Makefile",
        browser_download_url: "https://github.com/releases/download/Makefile",
      };
      const newAsset = {
        name: "Makefile-abc123",
        browser_download_url:
          "https://github.com/releases/download/Makefile-abc123",
      };

      mockOctokitInstance.rest.repos.getReleaseByTag.mockResolvedValue({
        data: mockRelease,
      });
      mockOctokitInstance.rest.repos.listReleaseAssets.mockResolvedValue({
        data: [existingAsset],
      });
      mockOctokitInstance.rest.repos.uploadReleaseAsset.mockResolvedValue({
        data: newAsset,
      });

      const result = await strategy.upload(mockFilePath, mockTarget);
      expect(result.url).toBe(newAsset.browser_download_url);
      const uploadCall =
        mockOctokitInstance.rest.repos.uploadReleaseAsset.mock.calls[0][0];
      expect(uploadCall.name).toMatch(/Makefile-[a-z0-9]{6}/);
      expect(uploadCall.name).not.toContain(".");
    });

    it("wraps non-Error throw as UploadError RELEASE_LOOKUP_FAILED", async () => {
      const strategy = createReleaseAssetStrategy("token");
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(
        "string error",
      );

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "RELEASE_LOOKUP_FAILED",
      );
    });

    it("detects rate limit from non-Error thrown value with rate limit message", async () => {
      const strategy = createReleaseAssetStrategy("token");
      // A non-Error object with status 403 and "rate limit" in its string form
      // This exercises the String(err).toLowerCase() branch in isRateLimitError
      const nonErrorObj = Object.create(null) as {
        status: number;
        message: string;
        toString: () => string;
      };
      nonErrorObj.status = 403;
      nonErrorObj.message = "rate limit exceeded";
      nonErrorObj.toString = () => "rate limit exceeded";
      mockOctokitInstance.rest.repos.getReleaseByTag.mockRejectedValue(
        nonErrorObj,
      );

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "RATE_LIMIT_EXCEEDED",
      );
    });

    it("continues with original filename when listing assets throws", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      const mockFilePath = "/tmp/test.png";
      const mockRelease = { id: 123 };
      const mockAsset = {
        name: "test.png",
        browser_download_url: "https://github.com/releases/download/test.png",
      };

      mockOctokitInstance.rest.repos.getReleaseByTag.mockResolvedValue({
        data: mockRelease,
      });
      // Listing assets fails — should silently fall through and use original filename
      mockOctokitInstance.rest.repos.listReleaseAssets.mockRejectedValue(
        new Error("Network failure"),
      );
      mockOctokitInstance.rest.repos.uploadReleaseAsset.mockResolvedValue({
        data: mockAsset,
      });

      const result = await strategy.upload(mockFilePath, mockTarget);
      expect(result.url).toBe(mockAsset.browser_download_url);
      // Should use original filename since listing failed
      const uploadCall =
        mockOctokitInstance.rest.repos.uploadReleaseAsset.mock.calls[0][0];
      expect(uploadCall.name).toBe("test.png");
    });
  });
});
