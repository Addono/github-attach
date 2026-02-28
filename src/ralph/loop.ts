/**
 * Ralph Loop core session lifecycle module.
 *
 * Extracts the per-iteration session management from ralph-loop.ts into a
 * testable module. Each build iteration creates an isolated Copilot session,
 * sends the prompt, handles tool events, and destroys the session on completion
 * (success or failure) — per Ralph-loop/spec.md "Loop execution" scenario.
 *
 * @spec Ralph-loop/spec.md — Ralph Loop Core: Loop execution
 */

import type { CopilotClient, SessionEvent } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import {
  formatToolArgs,
  getToolCategory,
  summariseToolResult,
} from "./toolLogging.js";
import type { RalphLogLevel } from "./logging.js";

/** Minimal config subset required by the session execution layer. */
export interface LoopSessionConfig {
  /** Copilot model to use for the build session. */
  model: string;
  /** sendAndWait timeout in milliseconds. */
  timeout: number;
}

/** Summary of tools invoked during a single build session. */
export interface SessionToolSummary {
  /** Map of tool name → invocation count. */
  counts: Record<string, number>;
  /** Human-readable comma-separated `tool×N` summary string. */
  summary: string;
}

/** Result returned after a build session completes. */
export interface BuildSessionResult {
  /** Wall-clock time for the session in seconds. */
  elapsedSeconds: number;
  /** Tool usage summary. */
  tools: SessionToolSummary;
  /** True when the session completed without throwing. */
  success: boolean;
}

/** Logger function compatible with ralph-loop.ts log() signature. */
export type LogFn = (message: string, level?: RalphLogLevel) => void;

/**
 * Run one build iteration using the provided Copilot client.
 *
 * Per spec:
 * 1. Creates a fresh Copilot session (isolated context).
 * 2. Registers tool-event handlers for debug/progress logging.
 * 3. Sends the prompt and waits for completion (bounded by `config.timeout`).
 * 4. Destroys the session unconditionally in a `finally` block.
 * 5. Logs the iteration outcome and tool summary.
 *
 * @spec Ralph-loop/spec.md — Scenario: Loop execution
 */
export async function runBuildSession(
  client: CopilotClient,
  iteration: number,
  prompt: string,
  config: LoopSessionConfig,
  log: LogFn = () => undefined,
): Promise<BuildSessionResult> {
  // Step 1 — Create a fresh, isolated Copilot session.
  const session = await client.createSession({
    model: config.model,
    onPermissionRequest: approveAll,
  });

  const toolCounts: Record<string, number> = {};
  const toolStartTimes = new Map<string, number>();
  let currentIntent: string | null = null;

  // Step 2 — Register event handlers for tool invocation tracking and intent logging.
  session.on((event: SessionEvent) => {
    if (event.type === "tool.execution_start") {
      const name = event.data.toolName;
      toolCounts[name] = (toolCounts[name] ?? 0) + 1;
      toolStartTimes.set(event.data.toolCallId, Date.now());
      const category = getToolCategory(name);
      const detail = formatToolArgs(name, event.data.arguments);
      log(`⚙ ${name} (${category})${detail ? ` — ${detail}` : ""}`, "DEBUG");

      // Model Reasoning Logging: track intent changes from report_intent tool calls.
      if (
        name === "report_intent" &&
        typeof (event.data.arguments as Record<string, unknown>)?.intent ===
          "string"
      ) {
        const newIntent = String(
          (event.data.arguments as Record<string, unknown>).intent,
        ).trim();
        if (newIntent && newIntent !== currentIntent) {
          if (currentIntent !== null)
            log(`[Intent] Previous: ${currentIntent}`, "DEBUG");
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
  let success = false;

  try {
    // Step 3 — Send the prompt and wait for completion.
    await session.sendAndWait({ prompt }, config.timeout);
    success = true;
  } catch (err) {
    log(`Iteration ${iteration} error: ${err}`, "ERROR");
  } finally {
    // Step 4 — Destroy the session unconditionally.
    await session.destroy();
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  const toolSummary = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}×${n}`)
    .join(", ");

  // Step 5 — Log outcome.
  log(
    `Iteration ${iteration} complete in ${elapsedSeconds}s | Tools used: ${toolSummary || "none"}`,
    "ITER",
  );

  return {
    elapsedSeconds,
    tools: { counts: toolCounts, summary: toolSummary },
    success,
  };
}
