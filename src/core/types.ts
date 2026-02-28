/**
 * Core types for gh-attach upload strategies.
 */

/**
 * Represents a target location for uploading an image (an issue or pull request).
 */
export interface UploadTarget {
  /** GitHub repository owner */
  owner: string;
  /** GitHub repository name */
  repo: string;
  /** Target type: issue or pull request */
  type: "issue" | "pull";
  /** Target number (issue/PR number) */
  number: number;
}

/**
 * Result of a successful image upload.
 */
export interface UploadResult {
  /** Direct URL to the uploaded image */
  url: string;
  /** Markdown markdown format: `![](url)` */
  markdown: string;
  /** Name of the strategy used */
  strategy: string;
}

/**
 * Abstract interface for upload strategies.
 * Implementations provide different mechanisms to upload images to GitHub.
 */
export interface UploadStrategy {
  /** Unique identifier for this strategy (e.g., "release-asset", "browser-session") */
  name: string;
  /**
   * Upload an image file to the specified target location.
   *
   * @param filePath Absolute path to the image file to upload
   * @param target The target issue or pull request
   * @returns Upload result with URL and markdown
   * @throws {UploadError} If the upload fails
   * @throws {ValidationError} If the file is invalid
   * @throws {AuthenticationError} If authentication is required or expired
   */
  upload(filePath: string, target: UploadTarget): Promise<UploadResult>;
  /**
   * Check whether this strategy can be used in the current environment.
   *
   * @returns true if the strategy's requirements are met (dependencies installed, auth available, etc.)
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Base error class for all gh-attach errors.
 * Includes error code and optional details for debugging.
 */
export class GhAttachError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GhAttachError";
  }
}

/**
 * Thrown when authentication fails or credentials are invalid.
 *
 * Error codes include:
 * - `SESSION_EXPIRED` — Browser session cookie has expired
 * - `INVALID_TOKEN` — GitHub token is invalid or revoked
 * - `INSUFFICIENT_PERMISSIONS` — Token lacks required permissions
 */
export class AuthenticationError extends GhAttachError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>,
  ) {
    super(message, code, details);
    this.name = "AuthenticationError";
  }
}

/**
 * Thrown when an upload operation fails.
 *
 * Error codes include:
 * - `UPLOAD_FAILED` — General upload failure
 * - `CSRF_EXTRACTION_FAILED` — Failed to extract CSRF token from HTML
 * - `FILE_NOT_FOUND` — Upload file does not exist
 * - `RATE_LIMIT_EXCEEDED` — GitHub API rate limit hit
 */
export class UploadError extends GhAttachError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>,
  ) {
    super(message, code, details);
    this.name = "UploadError";
  }
}

/**
 * Thrown when input validation fails.
 *
 * Error codes include:
 * - `FILE_TOO_LARGE` — File exceeds size limit
 * - `UNSUPPORTED_FORMAT` — Image format is not supported
 * - `INVALID_TARGET` — Target format is malformed
 */
export class ValidationError extends GhAttachError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>,
  ) {
    super(message, code, details);
    this.name = "ValidationError";
  }
}

/**
 * Thrown when no upload strategy is available.
 * Lists what strategies were tried and why each was unavailable.
 */
export class NoStrategyAvailableError extends GhAttachError {
  constructor(
    message: string,
    tried: Array<{ strategy: string; reason: string }>,
  ) {
    super(message, "NO_STRATEGY_AVAILABLE", {
      tried: tried.map((t) => `${t.strategy}: ${t.reason}`),
    });
    this.name = "NoStrategyAvailableError";
  }
}
