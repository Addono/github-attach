import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync } from "fs";
import type { UploadStrategy } from "../../../src/core/types.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type CallToolHandler = (request: {
  params: { name: string; arguments?: Record<string, unknown> };
}) => Promise<ToolResult>;

type ListToolsHandler = () => Promise<{ tools: Array<{ name: string; inputSchema?: unknown }> }>;

const hoisted = vi.hoisted(() => ({
  callToolSchema: Symbol("call-tool"),
  listToolsSchema: Symbol("list-tools"),
  callToolHandler: undefined as CallToolHandler | undefined,
  listToolsHandler: undefined as ListToolsHandler | undefined,
  mockServerConnect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mockServerSetRequestHandler: vi.fn(
    (schema: unknown, handler: unknown) => {
      if (schema === hoisted.callToolSchema) {
        hoisted.callToolHandler = handler as CallToolHandler;
      }
      if (schema === hoisted.listToolsSchema) {
        hoisted.listToolsHandler = handler as ListToolsHandler;
      }
    },
  ),
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

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: hoisted.mockServerSetRequestHandler,
    connect: hoisted.mockServerConnect,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

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

import { createMCPServer } from "../../../src/mcp/index.js";

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
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GH_ATTACH_COOKIES;

    vi.clearAllMocks();
    hoisted.callToolHandler = undefined;
    hoisted.listToolsHandler = undefined;
    hoisted.mockReleaseStrategy.upload.mockResolvedValue(hoisted.mockUploadResult);
    hoisted.mockBrowserStrategy.upload.mockResolvedValue(hoisted.mockUploadResult);
    hoisted.mockCookieStrategy.upload.mockResolvedValue(hoisted.mockUploadResult);
    hoisted.mockRepoBranchStrategy.upload.mockResolvedValue(hoisted.mockUploadResult);
    hoisted.mockCreateReleaseAssetStrategy.mockReturnValue(hoisted.mockReleaseStrategy);
    hoisted.mockCreateBrowserSessionStrategy.mockReturnValue(hoisted.mockBrowserStrategy);
    hoisted.mockCreateCookieExtractionStrategy.mockReturnValue(
      hoisted.mockCookieStrategy,
    );
    hoisted.mockCreateRepoBranchStrategy.mockReturnValue(hoisted.mockRepoBranchStrategy);
    hoisted.mockParseTarget.mockReturnValue(hoisted.mockTarget);
    hoisted.mockValidateFile.mockResolvedValue(undefined);
    hoisted.mockUpload.mockResolvedValue(hoisted.mockUploadResult);
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

    const uploadTool = response.tools.find((tool) => tool.name === "upload_image");
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

    const passedStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ?? []) as UploadStrategy[];
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
    const passedStrategies = (hoisted.mockUpload.mock.calls[0]?.[2] ?? []) as UploadStrategy[];
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

  it("cleans up temporary file after failed content upload", async () => {
    process.env.GITHUB_TOKEN = "ghs_test";
    const content = Buffer.from("image-bytes").toString("base64");
    let tempUploadPath: string | undefined;

    hoisted.mockValidateFile.mockImplementationOnce(async (filePath: string) => {
      tempUploadPath = filePath;
    });
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

  it("returns unknown tool errors with isError=true", async () => {
    const { call } = await startServerAndGetHandlers();
    const response = await call({
      params: { name: "does_not_exist", arguments: {} },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Unknown tool");
  });
});
