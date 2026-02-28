import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { execSync } from "child_process";
import { CopilotClient } from "@github/copilot-sdk";

// --- Types ---

interface RalphConfig {
  maxIterations: number;
  evaluationInterval: number;
  models: string[];
  evaluationModel: string;
  trackingRepo: string;
  timeout: number;
}

interface FitnessScores {
  specCompliance: number;
  testCoverage: number;
  codeQuality: number;
  buildHealth: number;
  aggregate: number;
  notes: string;
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

// --- Model rotation ---

function selectRandomModel(models: string[], currentModel: string): string {
  const candidates = models.filter((m) => m !== currentModel);
  if (candidates.length === 0) return models[0]!;
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

  const evalPrompt = `You are evaluating a TypeScript project's implementation against its OpenSpec specifications.

Score the implementation on a 0-100 scale across these dimensions:
- **specCompliance**: How well does the code match the specifications?
- **testCoverage**: Are tests present and passing?
- **codeQuality**: Clean code, error handling, documentation?
- **buildHealth**: Does the project build and lint cleanly?
- **aggregate**: Weighted average (spec: 40%, tests: 25%, quality: 20%, build: 15%)

## Specifications
${specs}

## Build Output (${buildResult.success ? "SUCCESS" : "FAILED"})
${buildResult.output}

## Test Output (${testResult.success ? "SUCCESS" : "FAILED"})
${testResult.output}

## Lint Output (${lintResult.success ? "SUCCESS" : "FAILED"})
${lintResult.output}

Respond with ONLY a valid JSON object (no markdown, no code fences):
{"specCompliance": N, "testCoverage": N, "codeQuality": N, "buildHealth": N, "aggregate": N, "notes": "brief summary"}`;

  const session = await client.createSession({
    model: config.evaluationModel,
    workingDirectory: process.cwd(),
  });

  try {
    const response = await session.sendAndWait(
      { prompt: evalPrompt },
      120_000,
    );

    // Extract JSON from response
    const text =
      typeof response === "string"
        ? response
        : JSON.stringify(response);
    const jsonMatch = text.match(/\{[\s\S]*"aggregate"[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as FitnessScores;
    }
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
    const avg = Math.round(
      scores.reduce((a, b) => a + b, 0) / scores.length,
    );
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
  return `## Fitness Evaluation — Iteration ${iteration} — ${model}

| Dimension | Score |
|-----------|-------|
| Spec Compliance | ${scores.specCompliance}/100 |
| Test Coverage | ${scores.testCoverage}/100 |
| Code Quality | ${scores.codeQuality}/100 |
| Build Health | ${scores.buildHealth}/100 |
| **Aggregate** | **${scores.aggregate}/100** |

**Model**: ${model}
**Notes**: ${scores.notes}

---
*Auto-generated by ralph-loop.ts at ${new Date().toISOString()}*`;
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
    // Create or update tracking issue
    if (!state.trackingIssueNumber) {
      const result = execSync(
        `gh issue create --repo "${config.trackingRepo}" ` +
          `--title "[Ralph Loop] Fitness Tracking" ` +
          `--label "ralph-loop,automated" ` +
          `--body "Initializing fitness tracking..."`,
        { encoding: "utf-8" },
      );
      const match = result.match(/\/issues\/(\d+)/);
      if (match) {
        state.trackingIssueNumber = parseInt(match[1]!, 10);
      }
    }

    if (state.trackingIssueNumber) {
      // Post evaluation comment
      const comment = generateCommentBody(iteration, model, scores);
      execSync(
        `gh issue comment ${state.trackingIssueNumber} ` +
          `--repo "${config.trackingRepo}" ` +
          `--body ${JSON.stringify(comment)}`,
        { encoding: "utf-8" },
      );

      // Update issue body with trend
      const body = generateIssueBody(state.evaluations);
      execSync(
        `gh issue edit ${state.trackingIssueNumber} ` +
          `--repo "${config.trackingRepo}" ` +
          `--body ${JSON.stringify(body)}`,
        { encoding: "utf-8" },
      );

      log(
        `Posted fitness score to issue #${state.trackingIssueNumber}`,
      );
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
    state.currentModel = selectRandomModel(config.models, "");
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

    for (
      let i = state.currentIteration + 1;
      i <= state.currentIteration + maxIterations;
      i++
    ) {
      if (shuttingDown) break;

      log(`\n=== Iteration ${i} | Model: ${state.currentModel} ===`);

      const session = await client.createSession({
        model: state.currentModel,
        workingDirectory: process.cwd(),
        onPermissionRequest: async () => ({ allow: true }),
      });

      session.on((event: { type: string; data?: { toolName?: string } }) => {
        if (event.type === "tool.execution_start" && event.data?.toolName) {
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

        // Rotate model after evaluation
        const oldModel = state.currentModel;
        state.currentModel = selectRandomModel(
          config.models,
          state.currentModel,
        );
        log(`Model rotation: ${oldModel} → ${state.currentModel}`);
      }

      await saveState(state);
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
