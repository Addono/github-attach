import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createReleaseAssetStrategy } from "../../core/strategies/releaseAsset.js";
import { createBrowserSessionStrategy } from "../../core/strategies/browserSession.js";
import { createCookieExtractionStrategy } from "../../core/strategies/cookieExtraction.js";
import { createRepoBranchStrategy } from "../../core/strategies/repoBranch.js";
import {
  getSessionCookies,
  getSessionToken,
  loadSession,
} from "../../core/session.js";
import { resolveGitHubCliAuth } from "../../core/githubCliAuth.js";
import { parseTarget } from "../../core/target.js";
import { validateFile } from "../../core/validation.js";
import { upload } from "../../core/upload.js";
import { loadConfig } from "./config.js";
import { debug } from "../output.js";
import { ValidationError, NoStrategyAvailableError } from "../../core/types.js";
import type { UploadStrategy, UploadTarget } from "../../core/types.js";

interface UploadOptions {
  target?: string;
  strategy?: string;
  format?: "markdown" | "url" | "json";
  stdin?: boolean;
  filename?: string;
}

/**
 * Default strategy order per spec.
 */
const DEFAULT_STRATEGY_ORDER = [
  "browser-session",
  "cookie-extraction",
  "release-asset",
  "repo-branch",
];

/**
 * Resolved authentication context shared between strategy factories.
 *
 * Tokens are sourced in this order:
 *   1. `GITHUB_TOKEN` environment variable
 *   2. `GH_TOKEN` environment variable
 *   3. GitHub CLI (`gh auth token`) — picks the account most likely to have
 *      access to the upload target when one is provided
 *
 * @internal
 */
interface ResolvedAuth {
  /** GitHub API token usable for release-asset and repo-branch strategies. */
  apiToken?: string;
  /** Cookies for the browser-session strategy. */
  cookies?: string;
  /** Session token (saved via `gh-attach login`) for the browser-session strategy. */
  sessionToken?: string;
}

/**
 * Resolves authentication for the upload command.
 *
 * Tries the `GITHUB_TOKEN` / `GH_TOKEN` environment variables first, then
 * falls back to the GitHub CLI's stored token (`gh auth token`). When a
 * `target` is provided, the gh CLI lookup picks the account most likely to
 * have access to the target repository.
 *
 * @internal
 */
async function resolveAuth(target?: UploadTarget): Promise<ResolvedAuth> {
  const session = loadSession();
  const cookies = process.env.GH_ATTACH_COOKIES ?? getSessionCookies(session);
  const sessionToken = getSessionToken(session);

  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) {
    return {
      apiToken: envToken,
      cookies: cookies ?? undefined,
      sessionToken: sessionToken ?? undefined,
    };
  }

  const ghCliAuth = await resolveGitHubCliAuth({
    owner: target?.owner,
    repo: target?.repo,
  });

  if (ghCliAuth.token) {
    debug(
      `Using GitHub CLI token${ghCliAuth.login ? ` for user '${ghCliAuth.login}'` : ""}`,
    );
    return {
      apiToken: ghCliAuth.token,
      cookies: cookies ?? undefined,
      sessionToken: sessionToken ?? undefined,
    };
  }

  return {
    cookies: cookies ?? undefined,
    sessionToken: sessionToken ?? undefined,
  };
}

/**
 * Create a strategy instance by name using the resolved auth context.
 */
function createStrategy(
  name: string,
  auth: ResolvedAuth,
): UploadStrategy | null {
  switch (name) {
    case "browser-session":
      if (auth.cookies || auth.sessionToken) {
        return createBrowserSessionStrategy({
          cookies: auth.cookies,
          token: auth.sessionToken,
        });
      }
      return null;
    case "cookie-extraction":
      return createCookieExtractionStrategy();
    case "release-asset":
      if (auth.apiToken) {
        return createReleaseAssetStrategy(auth.apiToken);
      }
      return null;
    case "repo-branch":
      if (auth.apiToken) {
        return createRepoBranchStrategy(auth.apiToken);
      }
      return null;
    default:
      return null;
  }
}

/**
 * Upload command implementation.
 */
export async function uploadCommand(files: string[], options: UploadOptions) {
  const config = loadConfig();

  // Handle stdin input
  if (options.stdin) {
    if (!options.filename) {
      throw new ValidationError(
        "--filename is required when using --stdin",
        "MISSING_FILENAME",
      );
    }
    const stdinBuffer = await readStdin();
    const tempFile = join(tmpdir(), options.filename);
    writeFileSync(tempFile, stdinBuffer);
    files = [tempFile];
  }

  if (files.length === 0) {
    throw new ValidationError(
      "At least one file is required. Use --stdin with --filename to read from stdin.",
      "NO_FILES",
    );
  }

  // Resolve target: CLI option > config > error
  let targetRef = options.target;
  if (!targetRef) {
    const defaultTarget = config["default-target"];
    if (typeof defaultTarget === "string") {
      targetRef = defaultTarget;
      debug(`Using default target from config: ${targetRef}`);
    } else {
      throw new ValidationError(
        "Target is required. Use --target or set default-target in config.",
        "MISSING_TARGET",
      );
    }
  }

  // Parse target
  const uploadTarget = parseTarget(targetRef);

  // Resolve authentication: env vars first, then gh CLI fallback.
  const auth = await resolveAuth(uploadTarget);

  // Resolve strategy: CLI option > environment variable > config > default
  const explicitStrategy = options.strategy || process.env.GH_ATTACH_STRATEGY;

  // Build strategies list
  const strategies: UploadStrategy[] = [];

  if (explicitStrategy) {
    // Use only the specified strategy
    debug(`Using explicit strategy: ${explicitStrategy}`);
    const strategy = createStrategy(explicitStrategy, auth);
    if (!strategy) {
      throw new NoStrategyAvailableError(
        `Strategy '${explicitStrategy}' is not available. ` +
          "Provide credentials via GITHUB_TOKEN/GH_TOKEN, authenticate with the GitHub CLI ('gh auth login'), or run 'gh-attach login' for browser-session uploads.",
        [{ strategy: explicitStrategy, reason: "not available" }],
      );
    }
    strategies.push(strategy);
  } else {
    // Use strategy order from config or default
    const configOrder = config["strategy-order"];
    const strategyOrder = Array.isArray(configOrder)
      ? configOrder
      : DEFAULT_STRATEGY_ORDER;

    debug(`Strategy order: ${strategyOrder.join(", ")}`);

    for (const name of strategyOrder) {
      const strategy = createStrategy(name, auth);
      if (strategy) {
        strategies.push(strategy);
      }
    }
  }

  if (strategies.length === 0) {
    throw new NoStrategyAvailableError(
      "No authentication available. Set GITHUB_TOKEN (or GH_TOKEN), authenticate with the GitHub CLI ('gh auth login'), provide GH_ATTACH_COOKIES, or run 'gh-attach login' to save a browser session.",
      DEFAULT_STRATEGY_ORDER.map((s) => ({
        strategy: s,
        reason: "not configured",
      })),
    );
  }

  // Process files
  const results = [];
  try {
    for (const file of files) {
      // Validate file — errors propagate with original types
      await validateFile(file);

      // Upload file — errors propagate with original types
      const result = await upload(file, uploadTarget, strategies);
      results.push(result);
    }

    // Output results
    const format = options.format || "markdown";
    for (const result of results) {
      switch (format) {
        case "url":
          console.log(result.url);
          break;
        case "json":
          console.log(JSON.stringify(result, null, 2));
          break;
        case "markdown":
        default:
          console.log(result.markdown);
      }
    }
  } finally {
    // Clean up temp files from stdin
    if (options.stdin) {
      for (const file of files) {
        try {
          unlinkSync(file);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}

/**
 * Reads file data from stdin.
 */
async function readStdin(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    process.stdin.on("error", reject);
  });
}
