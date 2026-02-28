import type { UploadResult, UploadStrategy, UploadTarget } from "./types.js";
import { NoStrategyAvailableError } from "./types.js";

/**
 * Upload an image using the first available strategy.
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

  throw new NoStrategyAvailableError(tried);
}
