/**
 * gh-attach MCP server implementation.
 * Provides image upload functionality via the Model Context Protocol.
 * Supports stdio and HTTP transports.
 */

import { randomUUID } from "crypto";
import { writeFileSync, unlinkSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createServer } from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createReleaseAssetStrategy,
  createBrowserSessionStrategy,
  createCookieExtractionStrategy,
  createRepoBranchStrategy,
} from "../core/strategies/index.js";
import { parseTarget } from "../core/target.js";
import { validateFile } from "../core/validation.js";
import { upload } from "../core/upload.js";
import type { UploadStrategy } from "../core/types.js";

// Get package version
function getPackageVersion(): string {
  try {
    const pkgPath = new URL("../../package.json", import.meta.url).pathname;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return "0.0.0-development";
  }
}

const VERSION = getPackageVersion();

/**
 * Tool definitions for the MCP server.
 */
const TOOLS = [
  {
    name: "upload_image",
    description: "Upload an image to GitHub and get a markdown embed URL",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the image file" },
        content: {
          type: "string",
          description: "Base64 encoded image content",
        },
        filename: {
          type: "string",
          description: "Filename when using content parameter",
        },
        target: {
          type: "string",
          description: "GitHub issue/PR reference (owner/repo#N, #N, or URL)",
        },
        strategy: {
          type: "string",
          description: "Upload strategy (release-asset, browser-session, etc.)",
        },
        format: {
          type: "string",
          enum: ["markdown", "url", "json"],
          description: "Output format",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "login",
    description: "Authenticate with GitHub via browser or token",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "check_auth",
    description: "Check current authentication status",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_strategies",
    description: "List available upload strategies",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Creates and starts the MCP server with stdio transport.
 */
async function startStdioServer() {
  const server = new Server({
    name: "gh-attach",
    version: VERSION,
  });

  // Register request handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments;

    try {
      switch (name) {
        case "upload_image":
          return await handleUploadImage(
            args as Parameters<typeof handleUploadImage>[0],
          );
        case "login":
          return await handleLogin();
        case "check_auth":
          return await handleCheckAuth();
        case "list_strategies":
          return await handleListStrategies();
        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[gh-attach MCP] Server started (stdio mode, version ${VERSION})`,
  );
}

/**
 * Creates and starts the MCP server with HTTP transport.
 */
async function startHttpServer(port: number) {
  // Create HTTP server
  const httpServer = createServer(async (req, res) => {
    // Health check endpoint
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: VERSION }));
      return;
    }

    // List tools endpoint
    if (req.url === "/tools" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tools: TOOLS }));
      return;
    }

    // Tool call endpoint
    if (req.url === "/call" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const request = JSON.parse(body);
          const { name, arguments: args } = request;

          let result;
          switch (name) {
            case "upload_image":
              result = await handleUploadImage(
                args as Parameters<typeof handleUploadImage>[0],
              );
              break;
            case "login":
              result = await handleLogin();
              break;
            case "check_auth":
              result = await handleCheckAuth();
              break;
            case "list_strategies":
              result = await handleListStrategies();
              break;
            default:
              result = {
                content: [
                  {
                    type: "text",
                    text: `Unknown tool: ${name}`,
                  },
                ],
                isError: true,
              };
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              content: [{ type: "text", text: `Error: ${message}` }],
              isError: true,
            }),
          );
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, () => {
    console.error(
      `[gh-attach MCP] Server started (http:${port}, version ${VERSION})`,
    );
  });
}

/**
 * Create and start the MCP server.
 *
 * Initializes a Model Context Protocol server with the specified transport mechanism.
 * The server exposes tools for uploading images to GitHub and managing authentication.
 *
 * @param transport Transport type: "stdio" (for embedding in Claude/VSCode) or "http" (for network access)
 * @param port Optional port for HTTP transport (default: 3000)
 *
 * @example
 * ```typescript
 * // stdio transport for Claude Desktop
 * await createMCPServer('stdio');
 *
 * // HTTP transport
 * await createMCPServer('http', 3000);
 * ```
 *
 * @throws Process exit on server initialization failure
 */
export async function createMCPServer(
  transport: "stdio" | "http" = "stdio",
  port?: number,
) {
  try {
    if (transport === "stdio") {
      await startStdioServer();
    } else if (transport === "http") {
      const httpPort = port ? port : 3000;
      await startHttpServer(httpPort);
    } else {
      throw new Error(`Unknown transport: ${transport}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[gh-attach MCP] Failed to start: ${message}`);
    process.exit(1);
  }
}

/**
 * Handles the upload_image tool call.
 */
async function handleUploadImage(args: {
  filePath?: string;
  content?: string;
  filename?: string;
  target: string;
  strategy?: string;
  format?: "markdown" | "url" | "json";
}): Promise<{ content: TextContent[] }> {
  try {
    let uploadPath = args.filePath;

    // If content is provided, decode and write to temp file
    if (args.content && args.filename) {
      const buffer = Buffer.from(args.content, "base64");
      uploadPath = join(tmpdir(), `gh-attach-${randomUUID()}-${args.filename}`);
      writeFileSync(uploadPath, buffer);
    }

    if (!uploadPath) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Either filePath or content must be provided",
          },
        ],
      };
    }

    // Parse target
    const target = parseTarget(args.target);

    // Validate file
    await validateFile(uploadPath);

    // Build strategies list
    const strategies = getStrategies(args.strategy);

    if (strategies.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Error: No authentication available",
          },
        ],
      };
    }

    // Upload
    const result = await upload(uploadPath, target, strategies);

    // Clean up temp file if we created one
    if (args.content) {
      unlinkSync(uploadPath);
    }

    // Format output
    const format = args.format || "markdown";
    let output: string;
    switch (format) {
      case "url":
        output = result.url;
        break;
      case "json":
        output = JSON.stringify(result, null, 2);
        break;
      case "markdown":
      default:
        output = result.markdown;
    }

    return {
      content: [
        {
          type: "text",
          text: output,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${message}`,
        },
      ],
    };
  }
}

/**
 * Handles the login tool call.
 */
async function handleLogin(): Promise<{ content: TextContent[] }> {
  return {
    content: [
      {
        type: "text",
        text: `To authenticate, set the GITHUB_TOKEN environment variable with a GitHub personal access token, or run 'gh-attach login' to save a browser session.`,
      },
    ],
  };
}

/**
 * Handles the check_auth tool call.
 */
async function handleCheckAuth(): Promise<{ content: TextContent[] }> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const cookies = process.env.GH_ATTACH_COOKIES;

  const strategies: string[] = [];
  if (token) {
    strategies.push("release-asset", "repo-branch");
  }
  if (cookies) {
    strategies.push("browser-session");
  }
  strategies.push("cookie-extraction");

  const authenticated = token !== undefined || cookies !== undefined;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ authenticated, strategies }, null, 2),
      },
    ],
  };
}

/**
 * Handles the list_strategies tool call.
 */
async function handleListStrategies(): Promise<{ content: TextContent[] }> {
  const strategies: Array<{
    name: string;
    available: boolean;
    description: string;
  }> = [];

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const cookies = process.env.GH_ATTACH_COOKIES;

  strategies.push({
    name: "release-asset",
    available: !!token,
    description: "Upload as GitHub release asset (requires GITHUB_TOKEN)",
  });
  strategies.push({
    name: "browser-session",
    available: !!cookies,
    description:
      "Upload via saved browser session (requires GH_ATTACH_COOKIES)",
  });
  strategies.push({
    name: "cookie-extraction",
    available: true,
    description: "Extract cookies from installed browsers",
  });
  strategies.push({
    name: "repo-branch",
    available: !!token,
    description: "Upload to repository branch (requires GITHUB_TOKEN)",
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(strategies, null, 2),
      },
    ],
  };
}

/**
 * Gets the list of available strategies.
 */
function getStrategies(preferredStrategy?: string): UploadStrategy[] {
  const strategies: UploadStrategy[] = [];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const cookies = process.env.GH_ATTACH_COOKIES;

  if (preferredStrategy) {
    switch (preferredStrategy) {
      case "release-asset":
        if (token) strategies.push(createReleaseAssetStrategy(token));
        break;
      case "browser-session":
        if (cookies) strategies.push(createBrowserSessionStrategy(cookies));
        break;
      case "cookie-extraction":
        strategies.push(createCookieExtractionStrategy());
        break;
      case "repo-branch":
        if (token) strategies.push(createRepoBranchStrategy(token));
        break;
    }
  } else {
    // Default order
    if (cookies) strategies.push(createBrowserSessionStrategy(cookies));
    strategies.push(createCookieExtractionStrategy());
    if (token) {
      strategies.push(createReleaseAssetStrategy(token));
      strategies.push(createRepoBranchStrategy(token));
    }
  }

  return strategies;
}
