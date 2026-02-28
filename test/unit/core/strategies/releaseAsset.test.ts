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
        draft: true,
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

    it("creates release on first upload", async () => {
      const strategy = createReleaseAssetStrategy("valid-token");
      const mockFilePath = "/tmp/test.png";

      const mockNewRelease = {
        id: 456,
        tag_name: "_gh-attach-assets",
        draft: true,
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
          name: "Image Assets",
          draft: true,
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
  });
});
