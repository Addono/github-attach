import { Octokit } from "@octokit/rest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { basename } from "path";
import { formatAttachmentMarkdown } from "../attachment.js";
import { AuthenticationError, UploadError } from "../types.js";
import type { UploadResult, UploadStrategy, UploadTarget } from "../types.js";

const BRANCH_NAME = "gh-attach-assets";

/**
 * Repository Branch upload strategy using GitHub's REST API.
 * Commits attachments to a dedicated orphan branch and returns GitHub raw URLs.
 *
 * @param token GitHub API token with `contents:write` permission
 * @returns UploadStrategy implementation
 */
export function createRepoBranchStrategy(token: string): UploadStrategy {
  const octokit = new Octokit({ auth: token });

  return {
    name: "repo-branch",

    async isAvailable(): Promise<boolean> {
      if (!token) return false;
      try {
        await octokit.rest.users.getAuthenticated();
        return true;
      } catch {
        return false;
      }
    },

    async upload(
      filePath: string,
      target: UploadTarget,
    ): Promise<UploadResult> {
      try {
        // Check if branch exists or create it
        const branchSha = await ensureAssetsBranch(octokit, target);

        // Commit the file to the branch
        const filename = basename(filePath);
        const assetPath = createAssetPath(filename);
        const fileContent = readFileSync(filePath, "base64");

        await commitFile(
          octokit,
          target,
          filename,
          assetPath,
          fileContent,
          branchSha,
        );

        // Use GitHub's authenticated raw URL so attachments resolve for private repositories.
        const url = buildAssetUrl(target, assetPath);

        // Generate markdown
        const markdown = formatAttachmentMarkdown(filePath, url);

        return {
          url,
          markdown,
          strategy: "repo-branch",
        };
      } catch (err) {
        // Re-throw authentication errors
        if (err instanceof AuthenticationError) {
          throw err;
        }
        // Re-throw upload errors
        if (err instanceof UploadError) {
          throw err;
        }
        // Wrap other errors
        throw new UploadError(
          `Repository branch upload failed: ${err instanceof Error ? err.message : String(err)}`,
          "REPO_BRANCH_FAILED",
          { filePath, target, originalError: String(err) },
        );
      }
    },
  };
}

function createAssetPath(filename: string): string {
  return `${randomUUID()}/${filename}`;
}

function buildAssetUrl(target: UploadTarget, assetPath: string): string {
  const encodedAssetPath = assetPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://github.com/${target.owner}/${target.repo}/raw/refs/heads/${BRANCH_NAME}/${encodedAssetPath}`;
}

/**
 * Ensures the assets branch exists, creating it if necessary.
 *
 * @internal
 */
async function ensureAssetsBranch(
  octokit: InstanceType<typeof Octokit>,
  target: UploadTarget,
): Promise<string> {
  try {
    // Try to get the branch
    const { data: branch } = await octokit.rest.repos.getBranch({
      owner: target.owner,
      repo: target.repo,
      branch: BRANCH_NAME,
    });
    return branch.commit.sha;
  } catch (err: unknown) {
    // If branch doesn't exist, create it as an orphan
    if (
      err instanceof Error &&
      "status" in err &&
      (err as unknown as { status: number }).status === 404
    ) {
      try {
        // Create an orphan branch by creating an initial commit
        const { data: blob } = await octokit.rest.git.createBlob({
          owner: target.owner,
          repo: target.repo,
          content: "# gh-attach attachments",
          encoding: "utf-8",
        });

        const { data: tree } = await octokit.rest.git.createTree({
          owner: target.owner,
          repo: target.repo,
          tree: [
            {
              path: "README.md",
              mode: "100644",
              type: "blob",
              sha: blob.sha,
            },
          ],
        });

        const { data: commit } = await octokit.rest.git.createCommit({
          owner: target.owner,
          repo: target.repo,
          message: "Initial commit for attachment assets",
          tree: tree.sha,
          parents: [],
        });

        await octokit.rest.git.createRef({
          owner: target.owner,
          repo: target.repo,
          ref: `refs/heads/${BRANCH_NAME}`,
          sha: commit.sha,
        });

        return commit.sha;
      } catch (createErr) {
        throw new AuthenticationError(
          `Cannot create branch: insufficient permissions or repository access`,
          "INSUFFICIENT_PERMISSIONS",
          { target, originalError: String(createErr) },
        );
      }
    }

    // Check for permission-related errors
    if (
      err instanceof Error &&
      (err.message.includes("403") ||
        err.message.includes("Forbidden") ||
        err.message.includes("403 Forbidden"))
    ) {
      throw new AuthenticationError(
        `Insufficient permissions to access ${target.owner}/${target.repo}`,
        "INSUFFICIENT_PERMISSIONS",
        { target, originalError: String(err) },
      );
    }

    throw new UploadError(
      `Failed to access or create assets branch: ${err instanceof Error ? err.message : String(err)}`,
      "BRANCH_ACCESS_FAILED",
      { target, originalError: String(err) },
    );
  }
}

/**
 * Commits a file to the assets branch.
 *
 * @internal
 */
async function commitFile(
  octokit: InstanceType<typeof Octokit>,
  target: UploadTarget,
  filename: string,
  assetPath: string,
  content: string,
  baseSha: string,
): Promise<void> {
  try {
    // Create blob
    const { data: blob } = await octokit.rest.git.createBlob({
      owner: target.owner,
      repo: target.repo,
      content,
      encoding: "base64",
    });

    // Get current tree
    const { data: baseTree } = await octokit.rest.git.getTree({
      owner: target.owner,
      repo: target.repo,
      tree_sha: baseSha,
    });

    // Create new tree with the file
    const { data: tree } = await octokit.rest.git.createTree({
      owner: target.owner,
      repo: target.repo,
      base_tree: baseTree.sha,
      tree: [
        {
          path: assetPath,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        },
      ],
    });

    // Create commit
    const { data: commit } = await octokit.rest.git.createCommit({
      owner: target.owner,
      repo: target.repo,
      message: `Add ${filename}`,
      tree: tree.sha,
      parents: [baseSha],
    });

    // Update branch reference
    await octokit.rest.git.updateRef({
      owner: target.owner,
      repo: target.repo,
      ref: `heads/${BRANCH_NAME}`,
      sha: commit.sha,
    });
  } catch (err) {
    throw new UploadError(
      `Failed to commit file: ${err instanceof Error ? err.message : String(err)}`,
      "FILE_COMMIT_FAILED",
      { filename, target, originalError: String(err) },
    );
  }
}
