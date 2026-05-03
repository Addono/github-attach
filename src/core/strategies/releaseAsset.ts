import { Octokit } from "@octokit/rest";
import { readFileSync } from "fs";
import { basename } from "path";
import { formatAttachmentMarkdown } from "../attachment.js";
import { AuthenticationError, UploadError } from "../types.js";
import type { UploadResult, UploadStrategy, UploadTarget } from "../types.js";

const ASSETS_TAG = "_gh-attach-assets";

function getHttpStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function getResponseHeader(
  err: unknown,
  headerName: string,
): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return undefined;
  const headers = (response as { headers?: unknown }).headers;
  if (typeof headers !== "object" || headers === null) return undefined;

  const key = headerName.toLowerCase();
  const value = (headers as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function isRateLimitError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  if (message.includes("rate limit")) return true;

  const remaining = getResponseHeader(err, "x-ratelimit-remaining");
  return remaining === "0";
}

function getRateLimitReset(err: unknown): number | undefined {
  const reset = getResponseHeader(err, "x-ratelimit-reset");
  if (!reset) return undefined;
  const n = Number(reset);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Release Asset upload strategy using GitHub's official REST API.
 * Uploads attachments as assets to a special release in the repository.
 *
 * @param token GitHub API token with `contents:write` permission
 * @returns UploadStrategy implementation
 */
export function createReleaseAssetStrategy(token: string): UploadStrategy {
  const octokit = new Octokit({ auth: token });

  return {
    name: "release-asset",

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
        // Find or create the assets release
        const release = await findOrCreateAssetsRelease(octokit, target);

        // Upload the file as a release asset
        const filename = basename(filePath);
        const url = await uploadAsset(
          octokit,
          target,
          release.id,
          filePath,
          filename,
        );

        // Generate markdown
        const markdown = formatAttachmentMarkdown(filePath, url);

        return {
          url,
          markdown,
          strategy: "release-asset",
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
          `Release asset upload failed: ${err instanceof Error ? err.message : String(err)}`,
          "RELEASE_ASSET_FAILED",
          { filePath, target, originalError: String(err) },
        );
      }
    },
  };
}

/**
 * Finds or creates the assets release.
 *
 * @internal
 */
async function findOrCreateAssetsRelease(
  octokit: InstanceType<typeof Octokit>,
  target: UploadTarget,
) {
  try {
    const { data: release } = await octokit.rest.repos.getReleaseByTag({
      owner: target.owner,
      repo: target.repo,
      tag: ASSETS_TAG,
    });
    return release;
  } catch (err: unknown) {
    const status = getHttpStatus(err);

    if (status === 404) {
      try {
        const { data: newRelease } = await octokit.rest.repos.createRelease({
          owner: target.owner,
          repo: target.repo,
          tag_name: ASSETS_TAG,
          name: "gh-attach attachments",
          body: "This is a dummy release used by [gh-attach](https://github.com/Addono/gh-attach) as storage for attachment files linked from issues and pull requests.\n\n> [!WARNING]\n> Do not delete this release or its assets — doing so will break attachment links and embeds that reference them.",
          draft: false,
          prerelease: true,
        });
        return newRelease;
      } catch (createErr: unknown) {
        const createStatus = getHttpStatus(createErr);
        const createMessage =
          createErr instanceof Error ? createErr.message : String(createErr);
        const createMessageLower = createMessage.toLowerCase();

        const isCreate401 =
          createStatus === 401 ||
          createMessageLower.includes("401") ||
          createMessageLower.includes("bad credentials");

        const isCreate403 =
          createStatus === 403 ||
          createMessageLower.includes("403") ||
          createMessageLower.includes("forbidden");

        const isCreate422 =
          createStatus === 422 ||
          createMessageLower.includes("422") ||
          createMessageLower.includes("validation failed");

        if (isCreate401) {
          throw new AuthenticationError(
            "GitHub token is invalid or revoked.",
            "INVALID_TOKEN",
            { target, status: createStatus, originalError: String(createErr) },
          );
        }

        if (isCreate403) {
          if (isRateLimitError(createErr)) {
            throw new UploadError(
              "GitHub API rate limit exceeded.",
              "RATE_LIMIT_EXCEEDED",
              {
                target,
                status: createStatus,
                reset: getRateLimitReset(createErr),
                originalError: String(createErr),
              },
            );
          }

          throw new AuthenticationError(
            "Cannot create release: insufficient permissions or repository access.",
            "INSUFFICIENT_PERMISSIONS",
            { target, status: createStatus, originalError: String(createErr) },
          );
        }

        if (isCreate422) {
          throw new UploadError(
            "Cannot create assets release: validation failed.",
            "RELEASE_CREATE_FAILED",
            { target, status: createStatus, originalError: String(createErr) },
          );
        }

        throw new UploadError(
          `Cannot create assets release: ${createErr instanceof Error ? createErr.message : String(createErr)}`,
          "RELEASE_CREATE_FAILED",
          { target, status: createStatus, originalError: String(createErr) },
        );
      }
    }

    if (status === 401) {
      throw new AuthenticationError(
        "GitHub token is invalid or revoked.",
        "INVALID_TOKEN",
        { target, status, originalError: String(err) },
      );
    }

    if (status === 403) {
      if (isRateLimitError(err)) {
        throw new UploadError(
          "GitHub API rate limit exceeded.",
          "RATE_LIMIT_EXCEEDED",
          {
            target,
            status,
            reset: getRateLimitReset(err),
            originalError: String(err),
          },
        );
      }

      throw new AuthenticationError(
        `Insufficient permissions to access releases in ${target.owner}/${target.repo}`,
        "INSUFFICIENT_PERMISSIONS",
        { target, status, originalError: String(err) },
      );
    }

    throw new UploadError(
      `Failed to find or create assets release: ${err instanceof Error ? err.message : String(err)}`,
      "RELEASE_LOOKUP_FAILED",
      { target, status, originalError: String(err) },
    );
  }
}

/**
 * Uploads a file as a release asset.
 *
 * @internal
 */
async function uploadAsset(
  octokit: InstanceType<typeof Octokit>,
  target: UploadTarget,
  releaseId: number,
  filePath: string,
  filename: string,
): Promise<string> {
  const data = readFileSync(filePath);

  try {
    // Check if file already exists and handle collision
    let finalFilename = filename;
    try {
      const { data: assets } = await octokit.rest.repos.listReleaseAssets({
        owner: target.owner,
        repo: target.repo,
        release_id: releaseId,
      });

      const existing = assets.find((a) => a.name === filename);
      if (existing) {
        // Append a hash suffix to avoid collision
        const ext = filename.includes(".")
          ? filename.substring(filename.lastIndexOf("."))
          : "";
        const base = filename.includes(".")
          ? filename.substring(0, filename.lastIndexOf("."))
          : filename;
        const hash = Math.random().toString(36).substring(2, 8);
        finalFilename = `${base}-${hash}${ext}`;
      }
    } catch {
      // Continue with original filename if we can't list assets
    }

    // Octokit's type signature expects string but accepts Buffer for binary uploads
    const { data: asset } = await octokit.rest.repos.uploadReleaseAsset({
      owner: target.owner,
      repo: target.repo,
      release_id: releaseId,
      name: finalFilename,
      // Cast Buffer to string to satisfy TypeScript; Octokit handles Buffer correctly at runtime
      data: data as unknown as string,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": data.length,
      },
    });

    if (!asset.browser_download_url) {
      throw new UploadError(
        "Upload succeeded but no download URL was returned by GitHub. " +
          "The target repository may have been renamed — use the full owner/repo#N target format.",
        "MISSING_DOWNLOAD_URL",
        { filePath, target },
      );
    }

    return asset.browser_download_url;
  } catch (err: unknown) {
    const status = getHttpStatus(err);

    if (status === 401) {
      throw new AuthenticationError(
        "GitHub token is invalid or revoked.",
        "INVALID_TOKEN",
        { target, status, originalError: String(err) },
      );
    }

    if (status === 403 && isRateLimitError(err)) {
      throw new UploadError(
        "GitHub API rate limit exceeded.",
        "RATE_LIMIT_EXCEEDED",
        {
          target,
          status,
          reset: getRateLimitReset(err),
          originalError: String(err),
        },
      );
    }

    throw new UploadError(
      `Failed to upload asset: ${err instanceof Error ? err.message : String(err)}`,
      "ASSET_UPLOAD_FAILED",
      { filePath, target, status, originalError: String(err) },
    );
  }
}
