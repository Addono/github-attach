import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { validateFile } from "../../../src/core/validation.js";
import { ValidationError } from "../../../src/core/types.js";
import * as os from "os";
import * as path from "path";

describe("validateFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-validate-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("accepts PNG files", async () => {
    const filePath = path.join(tempDir, "test.png");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("accepts JPG files", async () => {
    const filePath = path.join(tempDir, "test.jpg");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("accepts JPEG files", async () => {
    const filePath = path.join(tempDir, "test.jpeg");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("accepts GIF files", async () => {
    const filePath = path.join(tempDir, "test.gif");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("accepts SVG files", async () => {
    const filePath = path.join(tempDir, "test.svg");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("accepts WebP files", async () => {
    const filePath = path.join(tempDir, "test.webp");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("accepts MP4 files", async () => {
    const filePath = path.join(tempDir, "test.mp4");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("accepts MOV files", async () => {
    const filePath = path.join(tempDir, "test.mov");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("accepts WEBM files", async () => {
    const filePath = path.join(tempDir, "test.webm");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("accepts uppercase extensions", async () => {
    const filePath = path.join(tempDir, "test.PNG");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("throws FILE_NOT_FOUND for missing file", async () => {
    const filePath = path.join(tempDir, "nonexistent.png");
    try {
      await validateFile(filePath);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("FILE_NOT_FOUND");
      expect((err as ValidationError).details?.filePath).toBe(filePath);
    }
  });

  it("throws UNSUPPORTED_FORMAT for .txt files", async () => {
    const filePath = path.join(tempDir, "test.txt");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    try {
      await validateFile(filePath);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("UNSUPPORTED_FORMAT");
      expect((err as ValidationError).message).toContain("txt");
    }
  });

  it("throws UNSUPPORTED_FORMAT for .pdf files", async () => {
    const filePath = path.join(tempDir, "test.pdf");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    try {
      await validateFile(filePath);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("UNSUPPORTED_FORMAT");
    }
  });

  it("throws UNSUPPORTED_FORMAT for file with no extension", async () => {
    const filePath = path.join(tempDir, "testfile");
    await fs.writeFile(filePath, Buffer.alloc(1000));
    try {
      await validateFile(filePath);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("UNSUPPORTED_FORMAT");
    }
  });

  it("throws FILE_TOO_LARGE for files exceeding 25MB", async () => {
    const filePath = path.join(tempDir, "large.png");
    const size = 26 * 1024 * 1024; // 26MB
    const file = await fs.open(filePath, "w");
    await file.write(Buffer.alloc(1024 * 1024), 0, 1024 * 1024, 0);
    await file.truncate(size);
    await file.close();

    try {
      await validateFile(filePath);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("FILE_TOO_LARGE");
      expect((err as ValidationError).details?.size).toBeGreaterThan(
        25 * 1024 * 1024,
      );
    }
  });

  it("accepts files at 25MB boundary", async () => {
    const filePath = path.join(tempDir, "boundary.png");
    const size = 25 * 1024 * 1024;
    const file = await fs.open(filePath, "w");
    await file.truncate(size);
    await file.close();

    await expect(validateFile(filePath)).resolves.toBeUndefined();
  });

  it("provides supported formats in details on unsupported format error", async () => {
    const filePath = path.join(tempDir, "test.xyz");
    await fs.writeFile(filePath, Buffer.alloc(100));
    try {
      await validateFile(filePath);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const details = (err as ValidationError).details as Record<
        string,
        unknown
      >;
      expect(Array.isArray(details.supported)).toBe(true);
      expect((details.supported as string[]).includes("png")).toBe(true);
      expect((details.supported as string[]).includes("mp4")).toBe(true);
    }
  });
});
