import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = "/Users/adriaan_knapen/programming/addono/gh-attach";
const CLI = `${ROOT}/dist/cli.js`;
const transports: StdioClientTransport[] = [];

afterEach(async () => {
  while (transports.length > 0) {
    const transport = transports.pop();
    if (transport) {
      await transport.close();
    }
  }
});

describe("MCP stdio test bed", () => {
  it("lists upload_image with markdown, url, and json formats", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, "mcp", "--transport", "stdio"],
      cwd: ROOT,
      env: { ...process.env },
      stderr: "pipe",
    });
    transports.push(transport);

    const client = new Client(
      { name: "gh-attach-stdio-test", version: "0.0.0" },
      { capabilities: {} },
    );
    await client.connect(transport);

    const tools = await client.listTools();
    const uploadTool = tools.tools.find((tool) => tool.name === "upload_image");
    expect(uploadTool).toBeDefined();

    const inputSchema = uploadTool?.inputSchema as {
      properties?: { format?: { enum?: string[] } };
    };
    expect(inputSchema.properties?.format?.enum).toEqual([
      "markdown",
      "url",
      "json",
    ]);

    await client.close();
  });

  it("handles auth inspection over stdio without crashing", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, "mcp", "--transport", "stdio"],
      cwd: ROOT,
      env: { ...process.env },
      stderr: "pipe",
    });
    transports.push(transport);

    const client = new Client(
      { name: "gh-attach-stdio-test", version: "0.0.0" },
      { capabilities: {} },
    );
    await client.connect(transport);

    const result = await client.callTool({
      name: "check_auth",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0]?.text ?? "{}");
    expect(typeof body.authenticated).toBe("boolean");
    expect(Array.isArray(body.strategies)).toBe(true);

    await client.close();
  });
});
