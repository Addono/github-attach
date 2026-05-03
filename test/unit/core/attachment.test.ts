import { describe, expect, it } from "vitest";
import {
  formatAttachmentMarkdown,
  getFileExtension,
  isSupportedFormat,
  isVideoAttachment,
} from "../../../src/core/attachment.js";

describe("attachment helpers", () => {
  it("extracts lowercase extensions", () => {
    expect(getFileExtension("/tmp/clip.MP4")).toBe("mp4");
  });

  it("returns undefined when a file has no extension", () => {
    expect(getFileExtension("/tmp/clip")).toBeUndefined();
  });

  it("recognizes supported image and video formats", () => {
    expect(isSupportedFormat("png")).toBe(true);
    expect(isSupportedFormat("mp4")).toBe(true);
    expect(isSupportedFormat("txt")).toBe(false);
  });

  it("detects video attachments by extension", () => {
    expect(isVideoAttachment("/tmp/clip.webm")).toBe(true);
    expect(isVideoAttachment("/tmp/image.png")).toBe(false);
  });

  it("formats images as markdown embeds", () => {
    expect(
      formatAttachmentMarkdown(
        "/tmp/image.png",
        "https://example.com/image.png",
      ),
    ).toBe("![image.png](https://example.com/image.png)");
  });

  it("formats videos as bare URLs", () => {
    expect(
      formatAttachmentMarkdown("/tmp/demo.mp4", "https://example.com/demo.mp4"),
    ).toBe("https://example.com/demo.mp4");
  });
});
