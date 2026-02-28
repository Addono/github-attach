import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { execSync } from "child_process";
import {
  CopilotClient,
  approveAll,
  type SessionEvent,
} from "@github/copilot-sdk";
import {
  NumericFitnessScores,
  computeAggregateScore,
  deriveFallbackFitnessScores,
  extractFitnessJsonPayload,
  isEvaluationPayloadSuspicious,
  isSessionIdleTimeoutError,
  resolveEvaluationTimeoutMs,
} from "./src/ralph/evaluation.ts";
import { shouldEmitLog, type RalphLogLevel } from "./src/ralph/logging.ts";
import { registerShutdownHandler } from "./src/ralph/shutdown.ts";
import {
  formatToolArgs,
  getToolCategory,
  summariseToolResult,
} from "./src/ralph/toolLogging.ts";
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
import { selectModel as selectModelFromPool } from "./src/ralph/modelSelection.ts";
import {
  defaultState,
  loadState,
  saveState,
  type ChecklistItem,
  type Evaluation,
  type FitnessScores,
  type RalphState,
} from "./src/ralph/state.ts";
import {
  generateCommentBody,
  generateIssueBody,
  ghWithBodyFile,
  postCiBlockedNotification,
  postToGitHub,
} from "./src/ralph/github.ts";

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

type Mode = "plan" | "build";

// --- State management ---

const STATE_FILE = "ralph-state.json";
const CONFIG_FILE = "ralph-config.json";
const LOG_FILE = "ralph-loop.log";

async function loadConfig(): Promise<RalphConfig> {
  const raw = await readFile(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as RalphConfig;
}

function log(message: string, level: RalphLogLevel = "INFO"): void {
  if (!shouldEmitLog(level)) return;
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
  return selectModelFromPool(evaluations, config, currentModel, (msg) =>
    log(msg, "MODEL"),
  );
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
    "core",
    "cli",
    "mcp",
    "testing",
    "ci-cd",
    "ralph-loop",
    "logging",
    "ci-gating",
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

/**
 * Collect key source-file evidence to help the evaluator ground scores in observable facts.
 * Returns a structured summary of the repository's CI/CD, test, and release configuration.
 */
async function collectSourceEvidence(): Promise<string> {
  const evidence: string[] = [];

  // Helper: safely read a file slice for evidence
  const readSlice = async (path: string, maxChars = 1500): Promise<string> => {
    try {
      const content = await readFile(path, "utf-8");
      return content.length > maxChars
        ? content.slice(0, maxChars) +
            `\n... (truncated, total ${content.length} chars)`
        : content;
    } catch {
      return "(file not found)";
    }
  };

  // CI/CD workflow files — use larger slice to show full E2E stage and matrix config
  const ciWorkflow = await readSlice(".github/workflows/ci.yml", 3000);
  evidence.push(`=== .github/workflows/ci.yml ===\n${ciWorkflow}`);

  const releaseWorkflow = await readSlice(
    ".github/workflows/release.yml",
    2000,
  );
  evidence.push(`=== .github/workflows/release.yml ===\n${releaseWorkflow}`);

  // Semantic release configuration
  const releasercExists = existsSync(".releaserc.json");
  const releaserc = releasercExists
    ? await readSlice(".releaserc.json")
    : "(not found)";
  evidence.push(`=== .releaserc.json ===\n${releaserc}`);

  // Dependabot configuration
  const dependabot = await readSlice(".github/dependabot.yml");
  evidence.push(`=== .github/dependabot.yml ===\n${dependabot}`);

  // E2E test file structure — use larger slice so afterAll cleanup section is visible
  const e2eTest = await readSlice("test/e2e/upload.test.ts", 4500);
  evidence.push(`=== test/e2e/upload.test.ts ===\n${e2eTest}`);

  // Graceful shutdown module — read full file (2500 chars) to show SIGINT handler + grace period
  const shutdownModule = await readSlice("src/ralph/shutdown.ts", 2500);
  evidence.push(`=== src/ralph/shutdown.ts ===\n${shutdownModule}`);

  // package.json — shows semantic-release devDependencies, bin fields, and npm scripts
  try {
    const pkgRaw = await readFile("package.json", "utf-8");
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const pkgSummary = JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        bin: pkg.bin,
        scripts: pkg.scripts,
        devDependencies: Object.fromEntries(
          Object.entries(
            (pkg.devDependencies ?? {}) as Record<string, string>,
          ).filter(
            ([k]) =>
              k.includes("semantic") ||
              k.includes("release") ||
              k.includes("vitest") ||
              k.includes("typescript"),
          ),
        ),
        dependencies: Object.fromEntries(
          Object.entries(
            (pkg.dependencies ?? {}) as Record<string, string>,
          ).filter(
            ([k]) =>
              k.includes("mcp") ||
              k.includes("octokit") ||
              k.includes("commander") ||
              k.includes("zod"),
          ),
        ),
      },
      null,
      2,
    );
    evidence.push(`=== package.json (key fields) ===\n${pkgSummary}`);
  } catch {
    evidence.push(`=== package.json (key fields) ===\n(unreadable)`);
  }

  // MCP server — shows tool definitions, transports, and elicitation flow
  const mcpIndex = await readSlice("src/mcp/index.ts", 3000);
  evidence.push(`=== src/mcp/index.ts (first 3000 chars) ===\n${mcpIndex}`);

  // Core library entry point — shows public API surface
  const indexTs = await readSlice("src/index.ts", 2000);
  evidence.push(`=== src/index.ts ===\n${indexTs}`);

  // Core types — shows error hierarchy and strategy interface
  const typesTs = await readSlice("src/core/types.ts", 3000);
  evidence.push(`=== src/core/types.ts ===\n${typesTs}`);

  // CLI entry point — shows command registration and global options
  const cliIndex = await readSlice("src/cli/index.ts", 2500);
  evidence.push(`=== src/cli/index.ts ===\n${cliIndex}`);

  // Upload command — shows strategy selection, output formats, exit codes
  const uploadCmd = await readSlice("src/cli/commands/upload.ts", 2500);
  evidence.push(`=== src/cli/commands/upload.ts ===\n${uploadCmd}`);

  // Vitest config — shows test projects, coverage thresholds
  const vitestConfig = await readSlice("vitest.config.ts", 1500);
  evidence.push(`=== vitest.config.ts ===\n${vitestConfig}`);

  // tsconfig.json — shows strict TypeScript configuration
  const tsconfig = await readSlice("tsconfig.json", 1000);
  evidence.push(`=== tsconfig.json ===\n${tsconfig}`);

  // Key directory listings
  const srcListing = runCommand("find src/ -name '*.ts' | sort 2>&1");
  evidence.push(`=== src/ file listing ===\n${srcListing.output}`);

  const testListing = runCommand("find test/ -name '*.ts' | sort 2>&1");
  evidence.push(`=== test/ file listing ===\n${testListing.output}`);

  const githubListing = runCommand("find .github/ -type f | sort 2>&1");
  evidence.push(`=== .github/ file listing ===\n${githubListing.output}`);

  // Ralph Loop configuration — shows model pool, evaluation interval, tracking repo
  const ralphConfig = await readSlice("ralph-config.json", 2000);
  evidence.push(`=== ralph-config.json ===\n${ralphConfig}`);

  // Ralph Loop state — shows current iteration, model, tracking issue, evaluations history
  try {
    const stateRaw = await readFile("ralph-state.json", "utf-8");
    const state = JSON.parse(stateRaw) as Partial<RalphState>;
    const stateSummary = JSON.stringify(
      {
        currentIteration: state.currentIteration,
        currentModel: state.currentModel,
        trackingIssueNumber: state.trackingIssueNumber,
        evaluationCount: Array.isArray(state.evaluations)
          ? state.evaluations.length
          : 0,
        lastEvaluation: Array.isArray(state.evaluations)
          ? state.evaluations[state.evaluations.length - 1]
          : null,
        ciStatus: state.ciStatus,
      },
      null,
      2,
    );
    evidence.push(`=== ralph-state.json (summary) ===\n${stateSummary}`);
  } catch {
    evidence.push(`=== ralph-state.json (summary) ===\n(not yet created)`);
  }

  // Ralph Loop core — model rotation, session creation, state persistence, GitHub issue reporting
  // Slice shows imports and loop entry point using the extracted state/github modules
  const ralphLoopCore = await readSlice("ralph-loop.ts", 4000);
  evidence.push(
    `=== ralph-loop.ts (first 4000 chars — imports, types, state management, model rotation) ===\n${ralphLoopCore}`,
  );

  // State persistence module (src/ralph/state.ts) — loadState, saveState, defaultState
  const stateModule = await readSlice("src/ralph/state.ts", 3000);
  evidence.push(
    `=== src/ralph/state.ts (state persistence — loadState / saveState) ===\n${stateModule}`,
  );

  // GitHub reporting module (src/ralph/github.ts) — createIssue, postComment, generateBody
  const githubModule = await readSlice("src/ralph/github.ts", 3000);
  evidence.push(
    `=== src/ralph/github.ts (GitHub issue reporting — postToGitHub / generateCommentBody) ===\n${githubModule}`,
  );

  // Ralph Loop Core session lifecycle module — runBuildSession (spec: Loop execution)
  const loopModule = await readSlice("src/ralph/loop.ts", 3000);
  evidence.push(
    `=== src/ralph/loop.ts (Loop Core — runBuildSession: createSession / sendAndWait / destroy) ===\n${loopModule}`,
  );

  // CI gating module — deriveCiStatus, generateCiPromptContext, isCiBroken
  const ciGatingModule = await readSlice("src/ralph/ci-gating.ts", 3000);
  evidence.push(
    `=== src/ralph/ci-gating.ts (CI gating — deriveCiStatus / generateCiPromptContext / isCiBroken) ===\n${ciGatingModule}`,
  );

  // Ralph Loop GitHub reporting section — model rotation and selectModel
  try {
    const fullLoop = await readFile("ralph-loop.ts", "utf-8");
    const modelSelectIdx = fullLoop.indexOf(
      "// --- Model rotation with stall detection ---",
    );
    if (modelSelectIdx !== -1) {
      const section = fullLoop.slice(modelSelectIdx, modelSelectIdx + 1000);
      evidence.push(
        `=== ralph-loop.ts (selectModel — model rotation with stall detection) ===\n${section}`,
      );
    }
  } catch {
    // ralph-loop.ts read failure — section already captured above
  }

  return evidence.join("\n\n");
}

async function evaluateFitness(
  client: CopilotClient,
  config: RalphConfig,
  iteration: number,
  model: string,
): Promise<FitnessScores> {
  log(`Starting fitness evaluation at iteration ${iteration}`, "EVAL");
  log(
    `Evaluation commands: npm run build, npm test, npm run lint, npm audit --production`,
    "EVAL",
  );

  const specs = await collectSpecFiles();
  const sourceEvidence = await collectSourceEvidence();
  const buildResult = runCommand("npm run build 2>&1");
  const testResult = runCommand("npm test 2>&1");
  const lintResult = runCommand("npm run lint 2>&1");
  const auditResult = runCommand("npm audit --production 2>&1");

  // Log individual stage results so operators can see evaluation progress
  log(
    `[Evaluation] Build: ${buildResult.success ? "success" : "failed"}`,
    "EVAL",
  );
  // Extract test pass/fail summary from test output
  const testSummary =
    testResult.output.match(
      /Tests\s+(\d+)\s+passed.*?(?:(\d+)\s+failed)?/,
    )?.[0] ?? (testResult.success ? "passed" : "failed");
  log(`[Evaluation] Tests: ${testSummary}`, "EVAL");
  // Extract lint error/warning counts from lint output
  const lintErrors = lintResult.output.match(/(\d+)\s+error/)?.[1] ?? "0";
  const lintWarnings = lintResult.output.match(/(\d+)\s+warning/)?.[1] ?? "0";
  log(
    `[Evaluation] Lint: ${lintErrors} errors, ${lintWarnings} warnings`,
    "EVAL",
  );

  const fallbackScores = deriveFallbackFitnessScores({
    build: buildResult,
    test: testResult,
    lint: lintResult,
    audit: auditResult,
  });
  const fallbackNote = "Evaluation failed — using objective CI metrics";
  const suspiciousFallbackNote =
    "Evaluation output unreliable — using objective CI metrics";
  const fallbackResponse = (reason: string): FitnessScores => ({
    ...fallbackScores,
    notes: reason,
    checklist: [],
  });

  const evalPrompt = `You are an automated fitness evaluator for a TypeScript project.
Your job is to score the implementation against the OpenSpec specifications below.

## Instructions

1. Read every named requirement and scenario in the specifications.
2. For EACH requirement/scenario produce a checklist entry with:
   - "requirement": short name such as "Ralph Loop Core – Loop execution"
   - "score": integer 0-100
   - "reasoning": 1-3 sentences of EVIDENCE referencing the build/test/lint output, source evidence below, or specific behaviour observed. When score < 80, state explicitly what is missing or broken.
3. Do NOT bundle multiple requirements into one entry.
4. When scoring, apply these rules:
   - REWARD dependency freshness:
     - If npm audit shows 0 vulnerabilities, add +5 bonus points to code quality
     - If npm audit shows vulnerabilities, deduct points proportionally from code quality
     - If dependencies are well-maintained and up-to-date, add this as a positive observation
   - CI failure penalty: if build or tests FAILED, clamp buildHealth to ≤ 30/100
   - Lint warning penalty: for each 5 unique warning types, deduct 10 points from codeQuality
   - Use the Source Evidence section (workflow files, package.json, test files) as AUTHORITATIVE ground truth about what is implemented. If a file is shown in the evidence, treat it as existing and implemented.
   - For CI Pipeline, Release Artifacts, Semantic Release, and E2E Tests: base your scoring DIRECTLY on the workflow files and package.json shown in the Source Evidence. Do NOT assume files are absent if they are shown in the evidence.
   - For E2E Tests: check test/e2e/upload.test.ts in the evidence for E2E_TESTS gating, real GitHub API calls (Octokit), and afterAll cleanup.
5. After the checklist, compute dimension averages:
   - specCompliance: average of all spec-related checklist items
   - testCoverage: average of all testing-related checklist items
   - codeQuality: average of quality/lint/docs/dependency items (rewarded for fresh deps, penalized for vulnerabilities)
   - buildHealth: average of build/CI items
   - aggregate: weighted average (spec 40%, tests 25%, quality 20%, build 15%)
6. Write a one-sentence "notes" verdict.

## Specifications
${specs}

## Source Evidence (key configuration and implementation files)
${sourceEvidence}

## Build Output (${buildResult.success ? "SUCCESS" : "FAILED"})
${buildResult.output}

## Test Output (${testResult.success ? "SUCCESS" : "FAILED"})
${testResult.output}

## Lint Output (${lintResult.success ? "SUCCESS" : "FAILED"})
${lintResult.output}

## Dependency Health (npm audit --production)
${auditResult.output}

  Respond with ONLY a valid JSON object — no markdown, no code fences, no extra text.
  Structure (for reference only; replace each placeholder with the numeric value you computed):
  {
    "specCompliance": SPEC_SCORE,
    "testCoverage": TEST_SCORE,
    "codeQuality": QUALITY_SCORE,
    "buildHealth": BUILD_SCORE,
    "aggregate": AGGREGATE_SCORE,
    "notes": "Concise sentence summarizing the result (cite the most important context)",
    "checklist": [
      {
        "requirement": "Ralph Loop Core – Loop execution",
        "score": ITEM_SCORE,
        "reasoning": "Evidence-backed justification referencing specs, logs, or Source Evidence"
      }
    ]
  }
  Each placeholder above must be replaced with the integer you computed (0-100), and each checklist entry must cite at least one concrete piece of evidence from the specifications, Source Evidence block, or the command outputs above. Do NOT return the template literally; remove the placeholder text entirely and supply numbers derived from your reasoning. Keep each reasoning blurb short (1-3 sentences) and highlight the most relevant evidence for the score.
`;

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
          log(
            `Fitness evaluation output suspicious (spec=${parsedScores.specCompliance}/100 aggregate=${parsedScores.aggregate}/100) — using derived fallback`,
            "WARN",
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

  return fallbackResponse(fallbackNote);
}

// --- GitHub Issue reporting ---
// Reporting functions are implemented in src/ralph/github.ts (generateIssueBody,
// generateCommentBody, postToGitHub, postCiBlockedNotification) and imported above.

function tryGitPush(): void {
  try {
    execSync("git push", { encoding: "utf-8", timeout: 30_000 });
    log("Pushed to remote", "INFO");
  } catch (err) {
    log(`Git push skipped/failed (non-fatal): ${err}`, "WARN");
  }
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

  // Graceful shutdown — allow current iteration to finish then save state.
  let shuttingDown = false;
  registerShutdownHandler(
    (value) => {
      shuttingDown = value;
    },
    () => saveState(state),
    log,
  );

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
      log(
        `=== Iteration ${i} | Model: ${state.currentModel}${scoreHint} ===`,
        "ITER",
      );
      if (lastEval && lastEval.scores.checklist.length > 0) {
        const worstItem = [...lastEval.scores.checklist].sort(
          (a, b) => a.score - b.score,
        )[0]!;
        log(
          `Target this iteration: [${worstItem.score}/100] ${worstItem.requirement}`,
          "ITER",
        );
      }
      if (isCiBroken(state.ciStatus)) {
        await postCiBlockedNotification(state, config, i, log);
      }

      const session = await client.createSession({
        model: state.currentModel,
        onPermissionRequest: approveAll,
      });

      const toolCounts: Record<string, number> = {};
      // Track per-call start times for execution-time reporting
      const toolStartTimes = new Map<string, number>();
      // Track current agent intent for Model Reasoning Logging — intent changes are logged
      let currentIntent: string | null = null;
      session.on((event: SessionEvent) => {
        if (event.type === "tool.execution_start") {
          const name = event.data.toolName;
          toolCounts[name] = (toolCounts[name] ?? 0) + 1;
          toolStartTimes.set(event.data.toolCallId, Date.now());
          const category = getToolCategory(name);
          const detail = formatToolArgs(name, event.data.arguments);
          log(
            `⚙ ${name} (${category})${detail ? ` — ${detail}` : ""}`,
            "DEBUG",
          );
          // Model Reasoning Logging: track intent changes via report_intent tool calls
          if (
            name === "report_intent" &&
            typeof (event.data.arguments as Record<string, unknown>)?.intent ===
              "string"
          ) {
            const newIntent = String(
              (event.data.arguments as Record<string, unknown>).intent,
            ).trim();
            if (newIntent && newIntent !== currentIntent) {
              if (currentIntent !== null) {
                log(`[Intent] Previous: ${currentIntent}`, "DEBUG");
              }
              log(`[Intent] New: ${newIntent}`, "DEBUG");
              currentIntent = newIntent;
            }
          }
        } else if (event.type === "tool.execution_progress") {
          const msg = event.data.progressMessage?.trim();
          if (msg) log(`  ↳ ${msg}`, "DEBUG");
        } else if (event.type === "tool.execution_complete") {
          const { success, result } = event.data;
          const started = toolStartTimes.get(event.data.toolCallId);
          const elapsedMs = started ? Date.now() - started : null;
          const timeSuffix = elapsedMs !== null ? ` (${elapsedMs}ms)` : "";
          if (!success) {
            const snippet = result?.content?.slice(0, 200) ?? "(no output)";
            log(`  ✗ tool failed${timeSuffix}: ${snippet}`, "WARN");
          } else if (result?.content) {
            const snippet = summariseToolResult(result.content);
            if (snippet) log(`  ✓${timeSuffix} ${snippet}`, "DEBUG");
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
      log(
        `Iteration ${i} complete in ${elapsed}s | Tools used: ${toolSummary || "none"}`,
        "ITER",
      );

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
        const deltaStr =
          delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta} vs prev)` : "";

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

        await postToGitHub(state, config, scores, i, state.currentModel, log);
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
