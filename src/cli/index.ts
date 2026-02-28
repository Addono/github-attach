#!/usr/bin/env node

/**
 * gh-attach CLI entry point.
 */

import { Command } from "commander";

const program = new Command();

program
  .name("gh-attach")
  .description("Upload images to GitHub issues, PRs, and comments")
  .version("0.0.0-development");

program
  .command("upload")
  .description("Upload an image and get a markdown embed URL")
  .argument("<files...>", "Image file(s) to upload")
  .requiredOption("--target <ref>", "GitHub issue/PR reference (owner/repo#N, #N, or URL)")
  .option("--strategy <name>", "Upload strategy to use")
  .option("--format <type>", "Output format: markdown, url, json", "markdown")
  .option("--stdin", "Read image from stdin")
  .option("--filename <name>", "Filename when using --stdin")
  .action(async (_files, _options) => {
    // TODO: Implement upload command
    console.error("Upload command not yet implemented");
    process.exit(1);
  });

program
  .command("login")
  .description("Authenticate with GitHub via browser")
  .option("--state-path <path>", "Path to save session state")
  .option("--status", "Check current authentication status")
  .action(async (_options) => {
    // TODO: Implement login command
    console.error("Login command not yet implemented");
    process.exit(1);
  });

program
  .command("config")
  .description("Manage gh-attach configuration")
  .argument("<action>", "Action: list, set, get")
  .argument("[key]", "Configuration key")
  .argument("[value]", "Configuration value")
  .action(async (_action, _key, _value) => {
    // TODO: Implement config command
    console.error("Config command not yet implemented");
    process.exit(1);
  });

program
  .command("mcp")
  .description("Start the MCP server")
  .option("--transport <type>", "Transport: stdio, http", "stdio")
  .option("--port <number>", "Port for HTTP transport", "3000")
  .action(async (_options) => {
    // TODO: Implement MCP server command
    console.error("MCP server not yet implemented");
    process.exit(1);
  });

program.parse();
