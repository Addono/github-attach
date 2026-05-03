import { basename, extname } from "path";

/**
 * Supported still-image attachment formats.
 */
const IMAGE_FORMATS = ["png", "jpg", "jpeg", "gif", "svg", "webp"] as const;

/**
 * Supported video attachment formats.
 */
const VIDEO_FORMATS = ["mp4", "mov", "webm"] as const;

/**
 * Supported attachment formats for GitHub uploads.
 */
export const SUPPORTED_FORMATS = [...IMAGE_FORMATS, ...VIDEO_FORMATS] as const;

const SUPPORTED_FORMAT_SET = new Set<string>(SUPPORTED_FORMATS);
const VIDEO_FORMAT_SET = new Set<string>(VIDEO_FORMATS);

/**
 * Maximum file size accepted during local validation before upload strategies run.
 */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

/**
 * Maximum file size in megabytes.
 */
export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);

/**
 * Resolve a lowercase extension from a path.
 */
export function getFileExtension(filePath: string): string | undefined {
  const extension = extname(filePath).slice(1).toLowerCase();
  return extension || undefined;
}

/**
 * Check whether a file extension is supported for upload.
 */
export function isSupportedFormat(extension: string | undefined): boolean {
  return extension !== undefined && SUPPORTED_FORMAT_SET.has(extension);
}

/**
 * Check whether a path refers to a video attachment.
 */
export function isVideoAttachment(filePath: string): boolean {
  const extension = getFileExtension(filePath);
  return extension !== undefined && VIDEO_FORMAT_SET.has(extension);
}

/**
 * Build GitHub-flavored markdown output for an uploaded attachment.
 *
 * Videos are returned as bare URLs because GitHub only renders inline players
 * when the attachment URL is not wrapped in image syntax.
 */
export function formatAttachmentMarkdown(
  filePath: string,
  url: string,
): string {
  if (isVideoAttachment(filePath)) {
    return url;
  }

  return `![${basename(filePath)}](${url})`;
}
