import { describe, expect, it } from "vitest";
import { shouldEmitLog } from "../../../src/ralph/logging";

describe("shouldEmitLog", () => {
  it("suppresses debug logs when RALPH_QUIET=1", () => {
    expect(shouldEmitLog("DEBUG", { RALPH_QUIET: "1" })).toBe(false);
  });

  it("keeps non-debug logs visible when RALPH_QUIET=1", () => {
    expect(shouldEmitLog("INFO", { RALPH_QUIET: "1" })).toBe(true);
    expect(shouldEmitLog("WARN", { RALPH_QUIET: "1" })).toBe(true);
    expect(shouldEmitLog("ERROR", { RALPH_QUIET: "1" })).toBe(true);
  });

  it("emits debug logs by default", () => {
    expect(shouldEmitLog("DEBUG", {})).toBe(true);
    expect(shouldEmitLog("DEBUG", { RALPH_QUIET: "0" })).toBe(true);
  });
});
