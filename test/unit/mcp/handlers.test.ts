import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveSession } from "../../../src/core/session.js";
import { UploadError, type UploadStrategy } from "../../../src/core/types.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type CallToolHandler = (request: {
  params: { name: string; arguments?: Record<string, unknown> };
}) => Promise<ToolResult>;

type ListToolsHandler = () => Promise<{
  tools: Array<{ name: string; inputSchema?: unknown }>;
}>;

const hoisted = vi.hoisted(() => ({
  callToolSchema: Symbol("call-tool"),
  listToolsSchema: Symbol("list-tools"),
  callToolHandler: undefined as CallToolHandler | undefined,
  listToolsHandler: undefined as ListToolsHandler | undefined,
  mockServerConnect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mockServerGetClientCapabilities: vi
    .fn<() => Record<string, unknown>>()
    .mockReturnValue({}),
  mockServerElicitInput: vi
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ action: "cancel" }),
  mockServerSetRequestHandler: vi.fn((schema: unknown, handler: unknown) => {
    if (schema === hoisted.callToolSchema) {
      hoisted.callToolHandler = handler as CallToolHandler;
    }
    if (schema === hoisted.listToolsSchema) {
      hoisted.listToolsHandler = handler as ListToolsHandler;
    }
  }),
  mockTarget: {
    owner: "octo",
    repo: "repo",
    type: "issue",
    number: 42,
  },
  mockUploadResult: {
    url: "https://example.com/uploaded.png",
    markdown: "![uploaded](https://example.com/uploaded.png)",
    strategy: "release-asset",
  },
  mockReleaseStrategy: {
    name: "release-asset",
    isAvailable: vi.fn().mockResolvedValue(true),
    upload: vi.fn(),
  },
  mockBrowserStrategy: {
    name: "browser-session",
    isAvailable: vi.fn().mockResolvedValue(true),
    upload: vi.fn(),
  },
  mockCookieStrategy: {
    name: "cookie-extraction",
    isAvailable: vi.fn().mockResolvedValue(true),
    upload: vi.fn(),
  },
  mockRepoBranchStrategy: {
    name: "repo-branch",
    isAvailable: vi.fn().mockResolvedValue(true),
    upload: vi.fn(),
  },
  mockCreateReleaseAssetStrategy: vi.fn(),
  mockCreateBrowserSessionStrategy: vi.fn(),
  mockCreateCookieExtractionStrategy: vi.fn(),
  mockCreateRepoBranchStrategy: vi.fn(),
  mockParseTarget: vi.fn(),
  mockValidateFile: vi.fn(),
  mockUpload: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  return {
    Server: class MockServer {
      setRequestHandler = hoisted.mockServerSetRequestHandler;
      connect = hoisted.mockServerConnect;
      getClientCapabilities = hoisted.mockServerGetClientCapabilities;
      elicitInput = hoisted.mockServerElicitInput;
    },
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  return {
    StdioServerTransport: class MockStdioTransport {},
  };
});

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolRequestSchema: hoisted.callToolSchema,
  ListToolsRequestSchema: hoisted.listToolsSchema,
  TextContent: {},
}));

vi.mock("../../../src/core/strategies/index.js", () => ({
  createReleaseAssetStrategy: hoisted.mockCreateReleaseAssetStrategy,
  createBrowserSessionStrategy: hoisted.mockCreateBrowserSessionStrategy,
  createCookieExtractionStrategy: hoisted.mockCreateCookieExtractionStrategy,
  createRepoBranchStrategy: hoisted.mockCreateRepoBranchStrategy,
}));

vi.mock("../../../src/core/target.js", () => ({
  parseTarget: hoisted.mockParseTarget,
}));

vi.mock("../../../src/core/validation.js", () => ({
  validateFile: hoisted.mockValidateFile,
}));

vi.mock("../../../src/core/upload.js", () => ({
  upload: hoisted.mockUpload,
}));

import { createMCPServer, mcpInternals } from "../../../src/mcp/index.js";

async function startServerAndGetHandlers(): Promise<{
  call: CallToolHandler;
  list: ListToolsHandler;
}> {
  await createMCPServer("stdio");
  if (!hoisted.callToolHandler || !hoisted.listToolsHandler) {
    throw new Error("MCP handlers were not registered");
  }
  return { call: hoisted.callToolHandler, list: hoisted.listToolsHandler };
}

describe("MCP server handlers", () => {
  let origStatePath: string | undefined;
  let sessionDir: string;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GH_ATTACH_COOKIES;

    origStatePath = process.env.GH_ATTACH_STATE_PATH;
    sessionDir = join(tmpdir(), `gh-attach-mcp-test-${Date.now()}`);
    process.env.GH_ATTACH_STATE_PATH = join(sessionDir, "session.json");

    vi.clearAllMocks();
    mcpInternals.resetElicitedToken();
    hoisted.callToolHandler = undefined;
    hoisted.listToolsHandler = undefined;
    hoisted.mockReleaseStrategy.upload.mockResolvedValue(
      hoisted.mockUploadResult,
    );
    hoisted.mockBrowserStrategy.upload.mockResolvedValue(
      hoisted.mockUploadResult,
    );
    hoisted.mockCookieStrategy.upload.mockResolvedValue(
      hoisted.mockUploadResult,
    );
    hoisted.mockRepoBranchStrategy.upload.mockResolvedValue(
      hoisted.mockUploadResult,
    );
    hoisted.mockCreateReleaseAssetStrategy.mockReturnValue(
      hoisted.mockReleaseStrategy,
    );
    hoisted.mockCreateBrowserSessionStrategy.mockReturnValue(
      hoisted.mockBrowserStrategy,
    );
    hoisted.mockCreateCookieExtractionStrategy.mockReturnValue(
      hoisted.mockCookieStrategy,
    );
    hoisted.mockCreateRepoBranchStrategy.mockReturnValue(
      hoisted.mockRepoBranchStrategy,
    );
    hoisted.mockParseTarget.mockReturnValue(hoisted.mockTarget);
    hoisted.mockValidateFile.mockResolvedValue(undefined);
    hoisted.mockUpload.mockResolvedValue(hoisted.mockUploadResult);
  });

  afterEach(() => {
    try {
      rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    if (origStatePath) {
      process.env.GH_ATTACH_STATE_PATH = origStatePath;
    } else {
      delete process.env.GH_ATTACH_STATE_PATH;
    }
  });

  it("registers required tools with strict upload format enum", async () => {
    const { list } = await startServerAndGetHandlers();
    const response = await list();

    expect(response.tools.map((tool) => tool.name)).toEqual([
      "upload_image",
      "login",
      "check_auth",
      "list_strategies",
    ]);

    const uploadTool = response.tools.find(
      (tool) => tool.name === "upload_image",
    );
    expect(uploadTool).toBeDefined();
    const uploadSchema = uploadTool?.inputSchema as {
      properties: { format: { enum: string[] } };
    };
    expect(uploadSchema.properties.format.enum).toEqual(["markdown", "url"]);
  });

  it("reports unauthenticated status with default cookie-extraction strategy", async () => {
    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: { name: "check_auth", arguments: {} },
    });

    expect(response.isError).toBeUndefined();
    const body = JSON.parse(response.content[0]?.text ?? "{}") as {
      authenticated: boolean;
      strategies: string[];
    };
    expect(body.authenticated).toBe(false);
    expect(body.strategies).toEqual(["cookie-extraction"]);
  });

  it("reports authenticated status from token and cookies", async () => {
    process.env.GITHUB_TOKEN = "ghs_test";
    process.env.GH_ATTACH_COOKIES = "session=test";

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: { name: "check_auth", arguments: {} },
    });

    const body = JSON.parse(response.content[0]?.text ?? "{}") as {
      authenticated: boolean;
      strategies: string[];
    };
    expect(body.authenticated).toBe(true);
    expect(body.strategies).toEqual([
      "release-asset",
      "repo-branch",
      "browser-session",
      "cookie-extraction",
    ]);
  });

  it("reports authenticated status from saved session cookies", async () => {
    saveSession({
      cookies: "user_session=abc123; logged_in=yes",
      expires: Date.now() + 86400000,
    });

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: { name: "check_auth", arguments: {} },
    });

    const body = JSON.parse(response.content[0]?.text ?? "{}") as {
      authenticated: boolean;
      strategies: string[];
    };

    expect(body.authenticated).toBe(true);
    expect(body.strategies).toEqual(["browser-session", "cookie-extraction"]);
  });

  it("lists strategy availability based on auth signals", async () => {
    process.env.GH_TOKEN = "gh_test";
    process.env.GH_ATTACH_COOKIES = "session=test";

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: { name: "list_strategies", arguments: {} },
    });

    const body = JSON.parse(response.content[0]?.text ?? "[]") as Array<{
      name: string;
      available: boolean;
    }>;
    expect(body.map(({ name, available }) => ({ name, available }))).toEqual([
      { name: "release-asset", available: true },
      { name: "browser-session", available: true },
      { name: "cookie-extraction", available: true },
      { name: "repo-branch", available: true },
    ]);
  });

  it("uploads with default markdown output and default strategy order", async () => {
    process.env.GITHUB_TOKEN = "ghs_test";

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0]?.text).toBe(hoisted.mockUploadResult.markdown);
    expect(hoisted.mockParseTarget).toHaveBeenCalledWith("octo/repo#42");
    expect(hoisted.mockValidateFile).toHaveBeenCalledWith("/tmp/example.png");
    expect(hoisted.mockUpload).toHaveBeenCalledTimes(1);

    const passedStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ??
      []) as UploadStrategy[];
    expect(passedStrategies.map((strategy) => strategy.name)).toEqual([
      "cookie-extraction",
      "release-asset",
      "repo-branch",
    ]);
  });

  it("supports explicit strategy selection and url output format", async () => {
    process.env.GITHUB_TOKEN = "ghs_test";

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
          strategy: "release-asset",
          format: "url",
        },
      },
    });

    expect(response.content[0]?.text).toBe(hoisted.mockUploadResult.url);
    const passedStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ??
      []) as UploadStrategy[];
    expect(passedStrategies.map((strategy) => strategy.name)).toEqual([
      "release-asset",
    ]);
  });

  it("returns a validation error when file input is missing", async () => {
    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: { target: "octo/repo#42" },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain(
      "Either filePath or content must be provided",
    );
    expect(hoisted.mockValidateFile).not.toHaveBeenCalled();
    expect(hoisted.mockUpload).not.toHaveBeenCalled();
  });

  it("returns auth error when no strategy is available", async () => {
    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
          strategy: "release-asset",
        },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("No authentication available");
  });

  it("auto-elicits a token during upload_image when a token-backed upload is needed", async () => {
    hoisted.mockServerGetClientCapabilities.mockReturnValue({
      elicitation: { form: true },
    });
    hoisted.mockServerElicitInput.mockResolvedValue({
      action: "accept",
      content: { token: "ghs_elicited_token" },
    });

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    expect(hoisted.mockServerElicitInput).toHaveBeenCalled();
    expect(hoisted.mockCreateReleaseAssetStrategy).toHaveBeenCalledWith(
      "ghs_elicited_token",
    );
    const passedStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ??
      []) as UploadStrategy[];
    expect(passedStrategies.map((strategy) => strategy.name)).toEqual([
      "cookie-extraction",
      "release-asset",
      "repo-branch",
    ]);
  });

  it("retries upload_image with an elicited token after a stale browser-session failure", async () => {
    process.env.GH_ATTACH_COOKIES = "user_session=stale";
    hoisted.mockServerGetClientCapabilities.mockReturnValue({
      elicitation: { form: true },
    });
    hoisted.mockServerElicitInput.mockResolvedValue({
      action: "accept",
      content: { token: "ghs_retry_token" },
    });
    hoisted.mockUpload
      .mockRejectedValueOnce(
        new UploadError("Saved session is expired.", "SESSION_EXPIRED"),
      )
      .mockResolvedValueOnce(hoisted.mockUploadResult);

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    expect(hoisted.mockServerElicitInput).toHaveBeenCalled();
    expect(hoisted.mockUpload).toHaveBeenCalledTimes(2);

    const firstStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ??
      []) as UploadStrategy[];
    expect(firstStrategies.map((strategy) => strategy.name)).toEqual([
      "browser-session",
      "cookie-extraction",
    ]);

    const retryStrategies = (hoisted.mockUpload.mock.calls[1]?.[2] ??
      []) as UploadStrategy[];
    expect(retryStrategies.map((strategy) => strategy.name)).toEqual([
      "browser-session",
      "cookie-extraction",
      "release-asset",
      "repo-branch",
    ]);
  });

  it("cleans up temporary file after failed content upload", async () => {
    process.env.GITHUB_TOKEN = "ghs_test";
    const content = Buffer.from("image-bytes").toString("base64");
    let tempUploadPath: string | undefined;

    hoisted.mockValidateFile.mockImplementationOnce(
      async (filePath: string) => {
        tempUploadPath = filePath;
      },
    );
    hoisted.mockUpload.mockRejectedValueOnce(new Error("upload failed"));

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          content,
          filename: "image.png",
          target: "octo/repo#42",
        },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("upload failed");
    if (!tempUploadPath) {
      throw new Error("Expected temp upload path to be captured");
    }
    expect(existsSync(tempUploadPath)).toBe(false);
  });

  it("decodes base64 content, writes to temp file, and uploads successfully (spec: Upload with base64 content)", async () => {
    process.env.GITHUB_TOKEN = "ghs_test";
    // Simulate PNG header bytes as base64 content
    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
    const content = imageBytes.toString("base64");
    let capturedTempPath: string | undefined;

    hoisted.mockValidateFile.mockImplementationOnce(
      async (filePath: string) => {
        capturedTempPath = filePath;
        // Verify temp file was written with correct decoded content
        const { readFileSync } = await import("fs");
        const written = readFileSync(filePath);
        expect(written).toEqual(imageBytes);
      },
    );

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          content,
          filename: "screenshot.png",
          target: "octo/repo#42",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0]?.text).toBe(hoisted.mockUploadResult.markdown);
    // Verify temp file used correct filename hint
    expect(capturedTempPath).toBeDefined();
    expect(capturedTempPath).toMatch(/screenshot\.png$/);
    // Temp file cleaned up after successful upload
    if (capturedTempPath) {
      expect(existsSync(capturedTempPath)).toBe(false);
    }
  });

  it("outer catch wraps unexpected thrown non-Error values with isError=true", async () => {
    // Make parseTarget throw a non-Error value to trigger the outer catch block
    hoisted.mockParseTarget.mockImplementation(() => {
      throw "unexpected string error";
    });
    process.env.GITHUB_TOKEN = "ghs_test";

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
        },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("unexpected string error");
  });

  it("returns unknown tool errors with isError=true", async () => {
    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: { name: "does_not_exist", arguments: {} },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Unknown tool");
  });

  it("uses cookie-extraction strategy when explicitly selected", async () => {
    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
          strategy: "cookie-extraction",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    const passedStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ??
      []) as UploadStrategy[];
    expect(passedStrategies.map((s) => s.name)).toEqual(["cookie-extraction"]);
  });

  it("uses repo-branch strategy when explicitly selected with token", async () => {
    process.env.GITHUB_TOKEN = "ghs_test";

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
          strategy: "repo-branch",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    const passedStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ??
      []) as UploadStrategy[];
    expect(passedStrategies.map((s) => s.name)).toEqual(["repo-branch"]);
  });

  it("uses browser-session strategy when explicitly selected with cookies", async () => {
    process.env.GH_ATTACH_COOKIES = "user_session=abc123; logged_in=yes";

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
          strategy: "browser-session",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    const passedStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ??
      []) as UploadStrategy[];
    expect(passedStrategies.map((s) => s.name)).toEqual(["browser-session"]);
  });

  it("includes browser-session in default strategy order when cookies available", async () => {
    process.env.GH_ATTACH_COOKIES = "user_session=abc123";
    process.env.GITHUB_TOKEN = "ghs_test";

    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: {
        name: "upload_image",
        arguments: {
          filePath: "/tmp/example.png",
          target: "octo/repo#42",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    const passedStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ??
      []) as UploadStrategy[];
    expect(passedStrategies.map((s) => s.name)).toEqual([
      "browser-session",
      "cookie-extraction",
      "release-asset",
      "repo-branch",
    ]);
  });

  it("login tool returns already-authenticated when saved session cookies exist", async () => {
    saveSession({
      cookies: "user_session=abc123; logged_in=yes",
      expires: Date.now() + 86400000,
    });

    const { call } = await startServerAndGetHandlers();
    const response = await call({ params: { name: "login", arguments: {} } });

    expect(response.isError).toBeUndefined();
    expect(response.content[0]?.text).toContain("Already authenticated");
    expect(response.content[0]?.text).toContain("browser session");
  });

  it("login tool returns static guidance when client has no elicitation", async () => {
    // Default mock: getClientCapabilities returns {} (no elicitation)
    hoisted.mockServerGetClientCapabilities.mockReturnValue({});

    const { call } = await startServerAndGetHandlers();
    const response = await call({ params: { name: "login", arguments: {} } });

    expect(response.isError).toBeUndefined();
    expect(response.content[0]?.text).toMatch(/GITHUB_TOKEN/);
  });

  it("login tool returns already-authenticated when token is set", async () => {
    process.env.GITHUB_TOKEN = "ghs_test_existing";

    const { call } = await startServerAndGetHandlers();
    const response = await call({ params: { name: "login", arguments: {} } });

    expect(response.isError).toBeUndefined();
    expect(response.content[0]?.text).toContain("Already authenticated");
  });

  it("login tool uses elicitation when client supports it and user accepts", async () => {
    // Simulate client that supports form elicitation
    hoisted.mockServerGetClientCapabilities.mockReturnValue({
      elicitation: { form: true },
    });
    hoisted.mockServerElicitInput.mockResolvedValue({
      action: "accept",
      content: { token: "ghs_elicited_token" },
    });

    const { call } = await startServerAndGetHandlers();
    const response = await call({ params: { name: "login", arguments: {} } });

    expect(hoisted.mockServerElicitInput).toHaveBeenCalled();
    expect(response.content[0]?.text).toContain("Authentication successful");
  });

  it("login tool handles elicitation cancel gracefully", async () => {
    hoisted.mockServerGetClientCapabilities.mockReturnValue({
      elicitation: { form: true },
    });
    hoisted.mockServerElicitInput.mockResolvedValue({ action: "cancel" });

    const { call } = await startServerAndGetHandlers();
    const response = await call({ params: { name: "login", arguments: {} } });

    expect(response.content[0]?.text).toContain("cancelled");
  });

  it("login tool falls back to static guidance when elicitInput throws", async () => {
    // Simulate elicitation capability present but elicitInput throws at runtime
    hoisted.mockServerGetClientCapabilities.mockReturnValue({
      elicitation: { form: true },
    });
    hoisted.mockServerElicitInput.mockRejectedValue(
      new Error("Elicitation not supported at runtime"),
    );

    const { call } = await startServerAndGetHandlers();
    const response = await call({ params: { name: "login", arguments: {} } });

    // Should fall through to static guidance without error
    expect(response.isError).toBeUndefined();
    expect(response.content[0]?.text).toMatch(/GITHUB_TOKEN/);
  });

  it("login tool handles elicitation decline action", async () => {
    hoisted.mockServerGetClientCapabilities.mockReturnValue({
      elicitation: { form: true },
    });
    hoisted.mockServerElicitInput.mockResolvedValue({ action: "decline" });

    const { call } = await startServerAndGetHandlers();
    const response = await call({ params: { name: "login", arguments: {} } });

    expect(response.content[0]?.text).toContain("cancelled");
  });

  it("login tool handles elicitation with empty token", async () => {
    hoisted.mockServerGetClientCapabilities.mockReturnValue({
      elicitation: { form: true },
    });
    hoisted.mockServerElicitInput.mockResolvedValue({
      action: "accept",
      content: { token: "" },
    });

    const { call } = await startServerAndGetHandlers();
    const response = await call({ params: { name: "login", arguments: {} } });

    // Empty token should fall through to static guidance
    expect(response.content[0]?.text).toMatch(/GITHUB_TOKEN/);
  });
});
