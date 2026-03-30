/**
 * gh-attach MCP server implementation.
 * Provides image upload functionality via the Model Context Protocol.
 * Supports stdio and HTTP transports.
 */

import { randomUUID } from "crypto";
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createServer } from "http";
import type { IncomingMessage } from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import {
  createReleaseAssetStrategy,
  createBrowserSessionStrategy,
  createCookieExtractionStrategy,
  createRepoBranchStrategy,
} from "../core/strategies/index.js";
import { getSessionCookies, loadSession } from "../core/session.js";
import { parseTarget } from "../core/target.js";
import { validateFile } from "../core/validation.js";
import { upload } from "../core/upload.js";
import {
  AuthenticationError,
  UploadError,
  type UploadStrategy,
} from "../core/types.js";

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
const AUTH_GUIDANCE =
  "No authentication available. Set GITHUB_TOKEN (or GH_TOKEN), GH_ATTACH_COOKIES, or run 'gh-attach login' to save a browser session.";

/**
 * Token obtained via MCP elicitation — persists for the lifetime of the server process.
 * This allows the login tool to collect a GitHub token interactively when the MCP host
 * supports form elicitation, without requiring environment variable configuration.
 */
let elicitedToken: string | null = null;

/**
 * Returns the effective GitHub API token from all sources:
 * environment variables → MCP-elicited token.
 */
function getEffectiveToken(): string | undefined {
  return (
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    elicitedToken ||
    undefined
  );
}

function getEffectiveCookies(): string | null {
  return process.env.GH_ATTACH_COOKIES ?? getSessionCookies(loadSession());
}

type TokenElicitationResult = "accepted" | "cancelled" | "unavailable";

async function maybeElicitToken(
  server: Server,
): Promise<TokenElicitationResult> {
  const caps = server.getClientCapabilities();
  if (!caps?.elicitation) {
    return "unavailable";
  }

  try {
    const elicitParams: ElicitRequestFormParams = {
      message:
        "GitHub authentication required to upload images. Please provide a GitHub Personal Access Token with repo scope.",
      requestedSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            title: "GitHub Personal Access Token",
            description:
              "Create one at https://github.com/settings/tokens (needs repo scope for private repos, or public_repo for public repos)",
          },
        },
        required: ["token"],
      },
    };

    const result = await server.elicitInput(elicitParams);

    if (
      result.action === "accept" &&
      result.content &&
      typeof result.content["token"] === "string" &&
      result.content["token"].length > 0
    ) {
      elicitedToken = result.content["token"];
      return "accepted";
    }

    if (result.action === "decline" || result.action === "cancel") {
      return "cancelled";
    }
  } catch {
    return "unavailable";
  }

  return "unavailable";
}

function shouldAttemptTokenElicitation(preferredStrategy?: string): boolean {
  const canUseTokenStrategy =
    preferredStrategy === undefined ||
    preferredStrategy === "release-asset" ||
    preferredStrategy === "repo-branch";

  if (!canUseTokenStrategy) {
    return false;
  }

  if (getEffectiveToken() || getEffectiveCookies()) {
    return false;
  }

  return true;
}

function shouldRetryWithElicitedToken(preferredStrategy?: string): boolean {
  if (getEffectiveToken()) {
    return false;
  }

  return (
    preferredStrategy === undefined ||
    preferredStrategy === "release-asset" ||
    preferredStrategy === "repo-branch"
  );
}

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
          enum: ["markdown", "url"],
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
 * Creates a configured MCP SDK server instance with all tool handlers registered.
 */
function createProtocolServer(): Server {
  const server = new Server(
    {
      name: "gh-attach",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

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
            server,
            args as Parameters<typeof handleUploadImage>[1],
          );
        case "login":
          return await handleLogin(server);
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

  return server;
}

/**
 * Creates and starts the MCP server with stdio transport.
 */
async function startStdioServer() {
  const server = createProtocolServer();

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[gh-attach MCP] Server started (stdio mode, version ${VERSION})`,
  );
}

/**
 * Read the full request body as UTF-8 text.
 */
async function readRequestBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/**
 * Creates and starts the MCP server with HTTP transport (Streamable HTTP).
 */
async function startHttpServer(
  port: number,
): Promise<{ port: number; close: () => Promise<void> }> {
  const { StreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

  type StreamableHTTPServerTransportCtor =
    typeof import("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport;
  type StreamableHTTPServerTransportInstance =
    InstanceType<StreamableHTTPServerTransportCtor>;

  const sessions = new Map<
    string,
    { server: Server; transport: StreamableHTTPServerTransportInstance }
  >();

  function getHeaderValue(
    req: IncomingMessage,
    name: string,
  ): string | undefined {
    const raw = req.headers[name.toLowerCase()];
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw)) return raw[0];
    return undefined;
  }

  function isInitializeRequestBody(body: unknown): boolean {
    if (Array.isArray(body)) {
      return body.some(isInitializeRequestBody);
    }
    if (!body || typeof body !== "object") return false;
    const method = (body as { method?: unknown }).method;
    return method === "initialize";
  }

  async function createSession(): Promise<{
    server: Server;
    transport: StreamableHTTPServerTransportInstance;
  }> {
    const protocolServer = createProtocolServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    }) as StreamableHTTPServerTransportInstance;

    await protocolServer.connect(transport);

    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (typeof sessionId === "string") {
        sessions.delete(sessionId);
      }
    };

    return { server: protocolServer, transport };
  }

  const httpServer = createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";

    if (path === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: VERSION }));
      return;
    }

    if (
      path === "/" &&
      (req.method === "GET" || req.method === "POST" || req.method === "DELETE")
    ) {
      try {
        const sessionIdHeader = getHeaderValue(req, "mcp-session-id");

        if (req.method === "GET" || req.method === "DELETE") {
          if (!sessionIdHeader) {
            // The client may probe GET before initialization; returning 405 signals
            // that the standalone SSE stream is not available yet.
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

          const session = sessions.get(sessionIdHeader);
          if (!session) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Session not found" }));
            return;
          }

          await session.transport.handleRequest(req, res);
          if (req.method === "DELETE") {
            await session.server.close();
          }
          return;
        }

        const bodyText = await readRequestBody(req);
        if (!bodyText.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing request body" }));
          return;
        }

        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(bodyText);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        if (isInitializeRequestBody(parsedBody)) {
          const session = await createSession();
          try {
            await session.transport.handleRequest(req, res, parsedBody);
          } finally {
            const sessionId = session.transport.sessionId;
            if (typeof sessionId === "string") {
              sessions.set(sessionId, session);
            } else {
              await session.server.close();
            }
          }
          return;
        }

        if (!sessionIdHeader) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing mcp-session-id header" }));
          return;
        }

        const session = sessions.get(sessionIdHeader);
        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        await session.transport.handleRequest(req, res, parsedBody);
        return;
      } catch (err) {
        if (!res.headersSent) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  const listenPort = await new Promise<number>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, () => {
      const addr = httpServer.address();
      if (addr && typeof addr !== "string") {
        resolve(addr.port);
        return;
      }
      resolve(port);
    });
  });

  console.error(
    `[gh-attach MCP] Server started (http:${listenPort}, version ${VERSION})`,
  );

  return {
    port: listenPort,
    close: async () => {
      await Promise.all(
        [...sessions.values()].map(async (s) => await s.server.close()),
      );
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve();
        });
      });
    },
  };
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
 * Testing hooks for MCP server internals.
 *
 * @internal
 */
export const mcpInternals = {
  startHttpServer,
  /** Clears the in-process elicited token — for test isolation only. */
  resetElicitedToken(): void {
    elicitedToken = null;
  },
};

/**
 * Handles the upload_image tool call.
 */
async function handleUploadImage(
  server: Server,
  args: {
    filePath?: string;
    content?: string;
    filename?: string;
    target: string;
    strategy?: string;
    format?: "markdown" | "url";
  },
): Promise<{ content: TextContent[]; isError?: boolean }> {
  let tempFilePath: string | undefined;
  let attemptedTokenElicitation = false;

  try {
    let uploadPath = args.filePath;

    // If content is provided, decode and write to temp file
    if (args.content && args.filename) {
      const buffer = Buffer.from(args.content, "base64");
      tempFilePath = join(
        tmpdir(),
        `gh-attach-${randomUUID()}-${args.filename}`,
      );
      uploadPath = tempFilePath;
      writeFileSync(tempFilePath, buffer);
    }

    if (!uploadPath) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Either filePath or content must be provided",
          },
        ],
        isError: true,
      };
    }

    if (shouldAttemptTokenElicitation(args.strategy)) {
      attemptedTokenElicitation = true;
      await maybeElicitToken(server);
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
            text: `Error: ${AUTH_GUIDANCE}`,
          },
        ],
        isError: true,
      };
    }

    let result;
    try {
      result = await upload(uploadPath, target, strategies);
    } catch (error) {
      const canRetryWithToken =
        !attemptedTokenElicitation &&
        shouldRetryWithElicitedToken(args.strategy) &&
        (error instanceof AuthenticationError || error instanceof UploadError);

      if (!canRetryWithToken) {
        throw error;
      }

      attemptedTokenElicitation = true;
      const elicitationResult = await maybeElicitToken(server);
      if (elicitationResult !== "accepted") {
        throw error;
      }

      const retryStrategies = getStrategies(args.strategy);
      if (retryStrategies.length === 0) {
        throw error;
      }

      result = await upload(uploadPath, target, retryStrategies);
    }

    // Format output
    const format = args.format || "markdown";
    let output: string;
    switch (format) {
      case "url":
        output = result.url;
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
      isError: true,
    };
  } finally {
    if (tempFilePath && existsSync(tempFilePath)) {
      unlinkSync(tempFilePath);
    }
  }
}

/**
 * Handles the login tool call.
 *
 * When the MCP host supports form elicitation, guides the user through providing
 * their GitHub Personal Access Token interactively. Falls back to static
 * instructions when elicitation is unavailable.
 */
async function handleLogin(
  server: Server,
): Promise<{ content: TextContent[] }> {
  // Short-circuit: already authenticated via environment or prior elicitation
  const existingToken = getEffectiveToken();
  const existingCookies = getEffectiveCookies();

  if (existingToken || existingCookies) {
    const via = existingToken ? "token" : "browser session";
    return {
      content: [
        {
          type: "text",
          text: `Already authenticated via ${via}. Use check_auth to see available strategies.`,
        },
      ],
    };
  }

  const elicitationResult = await maybeElicitToken(server);
  if (elicitationResult === "accepted") {
    return {
      content: [
        {
          type: "text",
          text: "Authentication successful. GitHub token saved for this session. You can now use upload_image.",
        },
      ],
    };
  }

  if (elicitationResult === "cancelled") {
    return {
      content: [
        {
          type: "text",
          text: "Authentication cancelled. Set the GITHUB_TOKEN environment variable or run 'gh-attach login' to authenticate.",
        },
      ],
    };
  }

  // Static fallback guidance
  return {
    content: [
      {
        type: "text",
        text: `To authenticate, set the GITHUB_TOKEN environment variable with a GitHub personal access token, or run 'gh-attach login' to save a browser session.\n\nCreate a token at: https://github.com/settings/tokens`,
      },
    ],
  };
}

/**
 * Handles the check_auth tool call.
 */
async function handleCheckAuth(): Promise<{ content: TextContent[] }> {
  const token = getEffectiveToken();
  const cookies = getEffectiveCookies();

  const strategies: string[] = [];
  if (token) {
    strategies.push("release-asset", "repo-branch");
  }
  if (cookies) {
    strategies.push("browser-session");
  }
  strategies.push("cookie-extraction");

  const authenticated = token !== undefined || cookies !== null;

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

  const token = getEffectiveToken();
  const cookies = getEffectiveCookies();

  strategies.push({
    name: "release-asset",
    available: !!token,
    description: "Upload as GitHub release asset (requires GITHUB_TOKEN)",
  });
  strategies.push({
    name: "browser-session",
    available: !!cookies,
    description:
      "Upload via saved browser session (requires GH_ATTACH_COOKIES or saved session state)",
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
  const token = getEffectiveToken();
  const cookies = getEffectiveCookies();

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
