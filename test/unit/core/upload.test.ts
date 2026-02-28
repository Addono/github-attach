import { describe, it, expect } from "vitest";
import { upload } from "../../../src/core/upload.js";
import {
  NoStrategyAvailableError,
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
});
