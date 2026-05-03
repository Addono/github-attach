import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRepoBranchStrategy } from "../../../../src/core/strategies/repoBranch.js";
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
              getBranch: vi.fn(),
            },
            git: {
              createBlob: vi.fn(),
              createTree: vi.fn(),
              createCommit: vi.fn(),
              createRef: vi.fn(),
              getTree: vi.fn(),
              updateRef: vi.fn(),
            },
          },
        };
      }
      return mockOctokitInstance;
    }),
  };
});

vi.mock("fs", () => ({
  readFileSync: vi.fn(() => Buffer.from("fake-image-data").toString("base64")),
}));

const mockTarget: UploadTarget = {
  owner: "testowner",
  repo: "testrepo",
  type: "issue",
  number: 42,
};

describe("Repository Branch Strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOctokitInstance = null;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("isAvailable", () => {
    it("returns true when token is valid", async () => {
      const strategy = createRepoBranchStrategy("valid-token");
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
      const strategy = createRepoBranchStrategy("");

      const available = await strategy.isAvailable();
      expect(available).toBe(false);
    });

    it("returns false when authentication fails", async () => {
      const strategy = createRepoBranchStrategy("invalid-token");
      mockOctokitInstance.rest.users.getAuthenticated.mockRejectedValue(
        new Error("Invalid token"),
      );

      const available = await strategy.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe("upload", () => {
    it("uploads file to existing branch", async () => {
      const strategy = createRepoBranchStrategy("valid-token");
      const mockFilePath = "/tmp/test.png";

      const mockBranch = {
        commit: {
          sha: "abc123",
        },
      };

      const mockTree = {
        sha: "tree-sha",
      };

      const mockCommit = {
        sha: "commit-sha",
      };

      mockOctokitInstance.rest.repos.getBranch.mockResolvedValue({
        data: mockBranch,
      });
      mockOctokitInstance.rest.git.createBlob.mockResolvedValue({
        data: { sha: "blob-sha" },
      });
      mockOctokitInstance.rest.git.getTree.mockResolvedValue({
        data: mockTree,
      });
      mockOctokitInstance.rest.git.createTree.mockResolvedValue({
        data: mockTree,
      });
      mockOctokitInstance.rest.git.createCommit.mockResolvedValue({
        data: mockCommit,
      });
      mockOctokitInstance.rest.git.updateRef.mockResolvedValue({});

      const result = await strategy.upload(mockFilePath, mockTarget);

      expect(result.strategy).toBe("repo-branch");
      expect(result.url).toContain("commit-sha");
      expect(result.url).toContain("test.png");
      expect(result.markdown).toContain("![test.png]");
    });

    it("returns bare URLs for uploaded videos", async () => {
      const strategy = createRepoBranchStrategy("valid-token");
      const mockFilePath = "/tmp/test.mp4";

      const mockBranch = {
        commit: {
          sha: "abc123",
        },
      };

      const mockTree = {
        sha: "tree-sha",
      };

      const mockCommit = {
        sha: "commit-sha",
      };

      mockOctokitInstance.rest.repos.getBranch.mockResolvedValue({
        data: mockBranch,
      });
      mockOctokitInstance.rest.git.createBlob.mockResolvedValue({
        data: { sha: "blob-sha" },
      });
      mockOctokitInstance.rest.git.getTree.mockResolvedValue({
        data: mockTree,
      });
      mockOctokitInstance.rest.git.createTree.mockResolvedValue({
        data: mockTree,
      });
      mockOctokitInstance.rest.git.createCommit.mockResolvedValue({
        data: mockCommit,
      });
      mockOctokitInstance.rest.git.updateRef.mockResolvedValue({});

      const result = await strategy.upload(mockFilePath, mockTarget);

      expect(result.strategy).toBe("repo-branch");
      expect(result.url).toContain("commit-sha");
      expect(result.url).toContain("test.mp4");
      expect(result.markdown).toBe(result.url);
    });

    it("creates branch on first upload", async () => {
      const strategy = createRepoBranchStrategy("valid-token");
      const mockFilePath = "/tmp/test.png";

      const errNotFound = Object.assign(new Error("404 Not Found"), {
        status: 404,
      });
      mockOctokitInstance.rest.repos.getBranch.mockRejectedValue(errNotFound);

      mockOctokitInstance.rest.git.createBlob.mockResolvedValue({
        data: { sha: "blob-sha" },
      });
      mockOctokitInstance.rest.git.createTree.mockResolvedValue({
        data: { sha: "tree-sha" },
      });
      mockOctokitInstance.rest.git.createCommit.mockResolvedValue({
        data: { sha: "initial-commit-sha" },
      });
      mockOctokitInstance.rest.git.createRef.mockResolvedValue({});

      // Second set of calls for the file commit
      mockOctokitInstance.rest.git.getTree.mockResolvedValue({
        data: { sha: "tree-sha" },
      });
      mockOctokitInstance.rest.git.updateRef.mockResolvedValue({});

      const result = await strategy.upload(mockFilePath, mockTarget);

      expect(result.strategy).toBe("repo-branch");
      expect(mockOctokitInstance.rest.git.createRef).toHaveBeenCalled();
    });

    it("throws AuthenticationError on insufficient permissions", async () => {
      const strategy = createRepoBranchStrategy("limited-token");
      const mockFilePath = "/tmp/test.png";

      const err403 = Object.assign(new Error("403 Forbidden"), { status: 403 });
      mockOctokitInstance.rest.repos.getBranch.mockRejectedValue(err403);

      await expect(strategy.upload(mockFilePath, mockTarget)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("wraps generic error as UploadError BRANCH_ACCESS_FAILED", async () => {
      const strategy = createRepoBranchStrategy("token");
      mockOctokitInstance.rest.repos.getBranch.mockRejectedValue(
        "string error",
      );

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "BRANCH_ACCESS_FAILED",
      );
    });

    it("throws AuthenticationError when branch creation fails after 404", async () => {
      const strategy = createRepoBranchStrategy("token");
      const err404 = Object.assign(new Error("404 Not Found"), { status: 404 });
      mockOctokitInstance.rest.repos.getBranch.mockRejectedValue(err404);
      mockOctokitInstance.rest.git.createBlob.mockRejectedValue(
        new Error("Permission denied"),
      );

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: AuthenticationError) =>
          err instanceof AuthenticationError &&
          err.code === "INSUFFICIENT_PERMISSIONS",
      );
    });

    it("throws UploadError BRANCH_ACCESS_FAILED on non-404 non-403 getBranch error", async () => {
      const strategy = createRepoBranchStrategy("token");
      const err500 = Object.assign(new Error("500 Server Error"), {
        status: 500,
      });
      mockOctokitInstance.rest.repos.getBranch.mockRejectedValue(err500);

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "BRANCH_ACCESS_FAILED",
      );
    });

    it("throws UploadError FILE_COMMIT_FAILED when commitFile fails", async () => {
      const strategy = createRepoBranchStrategy("token");
      const mockBranch = { commit: { sha: "abc123" } };
      mockOctokitInstance.rest.repos.getBranch.mockResolvedValue({
        data: mockBranch,
      });
      mockOctokitInstance.rest.git.createBlob.mockRejectedValue(
        new Error("Blob creation failed"),
      );

      await expect(
        strategy.upload("/tmp/test.png", mockTarget),
      ).rejects.toSatisfy(
        (err: UploadError) =>
          err instanceof UploadError && err.code === "FILE_COMMIT_FAILED",
      );
    });
  });

  describe("strategy name", () => {
    it("returns correct name", () => {
      const strategy = createRepoBranchStrategy("test-token");
      expect(strategy.name).toBe("repo-branch");
    });
  });
});
