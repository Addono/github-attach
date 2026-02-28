import type { UploadResult, UploadStrategy, UploadTarget } from "./types.js";
import { NoStrategyAvailableError } from "./types.js";

/**
 * Upload an image using the first available strategy from the provided list.
 *
 * Tries each strategy in order and uses the first one that is available in the current environment.
 * Falls back through the list until an upload succeeds or all strategies are exhausted.
 *
 * @param filePath Absolute path to the image file to upload
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
  const tried: string[] = [];

  for (const strategy of strategies) {
    if (await strategy.isAvailable()) {
      return strategy.upload(filePath, target);
    }
    tried.push(strategy.name);
  }

  throw new NoStrategyAvailableError(
    `No upload strategy available. Tried: ${tried.join(", ")}`,
    tried.map((name) => ({
      strategy: name,
      reason: "isAvailable() returned false",
    })),
  );
}
