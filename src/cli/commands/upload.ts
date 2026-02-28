import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createReleaseAssetStrategy } from "../../core/strategies/releaseAsset.js";
import { createBrowserSessionStrategy } from "../../core/strategies/browserSession.js";
import { createCookieExtractionStrategy } from "../../core/strategies/cookieExtraction.js";
import { createRepoBranchStrategy } from "../../core/strategies/repoBranch.js";
import { parseTarget } from "../../core/target.js";
import { validateFile } from "../../core/validation.js";
import { upload } from "../../core/upload.js";
import { loadConfig } from "./config.js";
import { debug } from "../index.js";
import type { UploadStrategy } from "../../core/types.js";

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
 * Create a strategy instance by name.
 */
function createStrategy(name: string): UploadStrategy | null {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const cookies = process.env.GH_ATTACH_COOKIES;

  switch (name) {
    case "browser-session":
      if (cookies) {
        return createBrowserSessionStrategy(cookies);
      }
      return null;
    case "cookie-extraction":
      return createCookieExtractionStrategy();
    case "release-asset":
      if (token) {
        return createReleaseAssetStrategy(token);
      }
      return null;
    case "repo-branch":
      if (token) {
        return createRepoBranchStrategy(token);
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
      throw new Error("--filename is required when using --stdin");
    }
    const stdinBuffer = await readStdin();
    const tempFile = join(tmpdir(), options.filename);
    writeFileSync(tempFile, stdinBuffer);
    files = [tempFile];
  }

  // Resolve target: CLI option > config > error
  let targetRef = options.target;
  if (!targetRef) {
    const defaultTarget = config["default-target"];
    if (typeof defaultTarget === "string") {
      targetRef = defaultTarget;
      debug(`Using default target from config: ${targetRef}`);
    } else {
      throw new Error(
        "Target is required. Use --target or set default-target in config.",
      );
    }
  }

  // Parse target
  let uploadTarget;
  try {
    uploadTarget = parseTarget(targetRef);
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Invalid target: ${err.message}`);
    }
    throw err;
  }

  // Resolve strategy: CLI option > environment variable > config > default
  const explicitStrategy =
    options.strategy || process.env.GH_ATTACH_STRATEGY;

  // Build strategies list
  const strategies: UploadStrategy[] = [];

  if (explicitStrategy) {
    // Use only the specified strategy
    debug(`Using explicit strategy: ${explicitStrategy}`);
    const strategy = createStrategy(explicitStrategy);
    if (!strategy) {
      throw new Error(
        `Strategy '${explicitStrategy}' is not available. ` +
          "Check that required environment variables are set.",
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
      const strategy = createStrategy(name);
      if (strategy) {
        strategies.push(strategy);
      }
    }
  }

  if (strategies.length === 0) {
    throw new Error(
      "No authentication available. Set GITHUB_TOKEN (or GH_TOKEN) or GH_ATTACH_COOKIES",
    );
  }

  // Process files
  const results = [];
  try {
    for (const file of files) {
      // Validate file
      try {
        await validateFile(file);
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(`File validation failed: ${err.message}`);
        }
        throw err;
      }

      // Upload file
      try {
        const result = await upload(file, uploadTarget, strategies);
        results.push(result);
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(`Upload failed: ${err.message}`);
        }
        throw err;
      }
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
 * Reads image data from stdin.
 */
async function readStdin(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    process.stdin.on("error", reject);
  });
}
