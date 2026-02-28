import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { upload } from "../../../src/core/upload.js";
import { createReleaseAssetStrategy } from "../../../src/core/strategies/releaseAsset.js";

import type { HttpFixture } from "./mswFixture.js";
import { createFixtureHandlers } from "./mswFixture.js";

import { releaseAssetFirstUploadSuccess } from "../../fixtures/release-asset/firstUploadSuccess.js";
import { releaseAssetError401InvalidToken } from "../../fixtures/release-asset/error401InvalidToken.js";
import { releaseAssetError403RateLimit } from "../../fixtures/release-asset/error403RateLimit.js";
import { releaseAssetError422Validation } from "../../fixtures/release-asset/error422Validation.js";
import { releaseAssetError500ServerError } from "../../fixtures/release-asset/error500ServerError.js";

const server = setupServer();

function makeTempPng(filename = "test-image.png"): {
  dir: string;
  filePath: string;
} {
  const dir = join(tmpdir(), `gh-attach-msw-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);

  // Minimal PNG header bytes
  writeFileSync(
    filePath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

  return { dir, filePath };
}

function cleanupTempFile(filePath: string) {
  try {
    unlinkSync(filePath);
  } catch {
    // ignore
  }
}

describe("core integration: release-asset strategy (msw fixtures)", () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it("replays first-upload success fixture and returns the final URL", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fixture = releaseAssetFirstUploadSuccess satisfies HttpFixture;

    const replay = createFixtureHandlers(fixture, calls);
    server.use(...replay.handlers);

    const { filePath } = makeTempPng("test-image.png");

    try {
      const target = {
        owner: "testowner",
        repo: "testrepo",
        type: "issue" as const,
        number: 1,
      };

      const strategy = createReleaseAssetStrategy("test-token");
      const result = await upload(filePath, target, [strategy]);

      expect(result.strategy).toBe("release-asset");
      expect(result.url).toBe(
        "https://github.com/testowner/testrepo/releases/download/_gh-attach-assets/test-image.png",
      );

      expect(replay.remainingCount()).toBe(0);
      expect(calls).toHaveLength(fixture.interactions.length);
    } finally {
      cleanupTempFile(filePath);
    }
  });

  it("replays 401 invalid token and throws AuthenticationError(INVALID_TOKEN)", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fixture = releaseAssetError401InvalidToken satisfies HttpFixture;

    const replay = createFixtureHandlers(fixture, calls);
    server.use(...replay.handlers);

    const { filePath } = makeTempPng("test-image.png");

    try {
      const target = {
        owner: "testowner",
        repo: "testrepo",
        type: "issue" as const,
        number: 1,
      };

      const strategy = createReleaseAssetStrategy("invalid-token");

      await expect(strategy.upload(filePath, target)).rejects.toMatchObject({
        name: "AuthenticationError",
        code: "INVALID_TOKEN",
      });

      expect(replay.remainingCount()).toBe(0);
      expect(calls).toHaveLength(fixture.interactions.length);
    } finally {
      cleanupTempFile(filePath);
    }
  });

  it("replays 403 rate limit and throws UploadError(RATE_LIMIT_EXCEEDED)", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fixture = releaseAssetError403RateLimit satisfies HttpFixture;

    const replay = createFixtureHandlers(fixture, calls);
    server.use(...replay.handlers);

    const { filePath } = makeTempPng("test-image.png");

    try {
      const target = {
        owner: "testowner",
        repo: "testrepo",
        type: "issue" as const,
        number: 1,
      };

      const strategy = createReleaseAssetStrategy("test-token");

      await expect(strategy.upload(filePath, target)).rejects.toMatchObject({
        name: "UploadError",
        code: "RATE_LIMIT_EXCEEDED",
      });

      expect(replay.remainingCount()).toBe(0);
      expect(calls).toHaveLength(fixture.interactions.length);
    } finally {
      cleanupTempFile(filePath);
    }
  });

  it("replays 422 validation and throws UploadError(RELEASE_CREATE_FAILED)", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fixture = releaseAssetError422Validation satisfies HttpFixture;

    const replay = createFixtureHandlers(fixture, calls);
    server.use(...replay.handlers);

    const { filePath } = makeTempPng("test-image.png");

    try {
      const target = {
        owner: "testowner",
        repo: "testrepo",
        type: "issue" as const,
        number: 1,
      };

      const strategy = createReleaseAssetStrategy("test-token");

      await expect(strategy.upload(filePath, target)).rejects.toMatchObject({
        name: "UploadError",
        code: "RELEASE_CREATE_FAILED",
      });

      expect(replay.remainingCount()).toBe(0);
      expect(calls).toHaveLength(fixture.interactions.length);
    } finally {
      cleanupTempFile(filePath);
    }
  });

  it("replays 500 server error and throws UploadError(RELEASE_LOOKUP_FAILED)", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fixture = releaseAssetError500ServerError satisfies HttpFixture;

    const replay = createFixtureHandlers(fixture, calls);
    server.use(...replay.handlers);

    const { filePath } = makeTempPng("test-image.png");

    try {
      const target = {
        owner: "testowner",
        repo: "testrepo",
        type: "issue" as const,
        number: 1,
      };

      const strategy = createReleaseAssetStrategy("test-token");

      await expect(strategy.upload(filePath, target)).rejects.toMatchObject({
        name: "UploadError",
        code: "RELEASE_LOOKUP_FAILED",
      });

      expect(replay.remainingCount()).toBe(0);
      expect(calls).toHaveLength(fixture.interactions.length);
    } finally {
      cleanupTempFile(filePath);
    }
  });
});
