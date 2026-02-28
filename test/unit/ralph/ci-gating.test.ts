/**
 * Unit tests for src/ralph/ci-gating.ts
 *
 * Verifies CI Gating spec requirements:
 * - CI health tracking: build/test/lint outputs are parsed and stored
 * - CI status persistence: CiStatus shape matches ralph-state.json schema
 * - CI gating logic: RED CI blocks feature work; GREEN CI allows it
 * - Partial CI failure: lint warnings produce ⚠️ prompt guidance
 * - Fitness impact: isCiBroken() correctly detects blocking failures
 *
 * @spec CI-gating/spec.md — CI Status Tracking, CI Gating Logic, Fitness Impact
 */

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

// ── CI Status Tracking (spec: CI-gating/spec.md — CI Health Tracking) ────────

describe("deriveCiStatus — spec: CI Status Tracking", () => {
  it("stores all three check outcomes in the CiStatus object (spec: CI health tracking)", () => {
    const { status } = deriveCiStatus(
      { success: true, output: "build ok" },
      { success: true, output: "484 tests passed" },
      { success: true, output: "" },
      "2026-02-01T00:00:00.000Z",
    );
    expect(status.buildStatus).toBe("success");
    expect(status.testStatus).toBe("success");
    expect(status.lintStatus).toBe("success");
    expect(status.passed).toBe(true);
    expect(status.lastCheck).toBe("2026-02-01T00:00:00.000Z");
  });

  it("marks CI as failed when test step fails (spec: CI health tracking)", () => {
    const { status } = deriveCiStatus(
      { success: true, output: "build ok" },
      { success: false, output: "2 tests failed" },
      { success: true, output: "" },
    );
    expect(status.testStatus).toBe("failed");
    expect(status.passed).toBe(false);
    expect(isCiBroken(status)).toBe(true);
  });

  it("marks CI as failed when lint step fails (spec: CI health tracking)", () => {
    const { status } = deriveCiStatus(
      { success: true, output: "build ok" },
      { success: true, output: "tests pass" },
      { success: false, output: "3 errors" },
    );
    expect(status.lintStatus).toBe("failed");
    expect(status.passed).toBe(false);
    expect(isCiBroken(status)).toBe(true);
  });

  it("CiStatus shape matches the ralph-state.json ciStatus schema (spec: CI status persistence)", () => {
    const { status } = deriveCiStatus(
      { success: false, output: "build error: TypeScript compile failed" },
      { success: true, output: "" },
      { success: true, output: "" },
      "2026-03-01T12:00:00.000Z",
    );
    // Verify all required fields from the CI-gating spec schema are present
    expect(typeof status.passed).toBe("boolean");
    expect(typeof status.lastCheck).toBe("string");
    expect(["success", "failed", "skipped"]).toContain(status.buildStatus);
    expect(["success", "failed", "skipped"]).toContain(status.testStatus);
    expect(["success", "warnings", "failed", "skipped"]).toContain(
      status.lintStatus,
    );
  });
});

// ── CI Gating Logic (spec: CI-gating/spec.md — Green CI / Red CI scenarios) ──

describe("generateCiPromptContext — spec: CI Gating Logic (GREEN / RED / PARTIAL)", () => {
  it("GREEN CI: permits feature work with ✅ message (spec: Green CI — proceed with feature work)", () => {
    const ci = {
      ...defaultCiStatus(),
      lastCheck: "2026-02-01T00:00:00.000Z",
      buildStatus: "success" as const,
      testStatus: "success" as const,
      lintStatus: "success" as const,
    };
    const ctx = generateCiPromptContext(ci);
    expect(ctx).toContain("✅ All checks pass");
    expect(ctx).not.toContain("Do not work on new features");
  });

  it("RED CI: blocks feature work with ❌ message (spec: Red CI — prioritize fixes)", () => {
    const ci = {
      ...defaultCiStatus(),
      lastCheck: "2026-02-01T00:00:00.000Z",
      passed: false,
      buildStatus: "failed" as const,
      buildError: "TypeScript compile failed at src/foo.ts:10",
    };
    const ctx = generateCiPromptContext(ci);
    expect(ctx).toContain("❌");
    expect(ctx).toContain("Do not work on new features");
    expect(ctx).toContain("EXCLUSIVELY on fixing the failing CI");
  });

  it("PARTIAL CI: lint warnings show ⚠️ without blocking (spec: Partial CI failure)", () => {
    const ci = {
      ...defaultCiStatus(),
      lastCheck: "2026-02-01T00:00:00.000Z",
      lintStatus: "warnings" as const,
      lintWarningCount: 12,
    };
    const ctx = generateCiPromptContext(ci);
    expect(ctx).toContain("⚠️");
    expect(ctx).toContain("12 warnings");
    expect(ctx).not.toContain("Do not work on new features");
  });

  it("returns empty string when no CI check has run yet (no lastCheck)", () => {
    const ci = defaultCiStatus();
    expect(generateCiPromptContext(ci)).toBe("");
  });
});

// ── Fitness Impact (spec: CI-gating/spec.md — Fitness Impact) ─────────────────

describe("isCiBroken — spec: Fitness Impact (buildHealth clamping signal)", () => {
  it("returns true for build failure — triggers buildHealth ≤ 30 clamp in evaluator", () => {
    expect(isCiBroken({ ...defaultCiStatus(), buildStatus: "failed" })).toBe(
      true,
    );
  });

  it("returns true for test failure — signals blocked state to fitness evaluator", () => {
    expect(isCiBroken({ ...defaultCiStatus(), testStatus: "failed" })).toBe(
      true,
    );
  });

  it("returns true for lint failure", () => {
    expect(isCiBroken({ ...defaultCiStatus(), lintStatus: "failed" })).toBe(
      true,
    );
  });

  it("returns false for lint warnings — warnings do not block feature work", () => {
    expect(
      isCiBroken({
        ...defaultCiStatus(),
        lintStatus: "warnings",
        lintWarningCount: 5,
      }),
    ).toBe(false);
  });

  it("returns false when all checks pass", () => {
    const ci = {
      ...defaultCiStatus(),
      buildStatus: "success" as const,
      testStatus: "success" as const,
      lintStatus: "success" as const,
    };
    expect(isCiBroken(ci)).toBe(false);
  });
});
