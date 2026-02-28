import { describe, expect, it } from "vitest";
import {
  clampPercent,
  computeAggregateScore,
  computeAuditAdjustment,
  deriveFallbackFitnessScores,
  extractFitnessJsonPayload,
  isSessionIdleTimeoutError,
  parseAuditSeverities,
  resolveEvaluationTimeoutMs,
} from "../../../src/ralph/evaluation";
import type { CommandCheckResult } from "../../../src/ralph/ci-gating";

describe("resolveEvaluationTimeoutMs", () => {
  it("clamps to minimum when timeout is too low", () => {
    expect(resolveEvaluationTimeoutMs(60_000)).toBe(180_000);
  });

  it("uses provided timeout when in supported range", () => {
    expect(resolveEvaluationTimeoutMs(300_000)).toBe(300_000);
  });

  it("clamps to maximum when timeout is too high", () => {
    expect(resolveEvaluationTimeoutMs(900_000)).toBe(600_000);
  });

  it("uses default when timeout is invalid", () => {
    expect(resolveEvaluationTimeoutMs(Number.NaN)).toBe(480_000);
  });
});

describe("isSessionIdleTimeoutError", () => {
  it("detects session idle timeout errors", () => {
    const err = new Error("Timeout after 180000ms waiting for session.idle");
    expect(isSessionIdleTimeoutError(err)).toBe(true);
  });

  it("detects timeout errors from plain strings", () => {
    expect(
      isSessionIdleTimeoutError(
        "Timeout after 180000ms waiting for session.idle",
      ),
    ).toBe(true);
  });

  it("detects timeout errors nested under cause", () => {
    const err = {
      message: "request failed",
      cause: new Error("Timeout after 180000ms waiting for session.idle"),
    };
    expect(isSessionIdleTimeoutError(err)).toBe(true);
  });

  it("returns false for non-timeout errors", () => {
    expect(isSessionIdleTimeoutError(new Error("Network failure"))).toBe(false);
  });
});

describe("extractFitnessJsonPayload", () => {
  it("parses plain JSON payloads", () => {
    const raw = JSON.stringify({
      specCompliance: 80,
      testCoverage: 85,
      codeQuality: 90,
      buildHealth: 95,
      aggregate: 87,
      notes: "ok",
      checklist: [],
    });
    expect(extractFitnessJsonPayload(raw)?.aggregate).toBe(87);
  });

  it("extracts JSON from fenced blocks with surrounding text", () => {
    const raw = [
      "Here are your scores:",
      "```json",
      '{"specCompliance":70,"testCoverage":60,"codeQuality":65,"buildHealth":75,"aggregate":68,"notes":"x","checklist":[]}',
      "```",
      "Done.",
    ].join("\n");
    expect(extractFitnessJsonPayload(raw)?.specCompliance).toBe(70);
  });

  it("skips malformed JSON objects and finds the next valid payload", () => {
    const raw = [
      'noise {"not":"fitness"}',
      '{"specCompliance": bad-json }',
      '{"specCompliance":88,"testCoverage":89,"codeQuality":90,"buildHealth":91,"aggregate":90,"notes":"good","checklist":[]}',
    ].join("\n");
    expect(extractFitnessJsonPayload(raw)?.buildHealth).toBe(91);
  });

  it("returns null when no valid fitness payload is present", () => {
    expect(extractFitnessJsonPayload('{"hello":"world"}')).toBeNull();
  });
});

describe("clampPercent", () => {
  it("rounds and clamps values inside range", () => {
    expect(clampPercent(72.4)).toBe(72);
    expect(clampPercent(72.6)).toBe(73);
  });

  it("clamps values outside 0-100", () => {
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(123.7)).toBe(100);
  });
});

describe("computeAggregateScore", () => {
  it("weights the dimensions correctly", () => {
    expect(computeAggregateScore(80, 70, 70, 50)).toBe(71);
  });

  it("always stays within 0-100", () => {
    expect(computeAggregateScore(200, 200, 200, 200)).toBe(100);
    expect(computeAggregateScore(0, 0, 0, 0)).toBe(0);
  });
});

describe("parseAuditSeverities", () => {
  it("extracts counts per severity", () => {
    const summary = parseAuditSeverities(
      "found 3 vulnerabilities (1 high, 2 moderate, 4 low)",
    );
    expect(summary).toEqual({
      critical: 0,
      high: 1,
      moderate: 2,
      low: 4,
    });
  });

  it("ignores missing severities", () => {
    const summary = parseAuditSeverities("found 0 vulnerabilities");
    expect(summary).toEqual({
      critical: 0,
      high: 0,
      moderate: 0,
      low: 0,
    });
  });
});

describe("computeAuditAdjustment", () => {
  it("rewards zero vulnerabilities", () => {
    expect(computeAuditAdjustment("found 0 vulnerabilities")).toBe(5);
  });

  it("penalizes severities", () => {
    expect(
      computeAuditAdjustment("found 2 vulnerabilities (1 high, 1 low)"),
    ).toBe(-6);
  });

  it("caps penalties at 50", () => {
    const highVolumeOutput = "found 200 vulnerabilities (50 critical, 50 high)";
    expect(computeAuditAdjustment(highVolumeOutput)).toBe(-50);
  });
});

describe("deriveFallbackFitnessScores", () => {
  const makeCommandResult = (
    overrides: Partial<CommandCheckResult> = {},
  ): CommandCheckResult => ({
    success: overrides.success ?? true,
    output: overrides.output ?? "",
  });

  const createBaseResults = () => ({
    build: makeCommandResult({ output: "Build succeeded" }),
    test: makeCommandResult({ output: "Tests 3 passed" }),
    lint: makeCommandResult({ output: "" }),
    audit: makeCommandResult({ output: "found 0 vulnerabilities" }),
  });

  it("returns meaningful scores when CI passes with no warnings", () => {
    const scores = deriveFallbackFitnessScores(createBaseResults());
    expect(scores.aggregate).toBeGreaterThanOrEqual(88);
    expect(scores.testCoverage).toBe(100);
    expect(scores.buildHealth).toBe(65);
  });

  it("penalizes code quality for lint warnings across unique rules", () => {
    const baseline = deriveFallbackFitnessScores(createBaseResults());
    const warningRules = [
      "rule-one",
      "rule-two",
      "rule-three",
      "rule-four",
      "rule-five",
    ];
    const warningOutput = warningRules
      .map(
        (rule, index) =>
          `src/file-${index}.ts:1:1 warning sample warning  ${rule}`,
      )
      .join("\n");
    const degraded = deriveFallbackFitnessScores({
      ...createBaseResults(),
      lint: makeCommandResult({ output: warningOutput }),
    });
    expect(degraded.codeQuality).toBeLessThan(baseline.codeQuality);
  });

  it("reduces test coverage when tests fail despite some passes", () => {
    const baseline = deriveFallbackFitnessScores(createBaseResults());
    const failed = deriveFallbackFitnessScores({
      ...createBaseResults(),
      test: makeCommandResult({
        success: false,
        output: "Tests 2 passed 1 failed",
      }),
    });
    expect(failed.testCoverage).toBeLessThan(baseline.testCoverage);
    expect(failed.aggregate).toBeLessThan(baseline.aggregate);
  });

  it("applies audit penalties to code quality when vulnerabilities exist", () => {
    const baseline = deriveFallbackFitnessScores(createBaseResults());
    const vulnerable = deriveFallbackFitnessScores({
      ...createBaseResults(),
      audit: makeCommandResult({
        output: "found 3 vulnerabilities (1 critical, 1 high, 1 low)",
      }),
    });
    expect(vulnerable.codeQuality).toBeLessThan(baseline.codeQuality);
  });
});
