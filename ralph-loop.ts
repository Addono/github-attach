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

async function loadState(): Promise<RalphState> {
  if (existsSync(STATE_FILE)) {
    const raw = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw) as RalphState;
  }
  return {
    currentIteration: 0,
    currentModel: "",
    trackingIssueNumber: null,
    evaluations: [],
  };
}

async function saveState(state: RalphState): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function log(message: string): void {
  const entry = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(entry);
  try {
    execSync(`printf '%s' ${JSON.stringify(entry)} >> ${LOG_FILE}`);
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

function runCommand(cmd: string): { success: boolean; output: string } {
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

async function collectSpecFiles(): Promise<string> {
  const specs: string[] = [];
  const specDirs = ["core", "cli", "mcp", "testing", "ci-cd", "ralph-loop"];
  for (const dir of specDirs) {
    const path = `openspec/specs/${dir}/spec.md`;
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
  log(`Starting fitness evaluation at iteration ${iteration}`);

  const specs = await collectSpecFiles();
  const buildResult = runCommand("npm run build 2>&1");
  const testResult = runCommand("npm test 2>&1");
  const lintResult = runCommand("npm run lint 2>&1");

  const evalPrompt = `You are an automated fitness evaluator for a TypeScript project.
Your job is to score the implementation against the OpenSpec specifications below.

## Instructions

1. Read every named requirement and scenario in the specifications.
2. For EACH requirement/scenario produce a checklist entry with:
   - "requirement": short name such as "Ralph Loop Core – Loop execution"
   - "score": integer 0-100
   - "reasoning": 1-3 sentences of EVIDENCE referencing the build/test/lint output or specific behaviour observed. When score < 80, state explicitly what is missing or broken.
3. Do NOT bundle multiple requirements into one entry.
4. After the checklist, compute dimension averages:
   - specCompliance: average of all spec-related checklist items
   - testCoverage: average of all testing-related checklist items
   - codeQuality: average of quality/lint/docs items
   - buildHealth: average of build/CI items
   - aggregate: weighted average (spec 40%, tests 25%, quality 20%, build 15%)
5. Write a one-sentence "notes" verdict.

## Specifications
${specs}

## Build Output (${buildResult.success ? "SUCCESS" : "FAILED"})
${buildResult.output}

## Test Output (${testResult.success ? "SUCCESS" : "FAILED"})
${testResult.output}

## Lint Output (${lintResult.success ? "SUCCESS" : "FAILED"})
${lintResult.output}

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

  const session = await client.createSession({
    model: config.evaluationModel,
    onPermissionRequest: approveAll,
  });

  try {
    const response = await session.sendAndWait({ prompt: evalPrompt }, 180_000);

    // Strip optional markdown code fences then extract outermost JSON object
    const raw = response?.data?.content ?? "";
    const stripped = raw.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/im, "").trim();
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
        notes: typeof parsed.notes === "string" ? parsed.notes : "No notes provided",
        checklist: Array.isArray(parsed.checklist)
          ? parsed.checklist.map((item) => ({
              requirement: String((item as ChecklistItem).requirement ?? ""),
              score: clamp((item as ChecklistItem).score),
              reasoning: String((item as ChecklistItem).reasoning ?? ""),
            }))
          : [],
      };
    }
    log(`Fitness evaluation: could not extract JSON from response (len=${raw.length})`);
  } catch (err) {
    log(`Fitness evaluation error: ${err}`);
  } finally {
    await session.destroy();
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
    log("Pushed to remote");
  } catch (err) {
    log(`Git push skipped/failed (non-fatal): ${err}`);
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
      log(`  gh command failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms…`);
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
    log("No trackingRepo configured, skipping GitHub posting");
    return;
  }

  try {
    // Create tracking issue on first run
    if (!state.trackingIssueNumber) {
      const result = execSync(
        `gh issue create --repo "${config.trackingRepo}" ` +
          `--title "[Ralph Loop] Fitness Tracking"`,
        { encoding: "utf-8", timeout: 30_000 },
      );
      const match = result.match(/\/issues\/(\d+)/);
      if (match) {
        state.trackingIssueNumber = parseInt(match[1]!, 10);
        log(`Created tracking issue #${state.trackingIssueNumber}`);
      }
    }

    if (state.trackingIssueNumber) {
      // Post per-evaluation comment (uses --body-file to preserve newlines)
      const comment = generateCommentBody(iteration, model, scores);
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

      log(`Posted fitness score to issue #${state.trackingIssueNumber}`);
    }
  } catch (err) {
    log(`Failed to post to GitHub: ${err}`);
  }
}

// --- Main loop ---

async function ralphLoop(mode: Mode, maxIterationsOverride?: number) {
  const config = await loadConfig();
  const state = await loadState();
  const maxIterations = maxIterationsOverride ?? config.maxIterations;
  const promptFile = mode === "plan" ? "PROMPT_plan.md" : "PROMPT_build.md";

  log(`Starting Ralph Loop: mode=${mode}, max=${maxIterations}`);
  log(`Model pool: ${config.models.join(", ")}`);

  const client = new CopilotClient();
  await client.start();

  // Select initial model
  if (!state.currentModel) {
    state.currentModel = selectModel(state.evaluations, config, "");
  }

  // Graceful shutdown
  let shuttingDown = false;
  process.on("SIGINT", () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    log("SIGINT received, finishing current iteration...");
    setTimeout(() => {
      log("Grace period expired, saving state and exiting");
      saveState(state).then(() => process.exit(0));
    }, 5000);
  });

  try {
    const prompt = await readFile(promptFile, "utf-8");

    const startIteration = state.currentIteration + 1;
    const endIteration = state.currentIteration + maxIterations;
    for (let i = startIteration; i <= endIteration; i++) {
      if (shuttingDown) break;

      log(`\n=== Iteration ${i} | Model: ${state.currentModel} ===`);

      const session = await client.createSession({
        model: state.currentModel,
        onPermissionRequest: approveAll,
      });

      session.on((event: SessionEvent) => {
        if (event.type === "tool.execution_start") {
          log(`  ⚙ ${event.data.toolName}`);
        }
      });

      const startTime = Date.now();
      try {
        await session.sendAndWait({ prompt }, config.timeout);
      } catch (err) {
        log(`Iteration ${i} error: ${err}`);
      } finally {
        await session.destroy();
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      log(`Iteration ${i} complete (${elapsed}s)`);

      state.currentIteration = i;

      // Fitness evaluation every N iterations
      if (i % config.evaluationInterval === 0) {
        const scores = await evaluateFitness(
          client,
          config,
          i,
          state.currentModel,
        );

        const evaluation: Evaluation = {
          iteration: i,
          model: state.currentModel,
          scores,
          timestamp: new Date().toISOString(),
        };
        state.evaluations.push(evaluation);

        log(
          `Fitness: aggregate=${scores.aggregate}/100 (spec=${scores.specCompliance}, tests=${scores.testCoverage}, quality=${scores.codeQuality}, build=${scores.buildHealth})`,
        );

        await postToGitHub(state, config, scores, i, state.currentModel);
        tryGitPush();

        // Rotate model after evaluation (with stall detection)
        const oldModel = state.currentModel;
        state.currentModel = selectModel(
          state.evaluations,
          config,
          state.currentModel,
        );
        log(`Model rotation: ${oldModel} → ${state.currentModel}`);
      }

      await saveState(state);
      tryGitPush();
    }
  } finally {
    await client.stop();
    await saveState(state);
    log("Ralph Loop complete");
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
