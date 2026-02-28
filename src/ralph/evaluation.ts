import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { parseLintWarnings } from "./ci-gating";
import type { CommandCheckResult, LintWarningSummary } from "./ci-gating";
import type { ChecklistItem, FitnessScores } from "./state";

const DEFAULT_EVALUATION_TIMEOUT_MS = 480_000;
const MIN_EVALUATION_TIMEOUT_MS = 180_000;
const MAX_EVALUATION_TIMEOUT_MS = 600_000;

/**
 * Resolve a bounded timeout for the fitness-evaluation session.
 * Using the iteration timeout as a source keeps evaluation behavior aligned with loop configuration.
 */
export function resolveEvaluationTimeoutMs(iterationTimeoutMs: number): number {
  const baseTimeout =
    Number.isFinite(iterationTimeoutMs) && iterationTimeoutMs > 0
      ? iterationTimeoutMs
      : DEFAULT_EVALUATION_TIMEOUT_MS;
  return Math.min(
    MAX_EVALUATION_TIMEOUT_MS,
    Math.max(MIN_EVALUATION_TIMEOUT_MS, baseTimeout),
  );
}

/**
 * Detect the Copilot SDK timeout shape emitted when waiting for session idle.
 */
export function isSessionIdleTimeoutError(error: unknown): boolean {
  const messages = collectErrorMessages(error);
  return messages.some((message) =>
    /(timeout.*session\.idle|session\.idle.*timeout)/i.test(message),
  );
}

/**
 * Extract and parse the first valid fitness-score JSON object from model output.
 * This is resilient to surrounding prose/code fences and skips malformed objects.
 */
export function extractFitnessJsonPayload(
  content: string,
): Record<string, unknown> | null {
  const candidates = [content, ...extractFencedBlocks(content)];
  for (const candidate of candidates) {
    const parsed = extractFirstValidFitnessObject(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function extractFencedBlocks(content: string): string[] {
  const blocks: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match = fenceRegex.exec(content);
  while (match) {
    const body = match[1]?.trim();
    if (body) blocks.push(body);
    match = fenceRegex.exec(content);
  }
  return blocks;
}

function extractFirstValidFitnessObject(
  text: string,
): Record<string, unknown> | null {
  for (const jsonSlice of getJsonObjectSlices(text)) {
    try {
      const parsed = JSON.parse(jsonSlice);
      if (isFitnessPayload(parsed)) return parsed;
    } catch {
      // Keep scanning for later valid objects.
    }
  }
  return null;
}

function* getJsonObjectSlices(text: string): Generator<string> {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (!char) continue;
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) {
          yield text.slice(start, i + 1);
          break;
        }
      }
    }
  }
}

function isFitnessPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return [
    "specCompliance",
    "testCoverage",
    "codeQuality",
    "buildHealth",
    "aggregate",
  ].every((key) => key in raw);
}

function collectErrorMessages(error: unknown, depth = 0): string[] {
  if (depth > 4 || error === null || error === undefined) return [];

  if (typeof error === "string") {
    return [error];
  }

  if (error instanceof Error) {
    return [
      error.message,
      String(error),
      ...collectErrorMessages(error.cause, depth + 1),
    ].filter((value) => value.length > 0);
  }

  if (typeof error === "object") {
    const raw = error as Record<string, unknown>;
    const messages = [
      typeof raw.message === "string" ? raw.message : "",
      typeof raw.error === "string" ? raw.error : "",
      typeof raw.details === "string" ? raw.details : "",
      String(error),
      ...collectErrorMessages(raw.cause, depth + 1),
    ];
    return messages.filter((value) => value.length > 0);
  }

  return [String(error)];
}

const AGGREGATE_WEIGHTS = {
  spec: 0.4,
  tests: 0.25,
  quality: 0.2,
  build: 0.15,
} as const;

export interface AuditSeverityCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

/**
 * Clamp a percentage-like value to the inclusive 0–100 range.
 */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Compute the weighted aggregate score from the four fitness dimensions.
 */
export function computeAggregateScore(
  specScore: number,
  testScore: number,
  codeQuality: number,
  buildHealth: number,
): number {
  const weighted =
    specScore * AGGREGATE_WEIGHTS.spec +
    testScore * AGGREGATE_WEIGHTS.tests +
    codeQuality * AGGREGATE_WEIGHTS.quality +
    buildHealth * AGGREGATE_WEIGHTS.build;
  return clampPercent(weighted);
}

/**
 * Extract vulnerability counts per severity from npm audit output.
 */
export function parseAuditSeverities(output: string): AuditSeverityCounts {
  const counts: AuditSeverityCounts = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
  };

  const prefixRegex = /(\d+)\s+(critical|high|moderate|low)/gi;
  let match: RegExpExecArray | null = prefixRegex.exec(output);
  let matchedPrefix = false;
  while (match) {
    matchedPrefix = true;
    const level = match[2]?.toLowerCase() as
      | keyof AuditSeverityCounts
      | undefined;
    const value = Number(match[1]) || 0;
    if (level) counts[level] += value;
    match = prefixRegex.exec(output);
  }

  if (!matchedPrefix) {
    const suffixRegex = /(critical|high|moderate|low)[^\d]*(\d+)/gi;
    match = suffixRegex.exec(output);
    while (match) {
      const level = match[1]?.toLowerCase() as
        | keyof AuditSeverityCounts
        | undefined;
      const value = Number(match[2]) || 0;
      if (level) counts[level] += value;
      match = suffixRegex.exec(output);
    }
  }

  return counts;
}

const VULNERABILITY_ZERO_REGEX = /found\s+0\s+vulnerabilities/i;

/**
 * Compute code-quality adjustment based on audit output.
 * Rewards zero vulnerabilities (+5) and penalizes per severity (critical=-10, high=-5, moderate/low=-1).
 */
export function computeAuditAdjustment(output: string): number {
  const counts = parseAuditSeverities(output);
  const penalty =
    counts.critical * 10 + counts.high * 5 + (counts.moderate + counts.low) * 1;
  const cappedPenalty = Math.min(penalty, 50);
  const bonus = VULNERABILITY_ZERO_REGEX.test(output) ? 5 : 0;
  return bonus - cappedPenalty;
}

const TEST_PASS_REGEX = /(\d+)\s+passed/i;
const TEST_FAIL_REGEX = /(\d+)\s+failed/i;
const COVERAGE_STMTS_REGEX = /All files\s*\|\s*([\d.]+)/;

interface FallbackCommandResults {
  build: CommandCheckResult;
  test: CommandCheckResult;
  lint: CommandCheckResult;
  audit: CommandCheckResult;
  typecheck: CommandCheckResult;
}

export interface FallbackFitnessScores {
  specCompliance: number;
  testCoverage: number;
  codeQuality: number;
  buildHealth: number;
  aggregate: number;
}

function extractTestCounts(output: string) {
  const passed = Number(TEST_PASS_REGEX.exec(output)?.[1] ?? 0);
  const failed = Number(TEST_FAIL_REGEX.exec(output)?.[1] ?? 0);
  return { passed, failed };
}

function computeFallbackSpecScore(
  build: CommandCheckResult,
  test: CommandCheckResult,
  lint: CommandCheckResult,
  lintSummary: LintWarningSummary,
): number {
  const uniqueRulePenalty = Math.min(
    15,
    Math.floor(lintSummary.uniqueRules / 4) * 3,
  );

  let score = 30;
  score += build.success ? 25 : 0;
  score += test.success ? 25 : 0;
  score += lint.success ? 10 : 5;
  if (lint.success && lintSummary.count === 0) score += 5;
  score -= uniqueRulePenalty;
  if (!build.success) score -= 5;
  if (!test.success) score -= 5;
  if (!lint.success) score -= 5;
  return clampPercent(score);
}

function computeFallbackTestCoverage(test: CommandCheckResult): number {
  const { passed, failed } = extractTestCounts(test.output);
  const total = passed + failed;
  const ratio =
    total === 0 ? (test.success ? 1 : 0) : passed / Math.max(1, total);
  const adjustment = test.success ? 0 : -15;
  // If coverage percentage is available in the output, use it as an additional signal
  const coverageMatch = COVERAGE_STMTS_REGEX.exec(test.output);
  const coveragePct = coverageMatch ? parseFloat(coverageMatch[1] ?? "0") : 0;
  const coverageBonus =
    coveragePct >= 90 ? 10 : coveragePct >= 80 ? 5 : coveragePct >= 60 ? 2 : 0;
  return clampPercent(40 + ratio * 50 + coverageBonus + adjustment);
}

function computeFallbackCodeQuality(
  lint: CommandCheckResult,
  lintSummary: LintWarningSummary,
  auditOutput: string,
): number {
  const warningPenalty = Math.min(
    30,
    Math.floor(lintSummary.uniqueRules / 5) * 10,
  );
  const zeroWarningBonus = lint.success && lintSummary.count === 0 ? 10 : 0;
  const failurePenalty = lint.success ? 0 : 10;
  const auditAdjustment = computeAuditAdjustment(auditOutput);
  // Base score reflects lint outcome: clean pass starts higher
  const base = lint.success ? 65 : 35;
  return clampPercent(
    base - warningPenalty - failurePenalty + zeroWarningBonus + auditAdjustment,
  );
}

/**
 * Build health reflects the full CI pipeline, not just the build step.
 * A fully green CI (build + typecheck + test + lint all pass) earns a higher score.
 */
function computeFallbackBuildHealthScore(
  build: CommandCheckResult,
  typecheck: CommandCheckResult,
  test: CommandCheckResult,
  lint: CommandCheckResult,
): number {
  if (!build.success) return 10;
  if (!typecheck.success) return 20;
  if (!test.success) return 35;
  if (!lint.success) return 55;
  return 85;
}

export function deriveFallbackFitnessScores(
  results: FallbackCommandResults,
): FallbackFitnessScores {
  const lintSummary = parseLintWarnings(results.lint.output);
  const specCompliance = computeFallbackSpecScore(
    results.build,
    results.test,
    results.lint,
    lintSummary,
  );
  const testCoverage = computeFallbackTestCoverage(results.test);
  const codeQuality = computeFallbackCodeQuality(
    results.lint,
    lintSummary,
    results.audit.output,
  );
  const buildHealth = computeFallbackBuildHealthScore(
    results.build,
    results.typecheck,
    results.test,
    results.lint,
  );
  const aggregate = computeAggregateScore(
    specCompliance,
    testCoverage,
    codeQuality,
    buildHealth,
  );
  return {
    specCompliance,
    testCoverage,
    codeQuality,
    buildHealth,
    aggregate,
  };
}

export interface NumericFitnessScores {
  specCompliance: number;
  testCoverage: number;
  codeQuality: number;
  buildHealth: number;
  aggregate: number;
}

const AGGREGATE_SUSPICIOUS_THRESHOLD = 5;
const MIN_COMPUTED_AGGREGATE_FOR_OVERRIDE = 30;
const MIN_FALLBACK_AGGREGATE_FOR_OVERRIDE = 30;
const SPEC_SUSPICIOUS_THRESHOLD = 5;
const MIN_FALLBACK_SPEC_FOR_OVERRIDE = 30;

export function isEvaluationPayloadSuspicious(
  parsed: NumericFitnessScores,
  fallback: FallbackFitnessScores,
): boolean {
  const computedAggregate = computeAggregateScore(
    parsed.specCompliance,
    parsed.testCoverage,
    parsed.codeQuality,
    parsed.buildHealth,
  );
  const aggregateMismatch =
    parsed.aggregate <= AGGREGATE_SUSPICIOUS_THRESHOLD &&
    computedAggregate >= MIN_COMPUTED_AGGREGATE_FOR_OVERRIDE &&
    fallback.aggregate >= MIN_FALLBACK_AGGREGATE_FOR_OVERRIDE;
  const specMismatch =
    parsed.specCompliance <= SPEC_SUSPICIOUS_THRESHOLD &&
    fallback.specCompliance >= MIN_FALLBACK_SPEC_FOR_OVERRIDE;
  return aggregateMismatch || specMismatch;
}

/**
 * Run a fitness evaluation session against the Copilot API.
 *
 * This is the core session lifecycle for fitness scoring:
 * 1. Creates a fresh Copilot session with the evaluation model.
 * 2. Sends the evaluation prompt and waits for completion.
 * 3. Parses the structured JSON response for 4 scoring dimensions:
 *    - specCompliance (0-100): How well code matches specifications
 *    - testCoverage (0-100): Test presence and passing status
 *    - codeQuality (0-100): Code cleanliness, error handling, documentation
 *    - buildHealth (0-100): Build and lint status
 * 4. Returns parsed scores or falls back to derived CI metrics.
 * 5. Retries once on session.idle timeout.
 * 6. Destroys the session unconditionally in a finally block.
 *
 * @spec Ralph-loop/spec.md — Fitness Scoring: Fitness evaluation process
 */
export async function runFitnessEvaluation(
  client: CopilotClient,
  evaluationModel: string,
  evalPrompt: string,
  evaluationTimeoutMs: number,
  fallbackScores: FallbackFitnessScores,
  logFn: (msg: string) => void = () => undefined,
): Promise<FitnessScores> {
  const fallbackNote = "Evaluation failed — using objective CI metrics";
  const suspiciousFallbackNote =
    "Evaluation output unreliable — using objective CI metrics";
  const fallbackResponse = (reason: string): FitnessScores => ({
    ...fallbackScores,
    notes: reason,
    checklist: [],
  });

  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const session = await client.createSession({
      model: evaluationModel,
      onPermissionRequest: approveAll,
    });

    try {
      const response = await session.sendAndWait(
        { prompt: evalPrompt },
        evaluationTimeoutMs,
      );

      const raw = response?.data?.content ?? "";
      const parsedPayload = extractFitnessJsonPayload(raw);
      if (parsedPayload) {
        const parsed = parsedPayload as Partial<FitnessScores>;
        const clamp = (n: unknown): number =>
          Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
        const parsedScores: NumericFitnessScores = {
          specCompliance: clamp(parsed.specCompliance),
          testCoverage: clamp(parsed.testCoverage),
          codeQuality: clamp(parsed.codeQuality),
          buildHealth: clamp(parsed.buildHealth),
          aggregate: clamp(parsed.aggregate),
        };
        const computedAggregate = computeAggregateScore(
          parsedScores.specCompliance,
          parsedScores.testCoverage,
          parsedScores.codeQuality,
          parsedScores.buildHealth,
        );
        if (isEvaluationPayloadSuspicious(parsedScores, fallbackScores)) {
          logFn(
            `Fitness evaluation output suspicious (spec=${parsedScores.specCompliance}/100 aggregate=${parsedScores.aggregate}/100) — using derived fallback`,
          );
          return fallbackResponse(suspiciousFallbackNote);
        }
        const notes =
          typeof parsed.notes === "string" ? parsed.notes : "No notes provided";
        const checklist = Array.isArray(parsed.checklist)
          ? parsed.checklist.map((item) => ({
              requirement: String((item as ChecklistItem).requirement ?? ""),
              score: clamp((item as ChecklistItem).score),
              reasoning: String((item as ChecklistItem).reasoning ?? ""),
            }))
          : [];
        return {
          ...parsedScores,
          aggregate: computedAggregate,
          notes,
          checklist,
        };
      }
      logFn(
        `Fitness evaluation: could not extract JSON from response (len=${raw.length})`,
      );
    } catch (err) {
      if (isSessionIdleTimeoutError(err) && attempt < maxAttempts) {
        logFn(
          `Fitness evaluation timed out after ${evaluationTimeoutMs}ms; retrying once`,
        );
        continue;
      }
      logFn(`Fitness evaluation error: ${err}`);
      // Non-timeout errors are not retried — exit the loop.
      break;
    } finally {
      await session.destroy();
    }
  }

  return fallbackResponse(fallbackNote);
}
