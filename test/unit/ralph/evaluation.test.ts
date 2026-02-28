import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clampPercent,
  computeAggregateScore,
  computeAuditAdjustment,
  deriveFallbackFitnessScores,
  extractFitnessJsonPayload,
  isEvaluationPayloadSuspicious,
  isSessionIdleTimeoutError,
  parseAuditSeverities,
  resolveEvaluationTimeoutMs,
  runFitnessEvaluation,
} from "../../../src/ralph/evaluation";
import type { CommandCheckResult } from "../../../src/ralph/ci-gating";
import type {
  FallbackFitnessScores,
  NumericFitnessScores,
} from "../../../src/ralph/evaluation";

// Mock @github/copilot-sdk for runFitnessEvaluation tests
const mockSession = {
  sendAndWait: vi.fn(),
  destroy: vi.fn(),
};
const mockClient = {
  createSession: vi.fn(),
};
vi.mock("@github/copilot-sdk", () => ({
  approveAll: vi.fn(),
  CopilotClient: vi.fn(() => mockClient),
}));
import type { CopilotClient } from "@github/copilot-sdk";

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
    typecheck: makeCommandResult({ output: "Typecheck succeeded" }),
  });

  it("returns meaningful scores when CI passes with no warnings", () => {
    const scores = deriveFallbackFitnessScores(createBaseResults());
    expect(scores.aggregate).toBeGreaterThanOrEqual(88);
    expect(scores.testCoverage).toBeGreaterThanOrEqual(90);
    expect(scores.buildHealth).toBe(85);
  });

  it("scores buildHealth lower when tests fail but build passes", () => {
    const results = {
      ...createBaseResults(),
      test: makeCommandResult({
        success: false,
        output: "Tests 0 passed 3 failed",
      }),
    };
    const scores = deriveFallbackFitnessScores(results);
    expect(scores.buildHealth).toBe(35);
  });

  it("scores buildHealth lower when lint fails but build and test pass", () => {
    const results = {
      ...createBaseResults(),
      lint: makeCommandResult({ success: false, output: "5 errors" }),
    };
    const scores = deriveFallbackFitnessScores(results);
    expect(scores.buildHealth).toBe(55);
  });

  it("uses coverage percentage for testCoverage bonus", () => {
    const withCoverage = deriveFallbackFitnessScores({
      ...createBaseResults(),
      test: makeCommandResult({
        output:
          "Tests 100 passed\nAll files |   97.5 |   92.76 |    100 |   97.5 |",
      }),
    });
    const withoutCoverage = deriveFallbackFitnessScores({
      ...createBaseResults(),
      test: makeCommandResult({ output: "Tests 100 passed" }),
    });
    expect(withCoverage.testCoverage).toBeGreaterThan(
      withoutCoverage.testCoverage,
    );
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

  it("punishes buildHealth when typecheck fails even though other stages pass", () => {
    const base = deriveFallbackFitnessScores(createBaseResults());
    const degraded = deriveFallbackFitnessScores({
      ...createBaseResults(),
      typecheck: makeCommandResult({
        success: false,
        output: "typecheck failed: error TS2345",
      }),
    });
    expect(degraded.buildHealth).toBe(20);
    expect(degraded.aggregate).toBeLessThan(base.aggregate);
  });
});

describe("isEvaluationPayloadSuspicious", () => {
  const fallback: FallbackFitnessScores = {
    aggregate: 84,
    specCompliance: 85,
    testCoverage: 88,
    codeQuality: 82,
    buildHealth: 80,
  };

  it("flags placeholder aggregates despite healthy metrics", () => {
    const parsed: NumericFitnessScores = {
      specCompliance: 80,
      testCoverage: 85,
      codeQuality: 75,
      buildHealth: 70,
      aggregate: 0,
    };
    expect(isEvaluationPayloadSuspicious(parsed, fallback)).toBe(true);
  });

  it("flags zero spec compliance when fallback indicates coverage", () => {
    const parsed: NumericFitnessScores = {
      specCompliance: 0,
      testCoverage: 60,
      codeQuality: 60,
      buildHealth: 60,
      aggregate: 50,
    };
    expect(isEvaluationPayloadSuspicious(parsed, fallback)).toBe(true);
  });

  it("ignores reasonable scores", () => {
    const parsed: NumericFitnessScores = {
      specCompliance: 32,
      testCoverage: 25,
      codeQuality: 40,
      buildHealth: 20,
      aggregate: 30,
    };
    expect(isEvaluationPayloadSuspicious(parsed, fallback)).toBe(false);
  });
});

// ── runFitnessEvaluation — spec: Ralph Loop Fitness Scoring ──────────────────

function makeFallback(
  overrides: Partial<FallbackFitnessScores> = {},
): FallbackFitnessScores {
  return {
    specCompliance: 70,
    testCoverage: 80,
    codeQuality: 75,
    buildHealth: 85,
    aggregate: 77,
    ...overrides,
  };
}

function makeValidScoreJSON(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    specCompliance: 80,
    testCoverage: 85,
    codeQuality: 75,
    buildHealth: 90,
    aggregate: 82,
    notes: "All systems green",
    checklist: [
      {
        requirement: "Error Hierarchy",
        score: 90,
        reasoning: "All error classes present",
      },
    ],
    ...overrides,
  });
}

describe("runFitnessEvaluation — spec: Ralph Loop Fitness Scoring dimensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.createSession.mockResolvedValue(mockSession);
    mockSession.destroy.mockResolvedValue(undefined);
  });

  it("creates a session with the evaluation model (spec: lightweight model for scoring)", async () => {
    mockSession.sendAndWait.mockResolvedValue({
      data: { content: makeValidScoreJSON() },
    });
    await runFitnessEvaluation(
      mockClient as unknown as CopilotClient,
      "claude-haiku-4.5",
      "evaluate this",
      30_000,
      makeFallback(),
    );
    expect(mockClient.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4.5" }),
    );
  });

  it("parses specCompliance, testCoverage, codeQuality, buildHealth from JSON response (spec: 4 scoring dimensions)", async () => {
    mockSession.sendAndWait.mockResolvedValue({
      data: {
        content: makeValidScoreJSON({
          specCompliance: 85,
          testCoverage: 90,
          codeQuality: 70,
          buildHealth: 95,
        }),
      },
    });
    const result = await runFitnessEvaluation(
      mockClient as unknown as CopilotClient,
      "claude-haiku-4.5",
      "evaluate this",
      30_000,
      makeFallback(),
    );
    expect(result.specCompliance).toBe(85);
    expect(result.testCoverage).toBe(90);
    expect(result.codeQuality).toBe(70);
    expect(result.buildHealth).toBe(95);
  });

  it("computes weighted aggregate score: spec 40%, tests 25%, quality 20%, build 15% (spec: aggregate weighted average)", async () => {
    mockSession.sendAndWait.mockResolvedValue({
      data: {
        content: makeValidScoreJSON({
          specCompliance: 80,
          testCoverage: 80,
          codeQuality: 80,
          buildHealth: 80,
          aggregate: 50, // Provided aggregate is overridden by computed value
        }),
      },
    });
    const result = await runFitnessEvaluation(
      mockClient as unknown as CopilotClient,
      "claude-haiku-4.5",
      "evaluate this",
      30_000,
      makeFallback(),
    );
    // computeAggregateScore(80, 80, 80, 80) = 80
    expect(result.aggregate).toBe(80);
  });

  it("returns checklist items from evaluation response (spec: checklist traversal)", async () => {
    mockSession.sendAndWait.mockResolvedValue({
      data: {
        content: makeValidScoreJSON({
          checklist: [
            {
              requirement: "Loop Core",
              score: 85,
              reasoning: "loop.ts exists",
            },
            {
              requirement: "Model Rotation",
              score: 90,
              reasoning: "modelSelection.ts present",
            },
          ],
        }),
      },
    });
    const result = await runFitnessEvaluation(
      mockClient as unknown as CopilotClient,
      "claude-haiku-4.5",
      "evaluate this",
      30_000,
      makeFallback(),
    );
    expect(result.checklist).toHaveLength(2);
    expect(result.checklist[0]?.requirement).toBe("Loop Core");
  });

  it("falls back to CI-derived metrics when model returns no valid JSON (spec: fallback scoring)", async () => {
    mockSession.sendAndWait.mockResolvedValue({
      data: { content: "Sorry, I cannot score this." },
    });
    const fallback = makeFallback({ specCompliance: 60, aggregate: 71 });
    const result = await runFitnessEvaluation(
      mockClient as unknown as CopilotClient,
      "claude-haiku-4.5",
      "evaluate this",
      30_000,
      fallback,
    );
    expect(result.specCompliance).toBe(60);
    expect(result.aggregate).toBe(71);
    expect(result.notes).toContain("Evaluation failed");
  });

  it("destroys the session unconditionally (spec: destroy session after evaluation)", async () => {
    mockSession.sendAndWait.mockResolvedValue({
      data: { content: makeValidScoreJSON() },
    });
    await runFitnessEvaluation(
      mockClient as unknown as CopilotClient,
      "claude-haiku-4.5",
      "evaluate this",
      30_000,
      makeFallback(),
    );
    expect(mockSession.destroy).toHaveBeenCalledOnce();
  });

  it("destroys the session even when sendAndWait throws (spec: destroy session on error)", async () => {
    mockSession.sendAndWait.mockRejectedValue(new Error("Network error"));
    await runFitnessEvaluation(
      mockClient as unknown as CopilotClient,
      "claude-haiku-4.5",
      "evaluate this",
      30_000,
      makeFallback(),
    );
    expect(mockSession.destroy).toHaveBeenCalledOnce();
  });

  it("retries once on session.idle timeout and returns result on second attempt (spec: retry on timeout)", async () => {
    const timeoutErr = new Error(
      "Timeout after 300000ms waiting for session.idle",
    );
    mockSession.sendAndWait
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce({ data: { content: makeValidScoreJSON() } });
    mockClient.createSession.mockResolvedValue(mockSession);
    const result = await runFitnessEvaluation(
      mockClient as unknown as CopilotClient,
      "claude-haiku-4.5",
      "evaluate this",
      30_000,
      makeFallback(),
    );
    expect(mockSession.sendAndWait).toHaveBeenCalledTimes(2);
    expect(result.aggregate).toBeGreaterThan(0);
  });
});
