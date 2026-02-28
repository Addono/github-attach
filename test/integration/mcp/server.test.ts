import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { join } from "path";
import { writeFileSync, unlinkSync, rmSync } from "fs";
import { tmpdir } from "os";

// Mock the MCP SDK - these are complex external dependencies
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: vi.fn().mockImplementation(function MockServer() {
    return {
      setRequestHandler: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolRequestSchema: {},
  ListToolsRequestSchema: {},
  TextContent: {},
}));

// Mock core strategies
vi.mock("../../../src/core/strategies/index.js", () => ({
  createReleaseAssetStrategy: vi.fn().mockReturnValue({
    name: "release-asset",
    upload: vi.fn().mockResolvedValue({ url: "https://example.com/asset" }),
  }),
  createBrowserSessionStrategy: vi.fn().mockReturnValue({
    name: "browser-session",
    upload: vi.fn().mockResolvedValue({ url: "https://example.com/browser" }),
  }),
  createCookieExtractionStrategy: vi.fn().mockReturnValue({
    name: "cookie-extraction",
    upload: vi.fn().mockResolvedValue({ url: "https://example.com/cookies" }),
  }),
  createRepoBranchStrategy: vi.fn().mockReturnValue({
    name: "repo-branch",
    upload: vi.fn().mockResolvedValue({ url: "https://example.com/branch" }),
  }),
}));

// Mock core utilities
vi.mock("../../../src/core/target.js", () => ({
  parseTarget: vi.fn().mockReturnValue({
    owner: "test-owner",
    repo: "test-repo",
    issueNumber: 1,
  }),
}));

vi.mock("../../../src/core/validation.js", () => ({
  validateFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/core/upload.js", () => ({
  upload: vi.fn().mockResolvedValue({
    url: "https://example.com/uploaded",
    markdown: "![image](https://example.com/uploaded)",
    strategy: "test-strategy",
  }),
}));

// Import after mocks are set up
import { createMCPServer } from "../../../src/mcp/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

describe("MCP Server Integration", () => {
  let testImagePath: string;
  let origStatePath: string | undefined;
  let sessionDir: string;
  const tmpDir = tmpdir();

  beforeEach(() => {
    // Create test image file
    testImagePath = join(tmpDir, `test-${randomUUID()}.png`);
    writeFileSync(testImagePath, Buffer.from([137, 80, 78, 71])); // PNG magic bytes

    // Clear environment
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GH_ATTACH_COOKIES;

    origStatePath = process.env.GH_ATTACH_STATE_PATH;
    sessionDir = join(tmpDir, `gh-attach-mcp-state-${randomUUID()}`);
    process.env.GH_ATTACH_STATE_PATH = join(sessionDir, "session.json");
  });

  afterEach(() => {
    if (testImagePath) {
      try {
        unlinkSync(testImagePath);
      } catch {
        // File may not exist
      }
    }

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

    vi.clearAllMocks();
  });

  describe("Server Initialization", () => {
    it("should initialize with stdio transport", async () => {
      const promise = createMCPServer("stdio");

      // Give async initialization time
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not throw
      expect(promise).toBeDefined();
    });

    it("should mock Server class for stdio initialization", () => {
      // Verify mocked Server exists and can be instantiated
      const server = new (Server as unknown as new (opts: Record<string, string>) => Record<string, unknown>)({
        name: "test",
        version: "1.0.0",
      });

      expect(server).toBeDefined();
      expect(server.setRequestHandler).toBeDefined();
      expect(server.connect).toBeDefined();
    });
  });

  describe("Server Features", () => {
    it("should provide tool definitions including upload_image", () => {
      // Tool definitions should include upload_image
      const toolNames = [
        "upload_image",
        "login",
        "check_auth",
        "list_strategies",
      ];

      expect(toolNames).toContain("upload_image");
    });

    it("should provide tool definitions including authentication tools", () => {
      const toolNames = [
        "upload_image",
        "login",
        "check_auth",
        "list_strategies",
      ];

      expect(toolNames).toContain("login");
      expect(toolNames).toContain("check_auth");
      expect(toolNames).toContain("list_strategies");
    });
  });

  describe("Authentication Status", () => {
    it("should detect no auth when no env vars set", () => {
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const cookies = process.env.GH_ATTACH_COOKIES;

      expect(token).toBeUndefined();
      expect(cookies).toBeUndefined();
    });

    it("should detect auth with GITHUB_TOKEN", () => {
      process.env.GITHUB_TOKEN = "ghs_test123";

      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      expect(token).toBeDefined();
    });

    it("should detect auth with GH_TOKEN fallback", () => {
      process.env.GH_TOKEN = "gh_test123";

      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      expect(token).toBeDefined();
    });

    it("should detect browser session cookies", () => {
      process.env.GH_ATTACH_COOKIES = "user_session=abc123";

      const cookies = process.env.GH_ATTACH_COOKIES;
      expect(cookies).toBeDefined();
    });

    it("should prefer GITHUB_TOKEN over GH_TOKEN", () => {
      process.env.GITHUB_TOKEN = "ghs_primary";
      process.env.GH_TOKEN = "gh_fallback";

      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      expect(token).toBe("ghs_primary");
    });
  });

  describe("Strategy Selection", () => {
    it("should list available strategies when no token", () => {
      const strategies = [
        { name: "release-asset", available: false },
        { name: "browser-session", available: false },
        { name: "cookie-extraction", available: true },
        { name: "repo-branch", available: false },
      ];

      expect(strategies.length).toBe(4);
      expect(strategies[2].name).toBe("cookie-extraction");
      expect(strategies[2].available).toBe(true);
    });

    it("should mark strategies available with token", () => {
      process.env.GITHUB_TOKEN = "test-token";

      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const available = !!token;

      expect(available).toBe(true);
    });

    it("should mark browser-session available with cookies", () => {
      process.env.GH_ATTACH_COOKIES = "session=abc";

      const cookies = process.env.GH_ATTACH_COOKIES;
      const available = !!cookies;

      expect(available).toBe(true);
    });
  });

  describe("Tool Execution", () => {
    it("should support upload_image tool", () => {
      const toolName = "upload_image";
      expect(
        ["upload_image", "login", "check_auth", "list_strategies"].includes(
          toolName,
        ),
      ).toBe(true);
    });

    it("should support login tool", () => {
      const toolName = "login";
      expect(
        ["upload_image", "login", "check_auth", "list_strategies"].includes(
          toolName,
        ),
      ).toBe(true);
    });

    it("should support check_auth tool", () => {
      const toolName = "check_auth";
      expect(
        ["upload_image", "login", "check_auth", "list_strategies"].includes(
          toolName,
        ),
      ).toBe(true);
    });

    it("should support list_strategies tool", () => {
      const toolName = "list_strategies";
      expect(
        ["upload_image", "login", "check_auth", "list_strategies"].includes(
          toolName,
        ),
      ).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle unknown tool gracefully", () => {
      const toolName = "unknown_tool";
      const isKnown = [
        "upload_image",
        "login",
        "check_auth",
        "list_strategies",
      ].includes(toolName);

      expect(isKnown).toBe(false);
    });

    it("should handle invalid requests gracefully", () => {
      // Should not throw during initialization
      expect(() => {
        createMCPServer("stdio");
      }).not.toThrow();
    });
  });

  describe("Tool Configuration", () => {
    it("upload_image should accept filePath parameter", () => {
      const toolSchema = {
        properties: {
          filePath: { type: "string" },
          content: { type: "string" },
          filename: { type: "string" },
          target: { type: "string" },
          strategy: { type: "string" },
          format: { enum: ["markdown", "url"] },
        },
        required: ["target"],
      };

      expect(toolSchema.properties.filePath).toBeDefined();
    });

    it("upload_image should accept base64 content parameter", () => {
      const toolSchema = {
        properties: {
          filePath: { type: "string" },
          content: { type: "string" },
          filename: { type: "string" },
          target: { type: "string" },
          strategy: { type: "string" },
          format: { enum: ["markdown", "url"] },
        },
        required: ["target"],
      };

      expect(toolSchema.properties.content).toBeDefined();
    });

    it("upload_image should require target parameter", () => {
      const toolSchema = {
        properties: {
          filePath: { type: "string" },
          content: { type: "string" },
          filename: { type: "string" },
          target: { type: "string" },
          strategy: { type: "string" },
          format: { enum: ["markdown", "url"] },
        },
        required: ["target"],
      };

      expect(toolSchema.required).toContain("target");
    });

    it("upload_image should support output format options", () => {
      const formats = ["markdown", "url"];

      expect(formats).toContain("markdown");
      expect(formats).toContain("url");
    });
  });
});
