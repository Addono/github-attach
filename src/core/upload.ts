import type { UploadResult, UploadStrategy, UploadTarget } from "./types.js";
import {
  AuthenticationError,
  NoStrategyAvailableError,
  UploadError,
} from "./types.js";

/**
 * Upload a supported attachment using the first available strategy from the provided list.
 *
 * Tries each strategy in order and uses the first one that uploads successfully.
 * Falls back through the list when a strategy is unavailable or when an available
 * strategy fails with an authentication or upload error.
 *
 * @param filePath Absolute path to the file to upload
 * @param target The target issue or pull request
 * @param strategies List of upload strategies to try, in priority order
 * @returns Upload result with URL and markdown
 * @throws {NoStrategyAvailableError} If no strategy is available in the current environment
 * @throws {UploadError} If the upload fails
 * @throws {ValidationError} If the file is invalid
 * @throws {AuthenticationError} If authentication is required or expired
 */
export async function upload(
  filePath: string,
  target: UploadTarget,
  strategies: UploadStrategy[],
): Promise<UploadResult> {
  const unavailable: Array<{ strategy: string; reason: string }> = [];
  const failed: Array<{
    strategy: string;
    reason: string;
    error: AuthenticationError | UploadError;
  }> = [];

  for (const strategy of strategies) {
    if (!(await strategy.isAvailable())) {
      unavailable.push({
        strategy: strategy.name,
        reason: "isAvailable() returned false",
      });
      continue;
    }

    try {
      return await strategy.upload(filePath, target);
    } catch (error) {
      if (
        error instanceof AuthenticationError ||
        error instanceof UploadError
      ) {
        failed.push({
          strategy: strategy.name,
          reason: error.message,
          error,
        });
        continue;
      }

      throw error;
    }
  }

  if (failed.length > 0) {
    const firstFailure = failed[0];
    if (failed.length === 1 && unavailable.length === 0 && firstFailure) {
      throw firstFailure.error;
    }

    const tried = [
      ...unavailable,
      ...failed.map(({ strategy, reason }) => ({ strategy, reason })),
    ];

    throw new UploadError(
      `All available upload strategies failed. Tried: ${tried.map(({ strategy, reason }) => `${strategy}: ${reason}`).join("; ")}`,
      "UPLOAD_FAILED",
      {
        tried: tried.map(({ strategy, reason }) => `${strategy}: ${reason}`),
      },
    );
  }

  throw new NoStrategyAvailableError(
    `No upload strategy available. Tried: ${unavailable.map(({ strategy }) => strategy).join(", ")}`,
    unavailable,
  );
}
