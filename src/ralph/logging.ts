/**
 * Supported Ralph loop log levels.
 */
export type RalphLogLevel =
  | "INFO"
  | "DEBUG"
  | "WARN"
  | "ERROR"
  | "EVAL"
  | "GITHUB"
  | "ITER"
  | "MODEL";

/**
 * Decide whether a log line should be emitted for the current environment.
 * `RALPH_QUIET=1` suppresses debug logs while keeping higher-severity output visible.
 */
export function shouldEmitLog(
  level: RalphLogLevel,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !(level === "DEBUG" && env.RALPH_QUIET === "1");
}
