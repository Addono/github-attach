import { describe, it, expect } from "vitest";
import { upload } from "../../../src/core/upload.js";
import {
  AuthenticationError,
  NoStrategyAvailableError,
  UploadError,
  type UploadStrategy,
  type UploadTarget,
} from "../../../src/core/types.js";

const mockTarget: UploadTarget = {
  owner: "testowner",
  repo: "testrepo",
  type: "issue",
  number: 1,
};

function createMockStrategy(
  name: string,
  available: boolean,
  url = "https://example.com/img.png",
): UploadStrategy {
  return {
    name,
    async isAvailable() {
      return available;
    },
    async upload(filePath, _target) {
      return {
        url,
        markdown: `![${filePath}](${url})`,
        strategy: name,
      };
    },
  };
}

describe("upload", () => {
  it("uses the first available strategy", async () => {
    const strategies = [
      createMockStrategy("unavailable", false),
      createMockStrategy("available", true, "https://img.github.com/a.png"),
    ];

    const result = await upload("test.png", mockTarget, strategies);
    expect(result.strategy).toBe("available");
    expect(result.url).toBe("https://img.github.com/a.png");
  });

  it("falls back when the first available strategy upload fails", async () => {
    const strategies: UploadStrategy[] = [
      {
        name: "browser-session",
        async isAvailable() {
          return true;
        },
        async upload() {
          throw new UploadError("Saved session is expired.", "SESSION_EXPIRED");
        },
      },
      createMockStrategy(
        "release-asset",
        true,
        "https://img.github.com/release.png",
      ),
    ];

    const result = await upload("test.png", mockTarget, strategies);
    expect(result.strategy).toBe("release-asset");
    expect(result.url).toBe("https://img.github.com/release.png");
  });

  it("throws NoStrategyAvailableError when no strategy is available", async () => {
    const strategies = [
      createMockStrategy("s1", false),
      createMockStrategy("s2", false),
    ];

    await expect(upload("test.png", mockTarget, strategies)).rejects.toThrow(
      NoStrategyAvailableError,
    );
  });

  it("returns correct markdown format", async () => {
    const strategies = [createMockStrategy("test", true)];
    const result = await upload("screenshot.png", mockTarget, strategies);
    expect(result.markdown).toContain("![screenshot.png]");
  });

  describe("spec compliance — strategy selection and fallback", () => {
    it("tries strategies in order and uses first available (automatic fallback)", async () => {
      const s1 = createMockStrategy("browser-session", false);
      const s2 = createMockStrategy("cookie-extraction", false);
      const s3 = createMockStrategy(
        "release-asset",
        true,
        "https://release.github.com/img.png",
      );
      const s4 = createMockStrategy("repo-branch", true);

      const result = await upload("test.png", mockTarget, [s1, s2, s3, s4]);
      // Should use s3 (first available), not s4
      expect(result.strategy).toBe("release-asset");
    });

    it("aggregates errors when every available strategy fails", async () => {
      const error = await upload("test.png", mockTarget, [
        {
          name: "browser-session",
          async isAvailable() {
            return true;
          },
          async upload() {
            throw new AuthenticationError(
              "Saved session is expired.",
              "SESSION_EXPIRED",
            );
          },
        },
        {
          name: "release-asset",
          async isAvailable() {
            return true;
          },
          async upload() {
            throw new UploadError(
              "Cannot create assets release: validation failed.",
              "RELEASE_CREATE_FAILED",
            );
          },
        },
      ]).catch((e) => e);

      expect(error).toBeInstanceOf(UploadError);
      expect(error.message).toContain("All available upload strategies failed");
      expect(error.message).toContain(
        "browser-session: Saved session is expired.",
      );
      expect(error.message).toContain(
        "release-asset: Cannot create assets release: validation failed.",
      );
      const tried = (error.details as { tried: string[] }).tried;
      expect(tried).toContain("browser-session: Saved session is expired.");
      expect(tried).toContain(
        "release-asset: Cannot create assets release: validation failed.",
      );
    });

    it("throws NoStrategyAvailableError listing all tried strategies when all are unavailable", async () => {
      const strategies = [
        createMockStrategy("browser-session", false),
        createMockStrategy("cookie-extraction", false),
        createMockStrategy("release-asset", false),
        createMockStrategy("repo-branch", false),
      ];

      const error = await upload("test.png", mockTarget, strategies).catch(
        (e) => e,
      );
      expect(error).toBeInstanceOf(NoStrategyAvailableError);
      // details.tried lists each strategy name with its reason
      const tried = (error.details as { tried: string[] }).tried;
      expect(tried.some((t: string) => t.startsWith("browser-session"))).toBe(
        true,
      );
      expect(tried.some((t: string) => t.startsWith("release-asset"))).toBe(
        true,
      );
      expect(tried).toHaveLength(4);
    });

    it("uses empty strategies list to trigger NoStrategyAvailableError (fallback exhaustion)", async () => {
      const error = await upload("test.png", mockTarget, []).catch((e) => e);
      expect(error).toBeInstanceOf(NoStrategyAvailableError);
    });
  });
});
