/**
 * Ralph Loop state persistence module.
 *
 * Provides typed state loading, saving, and default construction so the loop
 * can resume across restarts. State is stored in `ralph-state.json` at the
 * repository root.
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { normalizeCiStatus, type CiStatus } from "./ci-gating";

/** A single checklist item from a fitness evaluation. */
export interface ChecklistItem {
  requirement: string;
  score: number;
  reasoning: string;
}

/** Fitness scores from one evaluation run. */
export interface FitnessScores {
  specCompliance: number;
  testCoverage: number;
  codeQuality: number;
  buildHealth: number;
  aggregate: number;
  notes: string;
  checklist: ChecklistItem[];
}

/** One recorded fitness evaluation persisted in state. */
export interface Evaluation {
  iteration: number;
  model: string;
  scores: FitnessScores;
  timestamp: string;
}

/**
 * Full persisted state for the Ralph Loop.
 *
 * Fields are normalised on load so that partial or missing values from older
 * state files degrade gracefully rather than throwing at runtime.
 */
export interface RalphState {
  /** Iteration counter — incremented at the start of each loop cycle. */
  currentIteration: number;
  /** Model currently in use for build iterations. */
  currentModel: string;
  /** GitHub issue number used for fitness tracking; null until created. */
  trackingIssueNumber: number | null;
  /** Ordered list of completed fitness evaluations. */
  evaluations: Evaluation[];
  /** Latest CI run status snapshot. */
  ciStatus: CiStatus;
  /** Timestamp (ms) when CI first broke; null when CI is green. */
  ciBrokenSince: number | null;
  /** Number of consecutive CI-fix attempts so far. */
  ciFixAttempts: number;
  /** Timestamp (ms) of the most recent CI-fix attempt. */
  ciLastFixAttempt: number | null;
  /** Timestamp (ms) when the last CI-blocked notification was posted to GitHub. */
  ciLastBlockedNotification: number | null;
}

/** Path to the state file relative to the working directory. */
export const STATE_FILE = "ralph-state.json";

/**
 * Return a fresh default state with all fields set to safe zero values.
 *
 * Used when no state file exists yet (first run) or when the file cannot be
 * parsed.
 */
export function defaultState(): RalphState {
  return {
    currentIteration: 0,
    currentModel: "",
    trackingIssueNumber: null,
    evaluations: [],
    ciStatus: normalizeCiStatus(undefined),
    ciBrokenSince: null,
    ciFixAttempts: 0,
    ciLastFixAttempt: null,
    ciLastBlockedNotification: null,
  };
}

/**
 * Load and normalise Ralph Loop state from the state file.
 *
 * When the file is absent the function returns `defaultState()`. Unknown or
 * missing fields are replaced with safe defaults so the schema can evolve
 * without breaking existing state files.
 *
 * @param stateFile - Path to the state JSON file (default: `STATE_FILE`).
 * @returns Normalised `RalphState`.
 */
export async function loadState(
  stateFile: string = STATE_FILE,
): Promise<RalphState> {
  if (!existsSync(stateFile)) {
    return defaultState();
  }

  const raw = await readFile(stateFile, "utf-8");
  const parsed = JSON.parse(raw) as Partial<RalphState>;

  return {
    currentIteration:
      typeof parsed.currentIteration === "number" ? parsed.currentIteration : 0,
    currentModel:
      typeof parsed.currentModel === "string" ? parsed.currentModel : "",
    trackingIssueNumber:
      typeof parsed.trackingIssueNumber === "number"
        ? parsed.trackingIssueNumber
        : null,
    evaluations: Array.isArray(parsed.evaluations)
      ? (parsed.evaluations as Evaluation[])
      : [],
    ciStatus: normalizeCiStatus(parsed.ciStatus),
    ciBrokenSince:
      typeof parsed.ciBrokenSince === "number" ? parsed.ciBrokenSince : null,
    ciFixAttempts:
      typeof parsed.ciFixAttempts === "number" ? parsed.ciFixAttempts : 0,
    ciLastFixAttempt:
      typeof parsed.ciLastFixAttempt === "number"
        ? parsed.ciLastFixAttempt
        : null,
    ciLastBlockedNotification:
      typeof parsed.ciLastBlockedNotification === "number"
        ? parsed.ciLastBlockedNotification
        : null,
  };
}

/**
 * Persist Ralph Loop state to disk as JSON.
 *
 * Overwrites the state file atomically (single `writeFile` call). Callers are
 * responsible for serialising concurrent writes.
 *
 * @param state - Current state to persist.
 * @param stateFile - Destination path (default: `STATE_FILE`).
 */
export async function saveState(
  state: RalphState,
  stateFile: string = STATE_FILE,
): Promise<void> {
  await writeFile(stateFile, JSON.stringify(state, null, 2));
}
