import { promises as fs } from "fs";
import { ValidationError } from "./types.js";

/**
 * Supported image formats for GitHub uploads.
 */
const SUPPORTED_FORMATS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "mp4",
  "mov",
  "webm",
]);

/**
 * Maximum file size for GitHub uploads: 25MB (GitHub's limit for video).
 */
const MAX_FILE_SIZE = 25 * 1024 * 1024;

/**
 * Validates that a file exists, has a supported format, and is within size limits.
 *
 * @param filePath Path to the file to validate
 * @throws ValidationError with code FILE_NOT_FOUND if file doesn't exist
 * @throws ValidationError with code UNSUPPORTED_FORMAT if format is not supported
 * @throws ValidationError with code FILE_TOO_LARGE if file exceeds 10MB
 */
export async function validateFile(filePath: string): Promise<void> {
  // Check file exists
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new ValidationError(`File not found: ${filePath}`, "FILE_NOT_FOUND", {
      filePath,
    });
  }

  // Check format
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext || !SUPPORTED_FORMATS.has(ext)) {
    throw new ValidationError(
      `Unsupported file format: ${ext || "(no extension)"}. Supported: ${Array.from(SUPPORTED_FORMATS).join(", ")}`,
      "UNSUPPORTED_FORMAT",
      { filePath, format: ext, supported: Array.from(SUPPORTED_FORMATS) },
    );
  }

  // Check size
  if (stats.size > MAX_FILE_SIZE) {
    throw new ValidationError(
      `File too large: ${stats.size} bytes exceeds 10MB limit`,
      "FILE_TOO_LARGE",
      { filePath, size: stats.size, maxSize: MAX_FILE_SIZE },
    );
  }
}
