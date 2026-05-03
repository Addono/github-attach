/**
 * gh-attach — Core library for uploading attachments to GitHub.
 *
 * This module exports the main types, error classes, strategy factories, and
 * utility functions for uploading attachments to GitHub issues and pull requests.
 * It provides a strategy-based interface for multiple upload mechanisms.
 *
 * @example
 * ```typescript
 * import { upload, createReleaseAssetStrategy } from 'gh-attach';
 *
 * const strategy = createReleaseAssetStrategy(process.env.GITHUB_TOKEN!);
 * const result = await upload('./image.png', {
 *   owner: 'github',
 *   repo: 'docs',
 *   type: 'issue',
 *   number: 42
 * }, [strategy]);
 *
 * console.log(result.markdown); // ![](https://...) or a bare video URL
 * ```
 *
 * @module gh-attach
 */

// Types
export type {
  UploadStrategy,
  UploadResult,
  UploadTarget,
} from "./core/types.js";

// Error hierarchy
export {
  GhAttachError,
  AuthenticationError,
  UploadError,
  ValidationError,
  NoStrategyAvailableError,
} from "./core/types.js";

// Core upload function
export { upload } from "./core/upload.js";

// Strategy factories
export { createReleaseAssetStrategy } from "./core/strategies/releaseAsset.js";
export { createBrowserSessionStrategy } from "./core/strategies/browserSession.js";
export { createCookieExtractionStrategy } from "./core/strategies/cookieExtraction.js";
export { createRepoBranchStrategy } from "./core/strategies/repoBranch.js";

// Utilities
export { validateFile } from "./core/validation.js";
export { parseTarget } from "./core/target.js";
