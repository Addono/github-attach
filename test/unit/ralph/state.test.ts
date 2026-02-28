/**
 * Unit tests for src/ralph/state.ts
 *
 * Verifies state persistence spec requirements:
 * - defaultState() returns all expected zero values
 * - loadState() returns defaultState when file is absent
 * - loadState() normalises partial/missing fields from disk
 * - saveState() writes valid JSON that can be round-tripped
 *
 * @spec Ralph-loop/spec.md — State Persistence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  defaultState,
  loadState,
  saveState,
  type RalphState,
} from "../../../src/ralph/state";

// --- Helpers ---

let tmpDir: string;
let stateFile: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-state-test-"));
  stateFile = join(tmpDir, "ralph-state.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// --- defaultState ---

describe("defaultState (spec: Ralph Loop State Persistence)", () => {
  it("returns zeroed iteration counter", () => {
    expect(defaultState().currentIteration).toBe(0);
  });

  it("returns empty model string", () => {
    expect(defaultState().currentModel).toBe("");
  });

  it("returns null trackingIssueNumber", () => {
    expect(defaultState().trackingIssueNumber).toBeNull();
  });

  it("returns empty evaluations array", () => {
    expect(defaultState().evaluations).toEqual([]);
  });

  it("returns null CI broken/fix timestamps", () => {
    const s = defaultState();
    expect(s.ciBrokenSince).toBeNull();
    expect(s.ciFixAttempts).toBe(0);
    expect(s.ciLastFixAttempt).toBeNull();
    expect(s.ciLastBlockedNotification).toBeNull();
  });
});

// --- loadState ---

describe("loadState (spec: Ralph Loop State Persistence — resume logic)", () => {
  it("returns defaultState when no file exists", async () => {
    const state = await loadState(stateFile);
    expect(state).toEqual(defaultState());
  });

  it("loads full state from disk correctly", async () => {
    const saved: RalphState = {
      currentIteration: 12,
      currentModel: "claude-haiku-4.5",
      trackingIssueNumber: 42,
      evaluations: [
        {
          iteration: 5,
          model: "gpt-4.1",
          scores: {
            specCompliance: 70,
            testCoverage: 80,
            codeQuality: 75,
            buildHealth: 90,
            aggregate: 78,
            notes: "Good progress",
            checklist: [],
          },
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
      ciStatus: {
        passed: true,
        lastCheck: "2026-01-01T00:00:00.000Z",
        buildStatus: "success",
        testStatus: "success",
        lintStatus: "success",
        lintWarningCount: 0,
        lintWarningRules: [],
        lintWarningFiles: [],
      },
      ciBrokenSince: null,
      ciFixAttempts: 0,
      ciLastFixAttempt: null,
      ciLastBlockedNotification: null,
    };
    writeFileSync(stateFile, JSON.stringify(saved, null, 2));

    const loaded = await loadState(stateFile);
    expect(loaded.currentIteration).toBe(12);
    expect(loaded.currentModel).toBe("claude-haiku-4.5");
    expect(loaded.trackingIssueNumber).toBe(42);
    expect(loaded.evaluations).toHaveLength(1);
    expect(loaded.evaluations[0]?.scores.aggregate).toBe(78);
  });

  it("uses zero defaults for missing numeric fields", async () => {
    writeFileSync(stateFile, JSON.stringify({ trackingIssueNumber: 7 }));
    const state = await loadState(stateFile);
    expect(state.currentIteration).toBe(0);
    expect(state.currentModel).toBe("");
    expect(state.trackingIssueNumber).toBe(7);
    expect(state.evaluations).toEqual([]);
    expect(state.ciFixAttempts).toBe(0);
  });

  it("normalises unknown CI status fields", async () => {
    writeFileSync(stateFile, JSON.stringify({ ciStatus: { passed: false } }));
    const state = await loadState(stateFile);
    expect(state.ciStatus.passed).toBe(false);
    // All other fields should be defaulted rather than throwing
    expect(typeof state.ciStatus.lastCheck).toBe("string");
  });

  it("preserves ciBrokenSince timestamp on load", async () => {
    const ts = Date.now();
    writeFileSync(stateFile, JSON.stringify({ ciBrokenSince: ts }));
    const state = await loadState(stateFile);
    expect(state.ciBrokenSince).toBe(ts);
  });
});

// --- saveState ---

describe("saveState (spec: Ralph Loop State Persistence — save/load round-trip)", () => {
  it("writes JSON that can be round-tripped through loadState", async () => {
    const original = defaultState();
    original.currentIteration = 7;
    original.currentModel = "gpt-5.1";
    original.trackingIssueNumber = 99;

    await saveState(original, stateFile);
    const loaded = await loadState(stateFile);

    expect(loaded.currentIteration).toBe(7);
    expect(loaded.currentModel).toBe("gpt-5.1");
    expect(loaded.trackingIssueNumber).toBe(99);
  });

  it("overwrites an existing state file", async () => {
    const first = defaultState();
    first.currentIteration = 1;
    await saveState(first, stateFile);

    const second = defaultState();
    second.currentIteration = 99;
    await saveState(second, stateFile);

    const loaded = await loadState(stateFile);
    expect(loaded.currentIteration).toBe(99);
  });

  it("writes human-readable indented JSON", async () => {
    const { readFile } = await import("fs/promises");
    await saveState(defaultState(), stateFile);
    const raw = await readFile(stateFile, "utf-8");
    // Pretty-printed JSON has newlines and spaces
    expect(raw).toMatch(/\n/);
    expect(raw).toMatch(/"currentIteration": 0/);
  });
});
