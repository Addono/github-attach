/**
 * gh-attach CLI entry point.
 */

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import {
  AuthenticationError,
  ValidationError,
  UploadError,
} from "../core/types.js";

/**
 * Global CLI options that apply to all commands.
 */
export interface GlobalOptions {
  verbose?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

/**
 * Global state for CLI options.
 */
export const globalOptions: GlobalOptions = {};

/**
 * Log debug information (only in verbose mode).
 */
export function debug(message: string): void {
  if (globalOptions.verbose && !globalOptions.quiet) {
    console.error(`[debug] ${message}`);
  }
}

/**
 * Log informational message (suppressed in quiet mode).
 */
export function info(message: string): void {
  if (!globalOptions.quiet) {
    console.log(message);
  }
}

/**
 * Exit codes per CLI specification:
 * - 0: Success
 * - 1: General error
 * - 2: Authentication error
 * - 3: Validation error
 * - 4: Network/upload error
 */
function getExitCode(err: unknown): number {
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

// Get package.json from the project root (works in both src and dist)
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

const program = new Command();

program
  .name("gh-attach")
  .description("Upload images to GitHub issues, PRs, and comments")
  .version(pkg.version)
  .option("-v, --verbose", "Print debug information to stderr")
  .option("-q, --quiet", "Suppress all output except the final result or errors")
  .option("--no-color", "Disable ANSI color codes in output")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    globalOptions.verbose = opts.verbose ?? false;
    globalOptions.quiet = opts.quiet ?? false;
    // Check both flag and NO_COLOR environment variable
    globalOptions.noColor = opts.color === false || !!process.env.NO_COLOR;
  });

program
  .command("upload")
  .description("Upload an image and get a markdown embed URL")
  .argument("<files...>", "Image file(s) to upload")
  .option(
    "--target <ref>",
    "GitHub issue/PR reference (owner/repo#N, #N, or URL)",
  )
  .option("--strategy <name>", "Upload strategy to use")
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
  .argument("<action>", "Action: list, set, get")
  .argument("[key]", "Configuration key")
  .argument("[value]", "Configuration value")
  .action(async (action, key, value) => {
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

program.parse();
