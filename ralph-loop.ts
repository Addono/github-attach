import { readFile, writeFile } from "fs/promises";
import { existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
  CopilotClient,
  approveAll,
  type SessionEvent,
} from "@github/copilot-sdk";
import {
  isSessionIdleTimeoutError,
  resolveEvaluationTimeoutMs,
} from "./src/ralph/evaluation.ts";
import {
  deriveCiStatus,
  generateCiBlockedComment,
  generateCiCommentSummary,
  generateCiPromptContext,
  isCiBroken,
  normalizeCiStatus,
  type CiStatus,
  type CommandCheckResult,
} from "./src/ralph/ci-gating.ts";

// --- Types ---

interface RalphConfig {
  maxIterations: number;
  evaluationInterval: number;
  /** Regular models rotated through each build iteration */
  models: string[];
  /** Premium models used when progress stalls */
  premiumModels: string[];
  /** Number of consecutive evaluations with no improvement before switching to a premium model */
  stallWindow: number;
  /** Minimum aggregate score gain across stallWindow evals to NOT be considered stalled */
  stallThreshold: number;
  evaluationModel: string;
  trackingRepo: string;
  timeout: number;
}

interface ChecklistItem {
  requirement: string;
  score: number;
  reasoning: string;
}

interface FitnessScores {
  specCompliance: number;
  testCoverage: number;
  codeQuality: number;
  buildHealth: number;
  aggregate: number;
  notes: string;
  checklist: ChecklistItem[];
}

interface Evaluation {
  iteration: number;
  model: string;
  scores: FitnessScores;
  timestamp: string;
}

interface RalphState {
  currentIteration: number;
  currentModel: string;
  trackingIssueNumber: number | null;
  evaluations: Evaluation[];
  ciStatus: CiStatus;
  ciBrokenSince: number | null;
  ciFixAttempts: number;
  ciLastFixAttempt: number | null;
  ciLastBlockedNotification: number | null;
}

type Mode = "plan" | "build";

// --- State management ---

const STATE_FILE = "ralph-state.json";
const CONFIG_FILE = "ralph-config.json";
const LOG_FILE = "ralph-loop.log";

async function loadConfig(): Promise<RalphConfig> {
  const raw = await readFile(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as RalphConfig;
}

function defaultState(): RalphState {
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

async function loadState(): Promise<RalphState> {
  if (existsSync(STATE_FILE)) {
    const raw = await readFile(STATE_FILE, "utf-8");
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
  return defaultState();
}

async function saveState(state: RalphState): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

type LogLevel = "INFO" | "DEBUG" | "WARN" | "ERROR" | "EVAL" | "GITHUB" | "ITER" | "MODEL";

function log(message: string, level: LogLevel = "INFO"): void {
  const lines = message.split("\n");
  const first = `[${new Date().toISOString()}] [${level}] ${lines[0]}\n`;
  const rest = lines
    .slice(1)
    .filter((l) => l.trim() !== "")
    .map((l) => `  | ${l}\n`)
    .join("");
  const entry = first + rest;
  process.stdout.write(entry);
  try {
    execSync(`printf '%b' ${JSON.stringify(entry)} >> ${LOG_FILE}`);
  } catch {
    // Best-effort logging
  }
}

// --- Model rotation with stall detection ---

function selectModel(
  evaluations: Evaluation[],
  config: RalphConfig,
  currentModel: string,
): string {
  const allModels = [...config.models, ...config.premiumModels];

  // Stall detection: if last stallWindow evals show < stallThreshold improvement, escalate
  if (evaluations.length >= config.stallWindow) {
    const recent = evaluations.slice(-config.stallWindow);
    const best = Math.max(...recent.map((e) => e.scores.aggregate));
    const worst = Math.min(...recent.map((e) => e.scores.aggregate));
    if (best - worst < config.stallThreshold) {
      const premiumCandidates = config.premiumModels.filter(
        (m) => m !== currentModel,
      );
      if (premiumCandidates.length > 0) {
        const chosen =
          premiumCandidates[
            Math.floor(Math.random() * premiumCandidates.length)
          ]!;
        log(
          `Stall detected (Δ${best - worst} < ${config.stallThreshold} over ${config.stallWindow} evals) → escalating to premium: ${chosen}`,
          "MODEL",
        );
        return chosen;
      }
    }
  }

  // Normal rotation — exclude the current model to ensure variety
  const candidates = allModels.filter((m) => m !== currentModel);
  if (candidates.length === 0) return allModels[0]!;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

// --- Fitness evaluation ---

function runCommand(cmd: string): CommandCheckResult {
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output: output.slice(0, 2000) };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return {
      success: false,
      output: ((e.stdout ?? "") + "\n" + (e.stderr ?? "")).slice(0, 2000),
    };
  }
}

function runCiCheck(iteration: number, state: RalphState): void {
  const buildResult = runCommand("npm run build 2>&1");
  const testResult = runCommand("npm test 2>&1");
  const lintResult = runCommand("npm run lint 2>&1");
  const { status, lintSummary } = deriveCiStatus(
    buildResult,
    testResult,
    lintResult,
  );
  state.ciStatus = status;

  if (status.lintStatus === "warnings") {
    log(
      `CI warnings: ${status.lintWarningCount ?? 0} warnings (build/test passing)`,
      "WARN",
    );
    if ((status.lintWarningCount ?? 0) > 20) {
      log(
        `[Lint Warning] Threshold exceeded: ${status.lintWarningCount} > 20`,
        "WARN",
      );
    }
    if (lintSummary.topRules.length > 0 || lintSummary.topFiles.length > 0) {
      const ruleSummary = lintSummary.topRules.join(", ");
      const fileSummary = lintSummary.topFiles.join(", ");
      log(
        `Lint warning details:\nTop rules: ${ruleSummary || "none"}\nTop files: ${fileSummary || "none"}`,
        "WARN",
      );
    }
  }

  const wasBroken = state.ciBrokenSince !== null;
  const nowBroken = isCiBroken(status);

  if (nowBroken) {
    if (state.ciBrokenSince === null) {
      state.ciBrokenSince = iteration;
    }
    state.ciFixAttempts += 1;
    state.ciLastFixAttempt = iteration;
    return;
  }

  if (wasBroken && state.ciBrokenSince !== null) {
    const brokenIterations = iteration - state.ciBrokenSince;
    log(
      `[CI Recovery] Fixed after ${brokenIterations} iterations and ${state.ciFixAttempts} attempts`,
      "INFO",
    );
    state.ciBrokenSince = null;
    state.ciFixAttempts = 0;
    state.ciLastFixAttempt = iteration;
    state.ciLastBlockedNotification = null;
  }
}

async function collectSpecFiles(): Promise<string> {
  const specs: string[] = [];
  // Scan all subdirectories under openspec/specs/ automatically
  const baseDir = "openspec/specs";
  const possibleDirs = [
    "core", "cli", "mcp", "testing", "ci-cd", "ralph-loop", "logging", "ci-gating",
  ];
  for (const dir of possibleDirs) {
    const path = `${baseDir}/${dir}/spec.md`;
    if (existsSync(path)) {
      const content = await readFile(path, "utf-8");
      specs.push(`\n=== ${dir}/spec.md ===\n${content}`);
    }
  }
  return specs.join("\n");
}

async function evaluateFitness(
  client: CopilotClient,
  config: RalphConfig,
  iteration: number,
  model: string,
): Promise<FitnessScores> {
  log(`Starting fitness evaluation at iteration ${iteration}`, "EVAL");

  const specs = await collectSpecFiles();
  const buildResult = runCommand("npm run build 2>&1");
  const testResult = runCommand("npm test 2>&1");
  const lintResult = runCommand("npm run lint 2>&1");
  const auditResult = runCommand("npm audit --production 2>&1");

  const evalPrompt = `You are an automated fitness evaluator for a TypeScript project.
Your job is to score the implementation against the OpenSpec specifications below.

## Instructions

1. Read every named requirement and scenario in the specifications.
2. For EACH requirement/scenario produce a checklist entry with:
   - "requirement": short name such as "Ralph Loop Core – Loop execution"
   - "score": integer 0-100
   - "reasoning": 1-3 sentences of EVIDENCE referencing the build/test/lint output or specific behaviour observed. When score < 80, state explicitly what is missing or broken.
3. Do NOT bundle multiple requirements into one entry.
4. When scoring, REWARD dependency freshness:
   - If npm audit shows 0 vulnerabilities, add +5 bonus points to code quality
   - If npm audit shows vulnerabilities, deduct points proportionally from code quality
   - If dependencies are well-maintained and up-to-date, add this as a positive observation
5. After the checklist, compute dimension averages:
   - specCompliance: average of all spec-related checklist items
   - testCoverage: average of all testing-related checklist items
   - codeQuality: average of quality/lint/docs/dependency items (rewarded for fresh deps, penalized for vulnerabilities)
   - buildHealth: average of build/CI items
   - aggregate: weighted average (spec 40%, tests 25%, quality 20%, build 15%)
6. Write a one-sentence "notes" verdict.

## Specifications
${specs}

## Build Output (${buildResult.success ? "SUCCESS" : "FAILED"})
${buildResult.output}

## Test Output (${testResult.success ? "SUCCESS" : "FAILED"})
${testResult.output}

## Lint Output (${lintResult.success ? "SUCCESS" : "FAILED"})
${lintResult.output}

## Dependency Health (npm audit --production)
${auditResult.output}

Respond with ONLY a valid JSON object — no markdown, no code fences, no extra text:
{
  "specCompliance": 0,
  "testCoverage": 0,
  "codeQuality": 0,
  "buildHealth": 0,
  "aggregate": 0,
  "notes": "one sentence",
  "checklist": [
    { "requirement": "...", "score": 0, "reasoning": "..." }
  ]
}`;

  const evaluationTimeoutMs = resolveEvaluationTimeoutMs(config.timeout);
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const session = await client.createSession({
      model: config.evaluationModel,
      onPermissionRequest: approveAll,
    });

    try {
      const response = await session.sendAndWait(
        { prompt: evalPrompt },
        evaluationTimeoutMs,
      );

      // Strip optional markdown code fences then extract outermost JSON object
      const raw = response?.data?.content ?? "";
      const stripped = raw
        .replace(/^```(?:json)?\s*/im, "")
        .replace(/```\s*$/im, "")
        .trim();
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Partial<FitnessScores>;
        const clamp = (n: unknown): number =>
          Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
        return {
          specCompliance: clamp(parsed.specCompliance),
          testCoverage: clamp(parsed.testCoverage),
          codeQuality: clamp(parsed.codeQuality),
          buildHealth: clamp(parsed.buildHealth),
          aggregate: clamp(parsed.aggregate),
          notes:
            typeof parsed.notes === "string" ? parsed.notes : "No notes provided",
          checklist: Array.isArray(parsed.checklist)
            ? parsed.checklist.map((item) => ({
                requirement: String((item as ChecklistItem).requirement ?? ""),
                score: clamp((item as ChecklistItem).score),
                reasoning: String((item as ChecklistItem).reasoning ?? ""),
              }))
            : [],
        };
      }
      log(
        `Fitness evaluation: could not extract JSON from response (len=${raw.length})`,
        "WARN",
      );
    } catch (err) {
      if (isSessionIdleTimeoutError(err) && attempt < maxAttempts) {
        log(
          `Fitness evaluation timed out after ${evaluationTimeoutMs}ms; retrying once`,
          "WARN",
        );
        continue;
      }
      log(`Fitness evaluation error: ${err}`, "ERROR");
    } finally {
      await session.destroy();
    }
  }

  // Fallback scores based on objective metrics
  return {
    specCompliance: 0,
    testCoverage: testResult.success ? 30 : 0,
    codeQuality: 10,
    buildHealth: buildResult.success ? 50 : 0,
    aggregate: 0,
    notes: "Evaluation failed — using fallback metrics",
    checklist: [],
  };
}

// --- GitHub Issue reporting ---

function generateTrendChart(evaluations: Evaluation[]): string {
  if (evaluations.length === 0) return "No evaluations yet.";

  const lines = evaluations.map((e) => {
    const bar = "█".repeat(Math.round(e.scores.aggregate / 5));
    const empty = "░".repeat(20 - Math.round(e.scores.aggregate / 5));
    return `Iter ${String(e.iteration).padStart(3)}: ${bar}${empty} ${e.scores.aggregate}/100 (${e.model})`;
  });

  return "```\nFitness Trend:\n" + lines.join("\n") + "\n```";
}

function generateModelComparison(evaluations: Evaluation[]): string {
  const modelScores: Record<string, number[]> = {};
  for (const e of evaluations) {
    if (!modelScores[e.model]) modelScores[e.model] = [];
    modelScores[e.model]!.push(e.scores.aggregate);
  }

  const rows = Object.entries(modelScores).map(([model, scores]) => {
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return `| ${model} | ${scores.length} | ${avg}/100 |`;
  });

  return (
    "| Model | Evals | Avg Score |\n|-------|-------|-----------|\n" +
    rows.join("\n")
  );
}

function generateIssueBody(evaluations: Evaluation[]): string {
  return `# Ralph Loop Fitness Tracking

This issue tracks the fitness of the \`gh-attach\` implementation across Ralph Loop iterations.
Each comment represents a fitness evaluation at a specific iteration.

## Trend

${generateTrendChart(evaluations)}

## Evaluation History

| Iter | Model | Spec | Tests | Quality | Build | Aggregate |
|------|-------|------|-------|---------|-------|-----------|
${evaluations.map((e) => `| ${e.iteration} | ${e.model} | ${e.scores.specCompliance} | ${e.scores.testCoverage} | ${e.scores.codeQuality} | ${e.scores.buildHealth} | **${e.scores.aggregate}** |`).join("\n")}

## Model Comparison

${generateModelComparison(evaluations)}

---
*Auto-generated by ralph-loop.ts*`;
}

function generateCommentBody(
  iteration: number,
  model: string,
  scores: FitnessScores,
  ciStatus: CiStatus,
): string {
  // Sort checklist ascending by score so regressions surface first
  const sortedChecklist = [...(scores.checklist ?? [])].sort(
    (a, b) => a.score - b.score,
  );

  const checklistRows = sortedChecklist
    .map(
      (item) =>
        `| ${item.requirement} | ${item.score}/100 | ${item.reasoning.replace(/\|/g, "\\|")} |`,
    )
    .join("\n");

  const accordion =
    sortedChecklist.length > 0
      ? `<details>\n<summary>📋 Detailed Checklist Scoring (${sortedChecklist.length} items)</summary>\n\n| Requirement | Score | Reasoning |\n|-------------|-------|-----------|\n${checklistRows}\n\n</details>`
      : "_No checklist data available for this evaluation._";

  return `## Fitness Evaluation — Iteration ${iteration} — ${model}

> **Aggregate: ${scores.aggregate}/100** — ${scores.notes}

| Dimension | Score |
|-----------|-------|
| Spec Compliance | ${scores.specCompliance}/100 |
| Test Coverage | ${scores.testCoverage}/100 |
| Code Quality | ${scores.codeQuality}/100 |
| Build Health | ${scores.buildHealth}/100 |
| **Aggregate** | **${scores.aggregate}/100** |

**Model**: ${model}
**CI**: ${generateCiCommentSummary(ciStatus)}

${accordion}

---
*Auto-generated by ralph-loop.ts at ${new Date().toISOString()}*`;
}

// Write body to a temp file and pass via --body-file to avoid shell escaping newlines
const BODY_TMP = join(tmpdir(), "ralph-gh-body.md");

function ghWithBodyFile(cmd: string, body: string, retry = false): void {
  writeFileSync(BODY_TMP, body, "utf-8");
  const fullCmd = `${cmd} --body-file ${JSON.stringify(BODY_TMP)}`;
  if (retry) {
    ghExecWithRetry(fullCmd);
  } else {
    execSync(fullCmd, { encoding: "utf-8", timeout: 30_000 });
  }
}

function tryGitPush(): void {
  try {
    execSync("git push", { encoding: "utf-8", timeout: 30_000 });
    log("Pushed to remote", "INFO");
  } catch (err) {
    log(`Git push skipped/failed (non-fatal): ${err}`, "WARN");
  }
}

function ghExecWithRetry(
  cmd: string,
  maxAttempts = 3,
  delayMs = 2000,
): void {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      execSync(cmd, { encoding: "utf-8", timeout: 30_000 });
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      log(`gh command failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms…`, "WARN");
      // Synchronous sleep via a busy-wait — acceptable for a cli tool
      const end = Date.now() + delayMs;
      while (Date.now() < end) { /* spin */ }
    }
  }
}

async function postToGitHub(
  state: RalphState,
  config: RalphConfig,
  scores: FitnessScores,
  iteration: number,
  model: string,
): Promise<void> {
  if (!config.trackingRepo) {
    log("No trackingRepo configured, skipping GitHub posting", "WARN");
    return;
  }

  try {
    // Create tracking issue on first run
    if (!state.trackingIssueNumber) {
      const result = execSync(
        `gh issue create --repo "${config.trackingRepo}" ` +
          `--title "[Ralph Loop] Fitness Tracking" ` +
          `--label "ralph-loop" --label "automated"`,
        { encoding: "utf-8", timeout: 30_000 },
      );
      const match = result.match(/\/issues\/(\d+)/);
      if (match) {
        state.trackingIssueNumber = parseInt(match[1]!, 10);
        log(`Created tracking issue #${state.trackingIssueNumber}`, "GITHUB");
      }
    }

    if (state.trackingIssueNumber) {
      // Post per-evaluation comment (uses --body-file to preserve newlines)
      const comment = generateCommentBody(iteration, model, scores, state.ciStatus);
      ghWithBodyFile(
        `gh issue comment ${state.trackingIssueNumber} --repo "${config.trackingRepo}"`,
        comment,
        true,
      );

      // Update issue body with rolling trend chart (also via --body-file)
      const body = generateIssueBody(state.evaluations);
      ghWithBodyFile(
        `gh issue edit ${state.trackingIssueNumber} --repo "${config.trackingRepo}"`,
        body,
        true,
      );

      log(`Posted evaluation comment to issue #${state.trackingIssueNumber} (${scores.checklist.length} checklist items)`, "GITHUB");
    }
  } catch (err) {
    log(`Failed to post to GitHub: ${err}`, "ERROR");
  }
}

async function postCiBlockedNotification(
  state: RalphState,
  config: RalphConfig,
  iteration: number,
): Promise<void> {
  if (
    !config.trackingRepo ||
    !state.trackingIssueNumber ||
    !isCiBroken(state.ciStatus) ||
    state.ciLastBlockedNotification === iteration
  ) {
    return;
  }

  try {
    const body = generateCiBlockedComment(iteration, state.ciStatus);
    ghWithBodyFile(
      `gh issue comment ${state.trackingIssueNumber} --repo "${config.trackingRepo}"`,
      body,
      true,
    );
    state.ciLastBlockedNotification = iteration;
  } catch (err) {
    log(`Failed to post CI blocked notification: ${err}`, "ERROR");
  }
}

// --- Tool event formatting ---

/**
 * Produce a concise human-readable description of a tool call from its arguments.
 * Each tool exposes different argument shapes; we extract the most meaningful field.
 */
function formatToolArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;

  switch (toolName) {
    // File viewing / reading
    case "view":
    case "read_file":
    case "open_file": {
      const file = String(a.path ?? a.filePath ?? a.file ?? "");
      const start = a.startLine ?? a.start_line ?? "";
      const end = a.endLine ?? a.end_line ?? "";
      return file
        ? `${file}${start ? ` L${start}–${end || "?"}` : ""}`
        : JSON.stringify(a).slice(0, 120);
    }

    // Shell execution
    case "bash":
    case "run_terminal":
    case "shell":
    case "terminal": {
      const cmd = String(a.command ?? a.cmd ?? a.input ?? "");
      return cmd ? cmd.slice(0, 200) : JSON.stringify(a).slice(0, 120);
    }

    // Grep / search
    case "grep":
    case "grep_search":
    case "rg": {
      const pattern = String(a.query ?? a.pattern ?? a.regex ?? a.search ?? "");
      const path = a.path ?? a.directory ?? a.glob ?? "";
      return pattern
        ? `"${pattern}"${path ? ` in ${path}` : ""}`
        : JSON.stringify(a).slice(0, 120);
    }

    // File edit / create
    case "edit":
    case "edit_file":
    case "create":
    case "create_file":
    case "write_file":
    case "replace_string_in_file":
    case "insert_edit_into_file": {
      const file = String(a.path ?? a.filePath ?? a.file ?? "");
      const desc = a.explanation ?? a.description ?? "";
      return file
        ? `${file}${desc ? ` (${String(desc).slice(0, 80)})` : ""}`
        : JSON.stringify(a).slice(0, 120);
    }

    // Intent / plan reporting
    case "report_intent":
    case "intent": {
      const intent =
        a.intent ?? a.description ?? a.goal ?? a.plan ?? a.message ?? a.text;
      return intent ? String(intent).slice(0, 200) : JSON.stringify(a).slice(0, 120);
    }

    // Git operations
    case "git":
    case "git_commit":
    case "git_push": {
      const cmd = a.command ?? a.message ?? a.args;
      return cmd ? String(cmd).slice(0, 200) : JSON.stringify(a).slice(0, 120);
    }

    // Database / SQL
    case "sql":
    case "sqlite":
    case "db_query": {
      const query = String(a.query ?? a.sql ?? a.statement ?? "");
      return query ? query.slice(0, 150) : JSON.stringify(a).slice(0, 120);
    }

    // glob / find
    case "glob":
    case "find_files":
    case "list_dir": {
      const pattern = String(a.pattern ?? a.glob ?? a.path ?? a.directory ?? "");
      return pattern || JSON.stringify(a).slice(0, 120);
    }

    default:
      // Best-effort: pick whichever single string field looks most useful
      for (const key of ["command", "query", "path", "message", "description", "prompt", "text", "input"]) {
        if (typeof a[key] === "string" && (a[key] as string).length > 0) {
          return `${key}=${String(a[key]).slice(0, 160)}`;
        }
      }
      return JSON.stringify(a).slice(0, 120);
  }
}

/**
 * Distil a tool result into a one-line summary for the observer.
 * Returns empty string if the result isn't worth logging.
 */
function summariseToolResult(content: string): string {
  const c = content.trim();
  if (!c || c.length < 5) return "";

  const lines = c.split("\n").filter((l) => l.trim());

  // For multi-line results show line count + first meaningful line
  if (lines.length > 3) {
    return `${lines.length} lines — ${lines[0]!.slice(0, 120)}`;
  }
  return lines.join(" ↵ ").slice(0, 200);
}

// --- Score-maximising improvement context ---

/**
 * Builds a section injected into every prompt that directs the agent towards
 * the areas where the last evaluation scored lowest. Items are sorted ascending
 * by score so the worst regressions appear first.
 */
function generateImprovementContext(evaluations: Evaluation[]): string {
  if (evaluations.length === 0) return "";

  const last = evaluations[evaluations.length - 1]!;
  const { scores, iteration } = last;

  // Pull out the bottom checklist items (score < 80, worst first)
  const weak = [...(scores.checklist ?? [])]
    .filter((c) => c.score < 80)
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);

  const dimensionSummary = [
    `  - Spec Compliance:  ${scores.specCompliance}/100`,
    `  - Test Coverage:    ${scores.testCoverage}/100`,
    `  - Code Quality:     ${scores.codeQuality}/100`,
    `  - Build Health:     ${scores.buildHealth}/100`,
    `  - Aggregate:        ${scores.aggregate}/100`,
  ].join("\n");

  const weakRows =
    weak.length > 0
      ? weak
          .map(
            (c) =>
              `  [${c.score}/100] ${c.requirement}\n          → ${c.reasoning}`,
          )
          .join("\n")
      : "  (all items scored ≥ 80 — no urgent regressions)";

  return `
## 🎯 Score-Maximisation Context (from Iteration ${iteration} evaluation)

Your PRIMARY GOAL this iteration is to increase the aggregate fitness score above ${scores.aggregate}/100.

### Last Evaluation Scores
${dimensionSummary}

### Lowest-Scoring Items — Fix These First
${weakRows}

### Instructions
- Do NOT do arbitrary feature work. Pick the task from IMPLEMENTATION_PLAN.md that most
  directly addresses one of the low-scoring items above.
- For each fix, state which checklist item you are targeting and why your change will
  improve that specific score.
- After implementing, run the full validation suite to confirm improvement.
- If all items score ≥ 80, you may proceed with the next highest-priority feature task.
`;
}

// --- Main loop ---

async function ralphLoop(mode: Mode, maxIterationsOverride?: number) {
  const config = await loadConfig();
  const state = await loadState();
  const maxIterations = maxIterationsOverride ?? config.maxIterations;
  const promptFile = mode === "plan" ? "PROMPT_plan.md" : "PROMPT_build.md";

  log(`Starting Ralph Loop: mode=${mode}, max=${maxIterations}`, "INFO");
  log(`Model pool (regular): ${config.models.join(", ")}`, "INFO");
  log(`Model pool (premium): ${config.premiumModels.join(", ")}`, "INFO");

  if (state.currentIteration > 0) {
    log(
      `Resuming from iteration ${state.currentIteration} (model: ${state.currentModel}, ${state.evaluations.length} prior evaluations)`,
      "INFO",
    );
    if (state.evaluations.length > 0) {
      const last = state.evaluations[state.evaluations.length - 1]!;
      log(
        `Last evaluation: iteration ${last.iteration}, aggregate=${last.scores.aggregate}/100 — ${last.scores.notes}`,
        "INFO",
      );
    }
  }

  const client = new CopilotClient();
  await client.start();

  // Select initial model
  if (!state.currentModel) {
    state.currentModel = selectModel(state.evaluations, config, "");
    log(`Initial model selected: ${state.currentModel}`, "MODEL");
  }

  // Graceful shutdown
  let shuttingDown = false;
  process.on("SIGINT", () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    log("SIGINT received, finishing current iteration…", "WARN");
    setTimeout(() => {
      log("Grace period expired, saving state and exiting", "WARN");
      saveState(state).then(() => process.exit(0));
    }, 5000);
  });

  try {
    const basePrompt = await readFile(promptFile, "utf-8");

    const startIteration = state.currentIteration + 1;
    const endIteration = state.currentIteration + maxIterations;
    for (let i = startIteration; i <= endIteration; i++) {
      if (shuttingDown) break;

      const ciContext = generateCiPromptContext(state.ciStatus);
      const improvementContext = generateImprovementContext(state.evaluations);
      const prompt = [basePrompt, ciContext, improvementContext]
        .filter((v) => v.trim() !== "")
        .join("\n");

      const lastEval = state.evaluations[state.evaluations.length - 1];
      const scoreHint = lastEval
        ? ` | Last score: ${lastEval.scores.aggregate}/100`
        : "";
      log(`=== Iteration ${i} | Model: ${state.currentModel}${scoreHint} ===`, "ITER");
      if (lastEval && lastEval.scores.checklist.length > 0) {
        const worstItem = [...lastEval.scores.checklist].sort((a, b) => a.score - b.score)[0]!;
        log(`Target this iteration: [${worstItem.score}/100] ${worstItem.requirement}`, "ITER");
      }
      if (isCiBroken(state.ciStatus)) {
        await postCiBlockedNotification(state, config, i);
      }

      const session = await client.createSession({
        model: state.currentModel,
        onPermissionRequest: approveAll,
      });

      const toolCounts: Record<string, number> = {};
      session.on((event: SessionEvent) => {
        if (event.type === "tool.execution_start") {
          const name = event.data.toolName;
          toolCounts[name] = (toolCounts[name] ?? 0) + 1;
          const detail = formatToolArgs(name, event.data.arguments);
          log(`⚙ ${name}${detail ? ` — ${detail}` : ""}`, "DEBUG");
        } else if (event.type === "tool.execution_progress") {
          const msg = event.data.progressMessage?.trim();
          if (msg) log(`  ↳ ${msg}`, "DEBUG");
        } else if (event.type === "tool.execution_complete") {
          const { success, result } = event.data;
          if (!success) {
            const snippet = result?.content?.slice(0, 200) ?? "(no output)";
            log(`  ✗ tool failed: ${snippet}`, "WARN");
          } else if (result?.content) {
            const snippet = summariseToolResult(result.content);
            if (snippet) log(`  ✓ ${snippet}`, "DEBUG");
          }
        }
      });

      const startTime = Date.now();
      try {
        await session.sendAndWait({ prompt }, config.timeout);
      } catch (err) {
        log(`Iteration ${i} error: ${err}`, "ERROR");
      } finally {
        await session.destroy();
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const toolSummary = Object.entries(toolCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t}×${n}`)
        .join(", ");
      log(`Iteration ${i} complete in ${elapsed}s | Tools used: ${toolSummary || "none"}`, "ITER");

      state.currentIteration = i;
      runCiCheck(i, state);

      // Fitness evaluation every N iterations
      if (i % config.evaluationInterval === 0) {
        const scores = await evaluateFitness(
          client,
          config,
          i,
          state.currentModel,
        );

        const prevEval = state.evaluations[state.evaluations.length - 1];
        const delta = prevEval
          ? scores.aggregate - prevEval.scores.aggregate
          : null;
        const deltaStr = delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta} vs prev)` : "";

        const evaluation: Evaluation = {
          iteration: i,
          model: state.currentModel,
          scores,
          timestamp: new Date().toISOString(),
        };
        state.evaluations.push(evaluation);

        log(
          `Scores: aggregate=${scores.aggregate}/100${deltaStr}\n` +
          `  spec=${scores.specCompliance}/100  tests=${scores.testCoverage}/100  ` +
          `quality=${scores.codeQuality}/100  build=${scores.buildHealth}/100\n` +
          `  notes: ${scores.notes}`,
          "EVAL",
        );

        if (scores.checklist.length > 0) {
          const bottom3 = [...scores.checklist]
            .sort((a, b) => a.score - b.score)
            .slice(0, 3);
          log(
            `Lowest scores:\n${bottom3.map((c) => `  [${c.score}/100] ${c.requirement}`).join("\n")}`,
            "EVAL",
          );
        }

        await postToGitHub(state, config, scores, i, state.currentModel);
        tryGitPush();

        // Rotate model after evaluation (with stall detection)
        const oldModel = state.currentModel;
        state.currentModel = selectModel(
          state.evaluations,
          config,
          state.currentModel,
        );
        if (oldModel !== state.currentModel) {
          log(`Model rotation: ${oldModel} → ${state.currentModel}`, "MODEL");
        }
      }

      await saveState(state);
      tryGitPush();
    }
  } finally {
    await client.stop();
    await saveState(state);
    log("Ralph Loop complete", "INFO");
  }
}

// --- CLI ---

const args = process.argv.slice(2);
const mode: Mode = args.includes("plan") ? "plan" : "build";
const maxArg = args.find((a) => /^\d+$/.test(a));
const maxIterations = maxArg ? parseInt(maxArg) : undefined;

ralphLoop(mode, maxIterations).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
