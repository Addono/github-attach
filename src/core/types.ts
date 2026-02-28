/**
 * Core types for gh-attach upload strategies.
 */

export interface UploadTarget {
  owner: string;
  repo: string;
  type: "issue" | "pull";
  number: number;
}

export interface UploadResult {
  url: string;
  markdown: string;
  strategy: string;
}

export interface UploadStrategy {
  name: string;
  upload(filePath: string, target: UploadTarget): Promise<UploadResult>;
  isAvailable(): Promise<boolean>;
}

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

export class AuthenticationError extends GhAttachError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = "AuthenticationError";
  }
}

export class UploadError extends GhAttachError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = "UploadError";
  }
}

export class ValidationError extends GhAttachError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = "ValidationError";
  }
}

export class NoStrategyAvailableError extends GhAttachError {
  constructor(tried: string[]) {
    super(
      `No upload strategy available. Tried: ${tried.join(", ")}`,
      "NO_STRATEGY_AVAILABLE",
      { tried },
    );
    this.name = "NoStrategyAvailableError";
  }
}
