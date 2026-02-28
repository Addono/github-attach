const DEFAULT_EVALUATION_TIMEOUT_MS = 480_000;
const MIN_EVALUATION_TIMEOUT_MS = 180_000;
const MAX_EVALUATION_TIMEOUT_MS = 600_000;

/**
 * Resolve a bounded timeout for the fitness-evaluation session.
 * Using the iteration timeout as a source keeps evaluation behavior aligned with loop configuration.
 */
export function resolveEvaluationTimeoutMs(iterationTimeoutMs: number): number {
  const baseTimeout =
    Number.isFinite(iterationTimeoutMs) && iterationTimeoutMs > 0
      ? iterationTimeoutMs
      : DEFAULT_EVALUATION_TIMEOUT_MS;
  return Math.min(
    MAX_EVALUATION_TIMEOUT_MS,
    Math.max(MIN_EVALUATION_TIMEOUT_MS, baseTimeout),
  );
}

/**
 * Detect the Copilot SDK timeout shape emitted when waiting for session idle.
 */
export function isSessionIdleTimeoutError(error: unknown): boolean {
  const messages = collectErrorMessages(error);
  return messages.some((message) =>
    /(timeout.*session\.idle|session\.idle.*timeout)/i.test(message),
  );
}

/**
 * Extract and parse the first valid fitness-score JSON object from model output.
 * This is resilient to surrounding prose/code fences and skips malformed objects.
 */
export function extractFitnessJsonPayload(
  content: string,
): Record<string, unknown> | null {
  const candidates = [content, ...extractFencedBlocks(content)];
  for (const candidate of candidates) {
    const parsed = extractFirstValidFitnessObject(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function extractFencedBlocks(content: string): string[] {
  const blocks: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match = fenceRegex.exec(content);
  while (match) {
    const body = match[1]?.trim();
    if (body) blocks.push(body);
    match = fenceRegex.exec(content);
  }
  return blocks;
}

function extractFirstValidFitnessObject(
  text: string,
): Record<string, unknown> | null {
  for (const jsonSlice of getJsonObjectSlices(text)) {
    try {
      const parsed = JSON.parse(jsonSlice);
      if (isFitnessPayload(parsed)) return parsed;
    } catch {
      // Keep scanning for later valid objects.
    }
  }
  return null;
}

function* getJsonObjectSlices(text: string): Generator<string> {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (!char) continue;
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) {
          yield text.slice(start, i + 1);
          break;
        }
      }
    }
  }
}

function isFitnessPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return [
    "specCompliance",
    "testCoverage",
    "codeQuality",
    "buildHealth",
    "aggregate",
  ].every((key) => key in raw);
}

function collectErrorMessages(error: unknown, depth = 0): string[] {
  if (depth > 4 || error === null || error === undefined) return [];

  if (typeof error === "string") {
    return [error];
  }

  if (error instanceof Error) {
    return [
      error.message,
      String(error),
      ...collectErrorMessages(error.cause, depth + 1),
    ].filter((value) => value.length > 0);
  }

  if (typeof error === "object") {
    const raw = error as Record<string, unknown>;
    const messages = [
      typeof raw.message === "string" ? raw.message : "",
      typeof raw.error === "string" ? raw.error : "",
      typeof raw.details === "string" ? raw.details : "",
      String(error),
      ...collectErrorMessages(raw.cause, depth + 1),
    ];
    return messages.filter((value) => value.length > 0);
  }

  return [String(error)];
}
