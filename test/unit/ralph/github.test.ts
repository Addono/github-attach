/**
 * Unit tests for src/ralph/github.ts
 *
 * Verifies Ralph Loop GitHub issue reporting spec requirements:
 * - generateTrendChart renders ASCII bars and aggregate scores
 * - generateModelComparison produces correct averages
 * - generateIssueBody includes trend + history table + comparison
 * - generateCommentBody includes all dimension scores and checklist accordion
 * - postToGitHub creates a tracking issue on first call (no prior issue number)
 * - postToGitHub posts a comment and updates issue body on subsequent calls
 * - postCiBlockedNotification skips when CI is healthy or issue not yet created
 *
 * @spec Ralph-loop/spec.md — GitHub Issue Reporting
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process and fs before importing the module under test
vi.mock("child_process", () => ({
  execSync: vi.fn(() => ""),
}));
vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

import {
  generateTrendChart,
  generateModelComparison,
  generateIssueBody,
  generateCommentBody,
  postToGitHub,
  postCiBlockedNotification,
} from "../../../src/ralph/github";
import { defaultState } from "../../../src/ralph/state";
import type { Evaluation, FitnessScores } from "../../../src/ralph/state";
import type { CiStatus } from "../../../src/ralph/ci-gating";

// --- Fixtures ---

function makeScores(aggregate = 75): FitnessScores {
  return {
    specCompliance: 70,
    testCoverage: 80,
    codeQuality: 75,
    buildHealth: 90,
    aggregate,
    notes: "Looking good",
    checklist: [
      {
        requirement: "Error hierarchy",
        score: 90,
        reasoning: "All error classes present",
      },
      {
        requirement: "Strategy fallback",
        score: 60,
        reasoning: "Partially implemented",
      },
    ],
  };
}

function makeEval(iteration: number, model: string, agg = 75): Evaluation {
  return {
    iteration,
    model,
    scores: makeScores(agg),
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

const healthyCiStatus: CiStatus = {
  passed: true,
  lastCheck: "2026-01-01T00:00:00.000Z",
  buildStatus: "success",
  testStatus: "success",
  lintStatus: "success",
  lintWarningCount: 0,
  lintWarningRules: [],
  lintWarningFiles: [],
};

const brokenCiStatus: CiStatus = {
  passed: false,
  lastCheck: "2026-01-01T00:00:00.000Z",
  buildStatus: "failed",
  testStatus: "failed",
  lintStatus: "failed",
  buildError: "Build failed",
  lintWarningCount: 0,
  lintWarningRules: [],
  lintWarningFiles: [],
};

// --- generateTrendChart ---

describe("generateTrendChart (spec: Ralph Loop GitHub Issue Reporting)", () => {
  it("returns a no-evaluations message when list is empty", () => {
    expect(generateTrendChart([])).toBe("No evaluations yet.");
  });

  it("renders one bar per evaluation with iteration and aggregate", () => {
    const chart = generateTrendChart([makeEval(5, "gpt-4.1", 75)]);
    expect(chart).toContain("Iter   5");
    expect(chart).toContain("75/100");
    expect(chart).toContain("gpt-4.1");
  });

  it("renders multiple evaluations in order", () => {
    const evals = [
      makeEval(5, "gpt-4.1", 60),
      makeEval(10, "claude-haiku-4.5", 80),
    ];
    const chart = generateTrendChart(evals);
    expect(chart.indexOf("Iter   5")).toBeLessThan(chart.indexOf("Iter  10"));
  });

  it("wraps chart in a markdown code fence", () => {
    const chart = generateTrendChart([makeEval(1, "m", 50)]);
    expect(chart).toMatch(/^```/);
    expect(chart).toMatch(/```$/);
  });
});

// --- generateModelComparison ---

describe("generateModelComparison (spec: Ralph Loop GitHub Issue Reporting)", () => {
  it("shows each model with its evaluation count and average", () => {
    const evals = [
      makeEval(1, "gpt-4.1", 60),
      makeEval(2, "gpt-4.1", 80),
      makeEval(3, "claude-haiku-4.5", 70),
    ];
    const table = generateModelComparison(evals);
    expect(table).toContain("gpt-4.1");
    expect(table).toContain("70/100"); // avg of 60 + 80
    expect(table).toContain("claude-haiku-4.5");
  });

  it("returns a markdown table header", () => {
    const table = generateModelComparison([makeEval(1, "m", 50)]);
    expect(table).toContain("| Model | Evals | Avg Score |");
  });
});

// --- generateIssueBody ---

describe("generateIssueBody (spec: Ralph Loop GitHub Issue Reporting — tracking issue body)", () => {
  it("contains trend chart section", () => {
    const body = generateIssueBody([makeEval(5, "gpt-4.1", 75)]);
    expect(body).toContain("## Trend");
    expect(body).toContain("Fitness Trend");
  });

  it("contains evaluation history table row per evaluation", () => {
    const body = generateIssueBody([
      makeEval(5, "gpt-4.1", 75),
      makeEval(10, "claude-haiku-4.5", 80),
    ]);
    expect(body).toContain("| 5 |");
    expect(body).toContain("| 10 |");
  });

  it("contains model comparison section", () => {
    const body = generateIssueBody([makeEval(1, "gpt-4.1", 70)]);
    expect(body).toContain("## Model Comparison");
    expect(body).toContain("gpt-4.1");
  });

  it("includes auto-generated footer", () => {
    expect(generateIssueBody([])).toContain(
      "*Auto-generated by ralph-loop.ts*",
    );
  });
});

// --- generateCommentBody ---

describe("generateCommentBody (spec: Ralph Loop GitHub Issue Reporting — evaluation comment)", () => {
  it("includes all four dimension scores", () => {
    const body = generateCommentBody(
      7,
      "gpt-4.1",
      makeScores(77),
      healthyCiStatus,
    );
    expect(body).toContain("Spec Compliance");
    expect(body).toContain("Test Coverage");
    expect(body).toContain("Code Quality");
    expect(body).toContain("Build Health");
  });

  it("displays the aggregate score prominently", () => {
    const body = generateCommentBody(
      7,
      "gpt-4.1",
      makeScores(77),
      healthyCiStatus,
    );
    expect(body).toContain("77/100");
  });

  it("includes iteration and model in heading", () => {
    const body = generateCommentBody(
      7,
      "gpt-4.1",
      makeScores(77),
      healthyCiStatus,
    );
    expect(body).toContain("Iteration 7");
    expect(body).toContain("gpt-4.1");
  });

  it("renders checklist items in ascending score order (worst first)", () => {
    const body = generateCommentBody(1, "m", makeScores(70), healthyCiStatus);
    const strategyIdx = body.indexOf("Strategy fallback"); // score 60
    const errorIdx = body.indexOf("Error hierarchy"); // score 90
    expect(strategyIdx).toBeLessThan(errorIdx);
  });

  it("shows no-checklist message when checklist is empty", () => {
    const scores = makeScores(70);
    scores.checklist = [];
    const body = generateCommentBody(1, "m", scores, healthyCiStatus);
    expect(body).toContain("No checklist data available");
  });

  it("escapes pipe characters in checklist reasoning", () => {
    const scores = makeScores(70);
    scores.checklist = [
      { requirement: "Req", score: 50, reasoning: "foo | bar" },
    ];
    const body = generateCommentBody(1, "m", scores, healthyCiStatus);
    expect(body).toContain("foo \\| bar");
  });
});

// --- postToGitHub ---

describe("postToGitHub (spec: Ralph Loop GitHub Issue Reporting — create issue + post comment)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("skips posting when trackingRepo is not configured", async () => {
    const logs: string[] = [];
    const state = defaultState();
    await postToGitHub(
      state,
      { trackingRepo: "" },
      makeScores(),
      1,
      "m",
      (msg) => logs.push(msg),
    );
    expect(logs.some((l) => l.includes("skipping"))).toBe(true);
  });

  it("creates tracking issue on first call and captures issue number", async () => {
    const { execSync } = await import("child_process");
    vi.mocked(execSync).mockImplementation((cmd) => {
      const c = String(cmd);
      if (c.includes("issue create"))
        return "https://github.com/owner/repo/issues/42\n";
      return "";
    });

    const state = defaultState();
    state.evaluations = [];

    const logs: string[] = [];
    await postToGitHub(
      state,
      { trackingRepo: "owner/repo" },
      makeScores(),
      1,
      "gpt-4.1",
      (msg, level) => logs.push(`[${level}] ${msg}`),
    );

    expect(state.trackingIssueNumber).toBe(42);
    expect(logs.some((l) => l.includes("Created tracking issue #42"))).toBe(
      true,
    );
  });

  it("posts comment to existing issue without creating a new one", async () => {
    const { execSync } = await import("child_process");
    const cmds: string[] = [];
    vi.mocked(execSync).mockImplementation((cmd) => {
      cmds.push(String(cmd));
      return "";
    });

    const state = defaultState();
    state.trackingIssueNumber = 5;
    state.evaluations = [];

    await postToGitHub(
      state,
      { trackingRepo: "owner/repo" },
      makeScores(),
      3,
      "claude-haiku-4.5",
    );

    // Should NOT have called issue create
    expect(cmds.some((c) => c.includes("issue create"))).toBe(false);
  });

  it("logs error and does not throw when gh command fails", async () => {
    const { execSync } = await import("child_process");
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("gh: command not found");
    });

    const logs: string[] = [];
    const state = defaultState();
    // Should not throw
    await expect(
      postToGitHub(
        state,
        { trackingRepo: "owner/repo" },
        makeScores(),
        1,
        "m",
        (msg, level) => logs.push(`[${level}] ${msg}`),
      ),
    ).resolves.not.toThrow();
    expect(logs.some((l) => l.includes("Failed to post to GitHub"))).toBe(true);
  });
});

// --- postCiBlockedNotification ---

describe("postCiBlockedNotification (spec: Ralph Loop GitHub Issue Reporting — CI blocked notification)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("skips when trackingRepo is empty", async () => {
    const state = defaultState();
    state.trackingIssueNumber = 1;
    state.ciStatus = brokenCiStatus;
    await expect(
      postCiBlockedNotification(state, { trackingRepo: "" }, 5),
    ).resolves.not.toThrow();
    expect(state.ciLastBlockedNotification).toBeNull();
  });

  it("skips when CI is not broken", async () => {
    const state = defaultState();
    state.trackingIssueNumber = 1;
    state.ciStatus = healthyCiStatus;
    await postCiBlockedNotification(state, { trackingRepo: "o/r" }, 5);
    expect(state.ciLastBlockedNotification).toBeNull();
  });

  it("skips when no tracking issue exists yet", async () => {
    const state = defaultState();
    state.trackingIssueNumber = null;
    state.ciStatus = brokenCiStatus;
    await postCiBlockedNotification(state, { trackingRepo: "o/r" }, 5);
    expect(state.ciLastBlockedNotification).toBeNull();
  });

  it("skips when notification already sent for this iteration", async () => {
    const state = defaultState();
    state.trackingIssueNumber = 1;
    state.ciStatus = brokenCiStatus;
    state.ciLastBlockedNotification = 5;
    await postCiBlockedNotification(state, { trackingRepo: "o/r" }, 5);
    expect(state.ciLastBlockedNotification).toBe(5);
  });

  it("records notification iteration when successfully posted", async () => {
    const { execSync } = await import("child_process");
    vi.mocked(execSync).mockImplementation(() => "");

    const state = defaultState();
    state.trackingIssueNumber = 1;
    state.ciStatus = brokenCiStatus;

    await postCiBlockedNotification(state, { trackingRepo: "o/r" }, 7);
    expect(state.ciLastBlockedNotification).toBe(7);
  });
});
