/**
 * Unit tests for src/ralph/loop.ts
 *
 * Verifies Ralph Loop Core spec requirements:
 * - runBuildSession creates a fresh Copilot session (isolated context)
 * - runBuildSession sends the prompt via session.sendAndWait()
 * - runBuildSession destroys the session after completion (success or failure)
 * - Tool events are tracked and summarised
 * - Session errors are logged without re-throwing
 *
 * @spec Ralph-loop/spec.md — Ralph Loop Core: Loop execution
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the copilot-sdk before importing the module under test.
const mockSession = {
  on: vi.fn(),
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

import { runBuildSession } from "../../../src/ralph/loop.js";
import type { CopilotClient } from "@github/copilot-sdk";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(
  overrides: Partial<{ model: string; timeout: number }> = {},
) {
  return { model: "claude-haiku-4.5", timeout: 30_000, ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.createSession.mockResolvedValue(mockSession);
  mockSession.sendAndWait.mockResolvedValue({ data: { content: "done" } });
  mockSession.destroy.mockResolvedValue(undefined);
  mockSession.on.mockReturnValue(undefined);
});

describe("runBuildSession — spec: Ralph Loop Core Loop execution", () => {
  it("creates a fresh Copilot session with the configured model (spec: isolated context)", async () => {
    await runBuildSession(
      mockClient as unknown as CopilotClient,
      1,
      "do something",
      makeConfig({ model: "gpt-4.1" }),
    );

    expect(mockClient.createSession).toHaveBeenCalledOnce();
    expect(mockClient.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4.1" }),
    );
  });

  it("sends the prompt via session.sendAndWait (spec: send prompt and wait for completion)", async () => {
    const prompt = "implement the upload strategy";
    await runBuildSession(
      mockClient as unknown as CopilotClient,
      2,
      prompt,
      makeConfig(),
    );

    expect(mockSession.sendAndWait).toHaveBeenCalledOnce();
    expect(mockSession.sendAndWait).toHaveBeenCalledWith({ prompt }, 30_000);
  });

  it("destroys the session after successful completion (spec: destroy the session)", async () => {
    await runBuildSession(
      mockClient as unknown as CopilotClient,
      3,
      "prompt",
      makeConfig(),
    );

    expect(mockSession.destroy).toHaveBeenCalledOnce();
  });

  it("destroys the session even when sendAndWait throws (spec: destroy the session)", async () => {
    mockSession.sendAndWait.mockRejectedValue(new Error("timeout"));

    const result = await runBuildSession(
      mockClient as unknown as CopilotClient,
      4,
      "prompt",
      makeConfig(),
    );

    expect(mockSession.destroy).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
  });

  it("registers event handlers on the session (spec: tool event tracking)", async () => {
    await runBuildSession(
      mockClient as unknown as CopilotClient,
      5,
      "prompt",
      makeConfig(),
    );

    // session.on() is called to register the tool-event handler
    expect(mockSession.on).toHaveBeenCalledOnce();
    // The handler is a function
    expect(typeof mockSession.on.mock.calls[0]?.[0]).toBe("function");
  });

  it("returns success=true when session completes without error", async () => {
    const result = await runBuildSession(
      mockClient as unknown as CopilotClient,
      6,
      "prompt",
      makeConfig(),
    );
    expect(result.success).toBe(true);
  });

  it("returns success=false and does not throw when sendAndWait errors", async () => {
    mockSession.sendAndWait.mockRejectedValue(new Error("network error"));

    await expect(
      runBuildSession(
        mockClient as unknown as CopilotClient,
        7,
        "prompt",
        makeConfig(),
      ),
    ).resolves.toMatchObject({ success: false });
  });

  it("tracks tool counts via the tool.execution_start event", async () => {
    // Simulate the handler being called with tool events after session.on() registers it
    mockSession.on.mockImplementation((handler: (event: unknown) => void) => {
      handler({
        type: "tool.execution_start",
        data: {
          toolName: "bash",
          toolCallId: "tc-1",
          arguments: { command: "ls" },
        },
      });
      handler({
        type: "tool.execution_start",
        data: {
          toolName: "bash",
          toolCallId: "tc-2",
          arguments: { command: "pwd" },
        },
      });
      handler({
        type: "tool.execution_start",
        data: {
          toolName: "view",
          toolCallId: "tc-3",
          arguments: { path: "/tmp" },
        },
      });
    });

    const result = await runBuildSession(
      mockClient as unknown as CopilotClient,
      8,
      "prompt",
      makeConfig(),
    );

    expect(result.tools.counts["bash"]).toBe(2);
    expect(result.tools.counts["view"]).toBe(1);
    expect(result.tools.summary).toContain("bash×2");
    expect(result.tools.summary).toContain("view×1");
  });

  it("logs iteration outcome with elapsed time and tool summary", async () => {
    const logs: string[] = [];
    await runBuildSession(
      mockClient as unknown as CopilotClient,
      9,
      "prompt",
      makeConfig(),
      (msg) => logs.push(msg),
    );

    const iterLog = logs.find((l) => l.includes("Iteration 9 complete"));
    expect(iterLog).toBeDefined();
    expect(iterLog).toMatch(/Iteration 9 complete in \d+s/);
  });

  it("uses the configured timeout when calling sendAndWait", async () => {
    await runBuildSession(
      mockClient as unknown as CopilotClient,
      10,
      "prompt",
      makeConfig({ timeout: 120_000 }),
    );

    expect(mockSession.sendAndWait).toHaveBeenCalledWith(
      expect.anything(),
      120_000,
    );
  });
});
