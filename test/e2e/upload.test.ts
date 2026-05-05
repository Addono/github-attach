/**
 * E2E tests for upload strategies against real GitHub infrastructure.
 *
 * Requires environment variables:
 * - E2E_TESTS=true - enable E2E tests
 * - GITHUB_TOKEN - GitHub API token with contents:write permission
 * - E2E_TEST_REPO - target repository (e.g., "owner/repo")
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { Octokit } from "@octokit/rest";
import { createReleaseAssetStrategy } from "../../src/core/strategies/releaseAsset.js";
import { createRepoBranchStrategy } from "../../src/core/strategies/repoBranch.js";
import type { UploadTarget } from "../../src/core/types.js";

// Skip E2E tests unless explicitly enabled AND credentials are available
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const E2E_TEST_REPO = process.env.E2E_TEST_REPO;
const E2E_ENABLED =
  process.env.E2E_TESTS === "true" && !!GITHUB_TOKEN && !!E2E_TEST_REPO;

const TEST_IMAGE_PATH = join(import.meta.dirname, "../fixtures/test-image.png");
const ASSETS_TAG = "_gh-attach-assets";
const BRANCH_NAME = "gh-attach-assets";

// Parse repo info
function parseRepo(): { owner: string; repo: string } | null {
  if (!E2E_TEST_REPO) return null;
  const parts = E2E_TEST_REPO.split("/");
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

// When E2E is disabled, emit a clear message describing what is skipped and why.
describe("E2E gating", () => {
  it("requires E2E_TESTS=true, GITHUB_TOKEN, and E2E_TEST_REPO to run real tests", () => {
    if (!E2E_ENABLED) {
      console.log(
        "[E2E] Tests skipped — set E2E_TESTS=true with GITHUB_TOKEN and E2E_TEST_REPO to run against real GitHub infrastructure.",
      );
    }
    // This test always passes; it documents the gating requirement.
    expect(true).toBe(true);
  });
});

describe.skipIf(!E2E_ENABLED)("E2E Upload Tests", () => {
  let octokit: InstanceType<typeof Octokit>;
  let target: UploadTarget;
  let repoInfo: { owner: string; repo: string };

  // Track created resources for cleanup
  const createdAssets: Array<{ releaseId: number; assetId: number }> = [];
  let releaseCreated = false;
  let branchCreated = false;

  beforeAll(() => {
    if (!E2E_ENABLED) return;

    if (!GITHUB_TOKEN) {
      throw new Error("E2E tests require GITHUB_TOKEN environment variable");
    }
    if (!E2E_TEST_REPO) {
      throw new Error("E2E tests require E2E_TEST_REPO environment variable");
    }

    const parsed = parseRepo();
    if (!parsed) {
      throw new Error("E2E_TEST_REPO must be in format 'owner/repo'");
    }

    repoInfo = parsed;
    octokit = new Octokit({ auth: GITHUB_TOKEN });
    target = {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      type: "issue",
      number: 1,
    };
  });

  afterAll(async () => {
    if (!E2E_ENABLED || !octokit) return;

    // Clean up release assets
    for (const asset of createdAssets) {
      try {
        await octokit.rest.repos.deleteReleaseAsset({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          asset_id: asset.assetId,
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    // If we created the release, delete it
    if (releaseCreated) {
      try {
        const { data: release } = await octokit.rest.repos.getReleaseByTag({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          tag: ASSETS_TAG,
        });
        await octokit.rest.repos.deleteRelease({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          release_id: release.id,
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    // If we created the branch, delete it
    if (branchCreated) {
      try {
        await octokit.rest.git.deleteRef({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          ref: `heads/${BRANCH_NAME}`,
        });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Release Asset Strategy", () => {
    it("should upload an image and return accessible URL", async () => {
      const strategy = createReleaseAssetStrategy(GITHUB_TOKEN ?? "");

      // Verify strategy is available
      const available = await strategy.isAvailable();
      expect(available).toBe(true);

      // Check if release already exists
      let releaseExisted = false;
      try {
        await octokit.rest.repos.getReleaseByTag({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          tag: ASSETS_TAG,
        });
        releaseExisted = true;
      } catch {
        // Release does not exist yet.
      }

      // Upload image
      const result = await strategy.upload(TEST_IMAGE_PATH, target);

      // Verify result
      expect(result.url).toMatch(
        /^https:\/\/github\.com\/.+\/releases\/download\//,
      );
      expect(result.markdown).toMatch(/^!\[test-image.*\.png\]\(https:\/\//);
      expect(result.strategy).toBe("release-asset");

      // Track if we created the release
      if (!releaseExisted) {
        releaseCreated = true;
      }

      // Track the asset for cleanup
      const { data: release } = await octokit.rest.repos.getReleaseByTag({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        tag: ASSETS_TAG,
      });
      const { data: assets } = await octokit.rest.repos.listReleaseAssets({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        release_id: release.id,
      });
      const uploadedAsset = assets.find(
        (a) => a.browser_download_url === result.url,
      );
      if (uploadedAsset) {
        createdAssets.push({
          releaseId: release.id,
          assetId: uploadedAsset.id,
        });
      }

      // Verify URL is accessible (download the asset)
      // Note: GitHub release assets require authentication for draft releases
      // We verify by checking the asset exists in the API
      expect(uploadedAsset).toBeDefined();
    });

    it("should handle filename collisions", async () => {
      const strategy = createReleaseAssetStrategy(GITHUB_TOKEN ?? "");

      // Upload twice
      const result1 = await strategy.upload(TEST_IMAGE_PATH, target);
      const result2 = await strategy.upload(TEST_IMAGE_PATH, target);

      // URLs should be different (second upload gets hash suffix)
      expect(result1.url).not.toBe(result2.url);

      // Track assets for cleanup
      const { data: release } = await octokit.rest.repos.getReleaseByTag({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        tag: ASSETS_TAG,
      });
      const { data: assets } = await octokit.rest.repos.listReleaseAssets({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        release_id: release.id,
      });

      for (const url of [result1.url, result2.url]) {
        const asset = assets.find((a) => a.browser_download_url === url);
        if (asset) {
          createdAssets.push({
            releaseId: release.id,
            assetId: asset.id,
          });
        }
      }
    });
  });

  describe("Repository Branch Strategy", () => {
    it("should upload an image and return accessible raw URL", async () => {
      const strategy = createRepoBranchStrategy(GITHUB_TOKEN ?? "");

      // Verify strategy is available
      const available = await strategy.isAvailable();
      expect(available).toBe(true);

      // Check if branch already exists
      let branchExisted = false;
      try {
        await octokit.rest.repos.getBranch({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          branch: BRANCH_NAME,
        });
        branchExisted = true;
      } catch {
        // Branch does not exist yet.
      }

      // Upload image
      const result = await strategy.upload(TEST_IMAGE_PATH, target);

      // Verify result
      expect(result.url).toMatch(
        /^https:\/\/github\.com\/.+\/raw\/refs\/heads\/gh-attach-assets\/[^/]+\/test-image\.png$/,
      );
      expect(result.markdown).toMatch(/^!\[test-image\.png\]\(https:\/\//);
      expect(result.strategy).toBe("repo-branch");

      // Track if we created the branch
      if (!branchExisted) {
        branchCreated = true;
      }

      // Verify URL is accessible by fetching it
      const response = await fetch(result.url);
      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type")).toMatch(/image\/png/);
    });

    it("should commit to existing branch", async () => {
      const strategy = createRepoBranchStrategy(GITHUB_TOKEN ?? "");

      // Upload twice
      const result1 = await strategy.upload(TEST_IMAGE_PATH, target);
      const result2 = await strategy.upload(TEST_IMAGE_PATH, target);

      // Both should succeed with different unique branch paths
      expect(result1.strategy).toBe("repo-branch");
      expect(result2.strategy).toBe("repo-branch");
      // The URLs will have different asset paths
      expect(result1.url).not.toBe(result2.url);

      // Verify both URLs are accessible
      const [resp1, resp2] = await Promise.all([
        fetch(result1.url),
        fetch(result2.url),
      ]);
      expect(resp1.ok).toBe(true);
      expect(resp2.ok).toBe(true);
    });
  });
});
