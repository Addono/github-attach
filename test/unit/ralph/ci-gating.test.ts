import { describe, expect, it } from "vitest";
import {
  defaultCiStatus,
  deriveCiStatus,
  generateCiBlockedComment,
  generateCiCommentSummary,
  generateCiPromptContext,
  isCiBroken,
  normalizeCiStatus,
  parseLintWarnings,
} from "../../../src/ralph/ci-gating";

describe("parseLintWarnings", () => {
  it("extracts warning count, rules, and files", () => {
    const output = [
      "src/a.ts:1:1  warning  Unexpected any  @typescript-eslint/no-explicit-any",
      "src/a.ts:2:1  warning  Unexpected any  @typescript-eslint/no-explicit-any",
      "src/b.ts:3:1  warning  Use const  prefer-const",
    ].join("\n");

    const summary = parseLintWarnings(output);

    expect(summary.count).toBe(3);
    expect(summary.topRules[0]).toBe("@typescript-eslint/no-explicit-any");
    expect(summary.topFiles[0]).toBe("src/a.ts");
  });
});

describe("deriveCiStatus", () => {
  it("marks lint warnings as partial but passing", () => {
    const { status } = deriveCiStatus(
      { success: true, output: "build ok" },
      { success: true, output: "test ok" },
      {
        success: true,
        output:
          "src/a.ts:1:1  warning  Unexpected any  @typescript-eslint/no-explicit-any",
      },
      "2026-01-01T00:00:00.000Z",
    );

    expect(status.passed).toBe(true);
    expect(status.lintStatus).toBe("warnings");
    expect(status.lintWarningCount).toBe(1);
  });

  it("marks CI broken when build fails", () => {
    const { status } = deriveCiStatus(
      { success: false, output: "build failed" },
      { success: true, output: "test ok" },
      { success: true, output: "" },
    );

    expect(isCiBroken(status)).toBe(true);
    expect(status.buildStatus).toBe("failed");
  });
});

describe("prompt and comment helpers", () => {
  it("renders blocked prompt guidance", () => {
    const ci = {
      ...defaultCiStatus(),
      lastCheck: "2026-01-01T00:00:00.000Z",
      passed: false,
      buildStatus: "failed" as const,
      buildError: "TypeScript compile failed",
    };
    expect(generateCiPromptContext(ci)).toContain(
      "Do not work on new features",
    );
    expect(generateCiCommentSummary(ci)).toContain("❌ CI");
    expect(generateCiBlockedComment(7, ci)).toContain(
      "CI BLOCKED at Iteration 7",
    );
  });

  it("normalizes partial state input safely", () => {
    const ci = normalizeCiStatus({
      lintWarningCount: 5,
      lintStatus: "warnings",
    });
    expect(ci.lintWarningCount).toBe(5);
    expect(ci.lintStatus).toBe("warnings");
    expect(ci.buildStatus).toBe("skipped");
  });
});
