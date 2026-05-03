import { promises as fs } from "fs";
import {
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  SUPPORTED_FORMATS,
  getFileExtension,
  isSupportedFormat,
} from "./attachment.js";
import { ValidationError } from "./types.js";

/**
 * Validates that a file exists, has a supported format, and is within size limits.
 *
 * @param filePath Path to the file to validate
 * @throws ValidationError with code FILE_NOT_FOUND if file doesn't exist
 * @throws ValidationError with code UNSUPPORTED_FORMAT if format is not supported
 * @throws ValidationError with code FILE_TOO_LARGE if file exceeds the size limit
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
  const ext = getFileExtension(filePath);
  if (!isSupportedFormat(ext)) {
    throw new ValidationError(
      `Unsupported file format: ${ext || "(no extension)"}. Supported: ${SUPPORTED_FORMATS.join(", ")}`,
      "UNSUPPORTED_FORMAT",
      { filePath, format: ext, supported: [...SUPPORTED_FORMATS] },
    );
  }

  // Check size
  if (stats.size > MAX_FILE_SIZE) {
    throw new ValidationError(
      `File too large: ${stats.size} bytes exceeds ${MAX_FILE_SIZE_MB}MB limit`,
      "FILE_TOO_LARGE",
      { filePath, size: stats.size, maxSize: MAX_FILE_SIZE },
    );
  }
}
