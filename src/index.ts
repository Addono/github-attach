/**
 * gh-attach — Core library for uploading images to GitHub.
 *
 * This module exports the main types and functions for uploading images to GitHub issues and pull requests.
 * It provides a strategy-based interface for multiple upload mechanisms.
 *
 * @example
 * ```typescript
 * import { upload, ReleaseAssetStrategy } from 'gh-attach';
 *
 * const result = await upload('./image.png', {
 *   owner: 'github',
 *   repo: 'docs',
 *   type: 'issue',
 *   number: 42
 * }, [new ReleaseAssetStrategy(token)]);
 *
 * console.log(result.markdown); // ![](https://...)
 * ```
 *
 * @module gh-attach
 */

export type {
  UploadStrategy,
  UploadResult,
  UploadTarget,
} from "./core/types.js";
export { upload } from "./core/upload.js";
