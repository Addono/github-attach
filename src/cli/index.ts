/**
 * gh-attach CLI entry point.
 *
 * Separates program creation ({@link createProgram}) from execution so the
 * CLI can be imported and tested without triggering `program.parse()`.
 */

// Suppress ExperimentalWarning for the Fetch API (emitted on Node < 21).
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning") return;
  process.stderr.write(`${warning.stack ?? warning.message}\n`);
});

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import {
  AuthenticationError,
  ValidationError,
  UploadError,
} from "../core/types.js";
import { globalOptions } from "./output.js";
export { debug, info } from "./output.js";
export type { GlobalOptions } from "./output.js";

/**
 * Maps an error to the appropriate CLI exit code.
 *
 * Exit codes per CLI specification:
 * - 0: Success
 * - 1: General error
 * - 2: Authentication error
 * - 3: Validation error
 * - 4: Network/upload error
 */
export function getExitCode(err: unknown): number {
  if (err instanceof AuthenticationError) {
    return 2;
  }
  if (err instanceof ValidationError) {
    return 3;
  }
  if (err instanceof UploadError) {
    return 4;
  }
  return 1;
}

/**
 * Resolves the package version by reading the nearest `package.json`.
 *
 * Works in both source (`src/cli/`) and dist (`dist/`) layouts.
 */
export function resolveVersion(): string {
  // In pkg binary builds, version is injected at build time
  if (process.env.__PKG_VERSION__) {
    return process.env.__PKG_VERSION__;
  }
  const dir = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(
    dir,
    dir.endsWith("/src/cli") ? "../.." : "..",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    version: string;
  };
  return pkg.version;
}

/**
 * Creates and configures the Commander program with all commands and options.
 *
 * Exported separately from `parse()` so tests can inspect the command tree
 * without side effects.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("gh-attach")
    .description("Upload images and videos to GitHub issues, PRs, and comments")
    .version(resolveVersion())
    .option("-v, --verbose", "Print debug information to stderr")
    .option(
      "-q, --quiet",
      "Suppress all output except the final result or errors",
    )
    .option("--no-color", "Disable ANSI color codes in output")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts();
      globalOptions.verbose = opts.verbose ?? false;
      globalOptions.quiet = opts.quiet ?? false;
      globalOptions.noColor = opts.color === false || !!process.env.NO_COLOR;
    });

  program
    .command("upload")
    .description("Upload an image or video and get GitHub-ready output")
    .argument("[files...]", "Image or video file(s) to upload")
    .option(
      "--target <ref>",
      "GitHub issue/PR reference (owner/repo#N, #N, or URL)",
    )
    .option(
      "--strategy <name>",
      "Upload strategy: release-asset, repo-branch, browser-session, cookie-extraction",
    )
    .option("--format <type>", "Output format: markdown, url, json", "markdown")
    .option("--stdin", "Read image from stdin")
    .option("--filename <name>", "Filename when using --stdin")
    .action(async (files, options) => {
      try {
        const { uploadCommand } = await import("./commands/upload.js");
        await uploadCommand(files, options);
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Error: ${String(err)}`);
        }
        process.exit(getExitCode(err));
      }
    });

  program
    .command("login")
    .description("Authenticate with GitHub via browser")
    .option("--state-path <path>", "Path to save session state")
    .option("--status", "Check current authentication status")
    .action(async (options) => {
      try {
        const { loginCommand } = await import("./commands/login.js");
        await loginCommand(options);
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Error: ${String(err)}`);
        }
        process.exit(getExitCode(err));
      }
    });

  program
    .command("config")
    .description("Manage gh-attach configuration")
    .argument("[action]", "Action: list, set, get (default: list)")
    .argument("[key]", "Configuration key")
    .argument("[value]", "Configuration value")
    .action(async (action, key, value) => {
      action ??= "list";
      try {
        const { configCommand } = await import("./commands/config.js");
        await configCommand(action, key, value);
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Error: ${String(err)}`);
        }
        process.exit(getExitCode(err));
      }
    });

  program
    .command("mcp")
    .description("Start the MCP server")
    .option("--transport <type>", "Transport: stdio, http", "stdio")
    .option("--port <number>", "Port for HTTP transport", "3000")
    .action(async (options) => {
      try {
        const { mcpCommand } = await import("./commands/mcp.js");
        await mcpCommand(options);
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Error: ${String(err)}`);
        }
        process.exit(getExitCode(err));
      }
    });

  return program;
}

// Only parse when executed as the CLI entry point (not when imported by tests)
const program = createProgram();
program.parse();
