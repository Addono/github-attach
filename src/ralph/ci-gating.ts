export interface CommandCheckResult {
  success: boolean;
  output: string;
}

export type CiBuildStatus = "success" | "failed" | "skipped";
export type CiTestStatus = "success" | "failed" | "skipped";
export type CiLintStatus = "success" | "warnings" | "failed" | "skipped";

/** Persisted CI status snapshot used for iteration gating and reporting. */
export interface CiStatus {
  passed: boolean;
  lastCheck: string;
  buildStatus: CiBuildStatus;
  testStatus: CiTestStatus;
  lintStatus: CiLintStatus;
  buildError?: string;
  testError?: string;
  lintError?: string;
  lintWarningCount?: number;
  lintWarningRules?: string[];
  lintWarningFiles?: string[];
}

export interface LintWarningSummary {
  count: number;
  topRules: string[];
  topFiles: string[];
}

/** Create default CI status for state migration before the first check has run. */
export function defaultCiStatus(): CiStatus {
  return {
    passed: true,
    lastCheck: "",
    buildStatus: "skipped",
    testStatus: "skipped",
    lintStatus: "skipped",
    lintWarningCount: 0,
    lintWarningRules: [],
    lintWarningFiles: [],
  };
}

/** Normalize CI status loaded from disk to maintain backward compatibility. */
export function normalizeCiStatus(input: unknown): CiStatus {
  const base = defaultCiStatus();
  if (!input || typeof input !== "object") return base;
  const raw = input as Partial<CiStatus>;
  return {
    passed: typeof raw.passed === "boolean" ? raw.passed : base.passed,
    lastCheck: typeof raw.lastCheck === "string" ? raw.lastCheck : base.lastCheck,
    buildStatus: raw.buildStatus ?? base.buildStatus,
    testStatus: raw.testStatus ?? base.testStatus,
    lintStatus: raw.lintStatus ?? base.lintStatus,
    buildError: typeof raw.buildError === "string" ? raw.buildError : undefined,
    testError: typeof raw.testError === "string" ? raw.testError : undefined,
    lintError: typeof raw.lintError === "string" ? raw.lintError : undefined,
    lintWarningCount:
      typeof raw.lintWarningCount === "number" ? raw.lintWarningCount : 0,
    lintWarningRules: Array.isArray(raw.lintWarningRules)
      ? raw.lintWarningRules.filter((v): v is string => typeof v === "string")
      : [],
    lintWarningFiles: Array.isArray(raw.lintWarningFiles)
      ? raw.lintWarningFiles.filter((v): v is string => typeof v === "string")
      : [],
  };
}

/** Parse ESLint warning output and extract warning count, top rules, and top files. */
export function parseLintWarnings(output: string): LintWarningSummary {
  const byRule: Record<string, number> = {};
  const byFile: Record<string, number> = {};

  const lineRegex =
    /^(?<file>.+?):\d+:\d+\s+warning\s+.+?\s{2,}(?<rule>@?[\w/-]+)\s*$/gm;
  let match: RegExpExecArray | null = lineRegex.exec(output);
  while (match) {
    const file = match.groups?.file?.trim();
    const rule = match.groups?.rule?.trim();
    if (file) byFile[file] = (byFile[file] ?? 0) + 1;
    if (rule) byRule[rule] = (byRule[rule] ?? 0) + 1;
    match = lineRegex.exec(output);
  }

  const fallbackSummary = output.match(/(\d+)\s+warnings?/i);
  const explicitCount = Object.values(byRule).reduce((acc, n) => acc + n, 0);
  const count = explicitCount || Number(fallbackSummary?.[1] ?? 0);

  const topRules = Object.entries(byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([rule]) => rule);

  const topFiles = Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file]) => file);

  return { count, topRules, topFiles };
}

/** Derive normalized CI status from build/test/lint command outputs. */
export function deriveCiStatus(
  build: CommandCheckResult,
  test: CommandCheckResult,
  lint: CommandCheckResult,
  checkedAt = new Date().toISOString(),
): { status: CiStatus; lintSummary: LintWarningSummary } {
  const lintSummary = parseLintWarnings(lint.output);
  const lintStatus: CiLintStatus = lint.success
    ? lintSummary.count > 0
      ? "warnings"
      : "success"
    : "failed";

  const status: CiStatus = {
    passed: build.success && test.success && lintStatus !== "failed",
    lastCheck: checkedAt,
    buildStatus: build.success ? "success" : "failed",
    testStatus: test.success ? "success" : "failed",
    lintStatus,
    buildError: build.success ? undefined : build.output.slice(0, 200),
    testError: test.success ? undefined : test.output.slice(0, 200),
    lintError: lint.success ? undefined : lint.output.slice(0, 200),
    lintWarningCount: lintSummary.count,
    lintWarningRules: lintSummary.topRules,
    lintWarningFiles: lintSummary.topFiles,
  };

  return { status, lintSummary };
}

/** True when CI has hard failures that should block feature work. */
export function isCiBroken(ciStatus: CiStatus): boolean {
  return (
    ciStatus.buildStatus === "failed" ||
    ciStatus.testStatus === "failed" ||
    ciStatus.lintStatus === "failed"
  );
}

/** Build CI status section injected into the build prompt for next iteration. */
export function generateCiPromptContext(ciStatus: CiStatus): string {
  if (!ciStatus.lastCheck) return "";

  if (isCiBroken(ciStatus)) {
    const details = [ciStatus.buildError, ciStatus.testError, ciStatus.lintError]
      .filter((v): v is string => Boolean(v))
      .map((v) => `- ${v.replace(/\s+/g, " ").slice(0, 200)}`)
      .join("\n");
    return `\n[CI Status] ❌ Build/Test/Lint failures detected\n${details ? `Failure details:\n${details}\n` : ""}Do not work on new features. Instead, focus EXCLUSIVELY on fixing the failing CI.\n`;
  }

  if (ciStatus.lintStatus === "warnings") {
    const count = ciStatus.lintWarningCount ?? 0;
    return `\n[CI Status] ⚠️ Lint produced ${count} warnings; build and tests pass\nRecommend addressing lint warnings before major commits.\n`;
  }

  return "\n[CI Status] ✅ All checks pass\n";
}

/** Build CI summary lines for GitHub evaluation comments. */
export function generateCiCommentSummary(ciStatus: CiStatus): string {
  if (!ciStatus.lastCheck) return "✅ CI: All checks pass";

  if (isCiBroken(ciStatus)) {
    const failures = [
      ciStatus.buildStatus === "failed" ? "build" : null,
      ciStatus.testStatus === "failed" ? "test" : null,
      ciStatus.lintStatus === "failed" ? "lint" : null,
    ]
      .filter((v): v is string => Boolean(v))
      .join(", ");

    const error = ciStatus.buildError ?? ciStatus.testError ?? ciStatus.lintError ?? "no details";
    return `❌ CI: Build/Test/Lint failed (${failures}) — ${error.replace(/\s+/g, " ").slice(0, 200)}`;
  }

  if (ciStatus.lintStatus === "warnings") {
    return `⚠️ CI: ${ciStatus.lintWarningCount ?? 0} lint warnings`;
  }

  return "✅ CI: All checks pass";
}

/** Build the issue comment body to post when CI is currently blocking work. */
export function generateCiBlockedComment(iteration: number, ciStatus: CiStatus): string {
  const failureType = [
    ciStatus.buildStatus === "failed" ? "build" : null,
    ciStatus.testStatus === "failed" ? "test" : null,
    ciStatus.lintStatus === "failed" ? "lint" : null,
  ]
    .filter((v): v is string => Boolean(v))
    .join(", ");

  const error = (ciStatus.buildError ?? ciStatus.testError ?? ciStatus.lintError ?? "No error message captured")
    .replace(/\s+/g, " ")
    .slice(0, 200);

  return `🚨 **CI BLOCKED at Iteration ${iteration}**\n\nCurrent failure:\n${failureType}: ${error}\n\nNext iteration will focus on fixing this before resuming feature work.`;
}
