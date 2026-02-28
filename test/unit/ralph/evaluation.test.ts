import { describe, expect, it } from "vitest";
import {
  extractFitnessJsonPayload,
  isSessionIdleTimeoutError,
  resolveEvaluationTimeoutMs,
} from "../../../src/ralph/evaluation";

describe("resolveEvaluationTimeoutMs", () => {
  it("clamps to minimum when timeout is too low", () => {
    expect(resolveEvaluationTimeoutMs(60_000)).toBe(180_000);
  });

  it("uses provided timeout when in supported range", () => {
    expect(resolveEvaluationTimeoutMs(300_000)).toBe(300_000);
  });

  it("clamps to maximum when timeout is too high", () => {
    expect(resolveEvaluationTimeoutMs(900_000)).toBe(600_000);
  });

  it("uses default when timeout is invalid", () => {
    expect(resolveEvaluationTimeoutMs(Number.NaN)).toBe(480_000);
  });
});

describe("isSessionIdleTimeoutError", () => {
  it("detects session idle timeout errors", () => {
    const err = new Error("Timeout after 180000ms waiting for session.idle");
    expect(isSessionIdleTimeoutError(err)).toBe(true);
  });

  it("detects timeout errors from plain strings", () => {
    expect(
      isSessionIdleTimeoutError(
        "Timeout after 180000ms waiting for session.idle",
      ),
    ).toBe(true);
  });

  it("detects timeout errors nested under cause", () => {
    const err = {
      message: "request failed",
      cause: new Error("Timeout after 180000ms waiting for session.idle"),
    };
    expect(isSessionIdleTimeoutError(err)).toBe(true);
  });

  it("returns false for non-timeout errors", () => {
    expect(isSessionIdleTimeoutError(new Error("Network failure"))).toBe(false);
  });
});

describe("extractFitnessJsonPayload", () => {
  it("parses plain JSON payloads", () => {
    const raw = JSON.stringify({
      specCompliance: 80,
      testCoverage: 85,
      codeQuality: 90,
      buildHealth: 95,
      aggregate: 87,
      notes: "ok",
      checklist: [],
    });
    expect(extractFitnessJsonPayload(raw)?.aggregate).toBe(87);
  });

  it("extracts JSON from fenced blocks with surrounding text", () => {
    const raw = [
      "Here are your scores:",
      "```json",
      '{"specCompliance":70,"testCoverage":60,"codeQuality":65,"buildHealth":75,"aggregate":68,"notes":"x","checklist":[]}',
      "```",
      "Done.",
    ].join("\n");
    expect(extractFitnessJsonPayload(raw)?.specCompliance).toBe(70);
  });

  it("skips malformed JSON objects and finds the next valid payload", () => {
    const raw = [
      'noise {"not":"fitness"}',
      '{"specCompliance": bad-json }',
      '{"specCompliance":88,"testCoverage":89,"codeQuality":90,"buildHealth":91,"aggregate":90,"notes":"good","checklist":[]}',
    ].join("\n");
    expect(extractFitnessJsonPayload(raw)?.buildHealth).toBe(91);
  });

  it("returns null when no valid fitness payload is present", () => {
    expect(extractFitnessJsonPayload('{"hello":"world"}')).toBeNull();
  });
});
