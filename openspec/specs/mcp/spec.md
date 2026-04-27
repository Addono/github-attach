# MCP Server Specification

## Purpose

The `gh-attach` MCP server exposes image upload functionality as tools that AI applications (Claude, Copilot, etc.) can invoke via the Model Context Protocol. It supports both stdio and Streamable HTTP transports.

## Requirements

### Requirement: MCP Server Identity

The system SHALL register as an MCP server with proper metadata.

#### Scenario: Server initialization

- GIVEN the MCP server starts
- THEN it SHALL identify as `{ name: "gh-attach", version: "<package-version>" }`
- AND declare capabilities `{ tools: {} }`

### Requirement: Upload Image Tool

The system SHALL expose an `upload_image` tool.

#### Scenario: Tool definition

- GIVEN an MCP client lists available tools
- THEN `upload_image` SHALL be listed with:
  - `description`: "Upload an image to GitHub and get a markdown embed URL"
  - `inputSchema`: `{ filePath: string, target: string, strategy?: string, format?: "markdown" | "url" }`

#### Scenario: Successful upload via tool call

- GIVEN a valid `filePath` and `target`
- WHEN the MCP client calls `upload_image`
- THEN it SHALL upload the image using the core library
- AND return `{ type: "text", text: "<markdown or url>" }`

#### Scenario: Single-call upload with elicited token

- GIVEN no saved token or browser session is available
- AND the MCP host supports elicitation
- WHEN the MCP client calls `upload_image`
- THEN the server SHALL request a GitHub token during that same tool call
- AND retry strategy selection with the elicited token before returning
- AND complete the upload without requiring a separate `login` call first

#### Scenario: Upload with base64 content

- GIVEN `content` (base64 encoded) instead of `filePath`
- WHEN the MCP client calls `upload_image` with `{ content: "base64...", filename: "screenshot.png", target: "#42" }`
- THEN it SHALL decode the base64 content, write to a temp file, upload, and clean up

#### Scenario: Upload error

- GIVEN an upload that fails
- WHEN the error occurs
- THEN it SHALL return `{ type: "text", text: "Error: <message>", isError: true }`

### Requirement: Login Tool

The system SHALL expose a `login` tool for session management.

#### Scenario: Interactive login request

- GIVEN no valid session
- WHEN the MCP client calls `login`
- THEN it SHALL return instructions for the user to authenticate
- AND if the MCP host supports elicitation, use it to guide the login flow

### Requirement: Check Auth Status Tool

The system SHALL expose a `check_auth` tool.

#### Scenario: Auth status check

- GIVEN a session may or may not exist
- WHEN the MCP client calls `check_auth`
- THEN it SHALL return `{ type: "text", text: "{ \"authenticated\": true/false, \"strategies\": [...] }" }`

### Requirement: List Strategies Tool

The system SHALL expose a `list_strategies` tool.

#### Scenario: Strategy listing

- WHEN the MCP client calls `list_strategies`
- THEN it SHALL return a JSON array of available strategies with their status

### Requirement: Stdio Transport

The system SHALL support stdio transport for local MCP communication.

#### Scenario: Stdio startup

- GIVEN the command `gh-attach mcp --transport stdio`
- WHEN the process starts
- THEN it SHALL communicate via JSON-RPC 2.0 over stdin/stdout
- AND log diagnostic messages to stderr

### Requirement: Streamable HTTP Transport

The system SHALL support Streamable HTTP transport for remote MCP communication.

#### Scenario: HTTP server startup

- GIVEN the command `gh-attach mcp --transport http --port 3000`
- WHEN the server starts
- THEN it SHALL listen on the specified port
- AND handle MCP requests via HTTP POST
- AND support Server-Sent Events for streaming responses

#### Scenario: Health check

- GIVEN the HTTP server is running
- WHEN a GET request is made to `/health`
- THEN it SHALL return `200 OK` with `{ "status": "ok", "version": "<version>" }`

### Requirement: Auth Forwarding

The system SHALL support forwarding authentication from the MCP host.

#### Scenario: Token from environment

- GIVEN `GITHUB_TOKEN` is set in the environment
- WHEN the MCP server processes an upload request
- THEN it SHALL use the token for API-based strategies (release-asset, repo-branch)

#### Scenario: GitHub CLI token fallback

- GIVEN neither `GITHUB_TOKEN` nor `GH_TOKEN` is set
- AND the user has authenticated via the GitHub CLI (`gh auth login`)
- WHEN the MCP server processes an upload request
- THEN it SHALL fall back to the token returned by `gh auth token`, preferring an account that can access the target repository
- AND it SHALL only request elicitation or report missing authentication when no environment, session, or GitHub CLI token can be resolved

#### Scenario: Session from config

- GIVEN a saved browser session exists
- WHEN the MCP server processes an upload request
- THEN it SHALL automatically use the session for browser-based strategies

### Requirement: Docker MCP Server

The system SHALL be usable as an MCP server via Docker container.

#### Scenario: Docker stdio MCP server

- GIVEN the Docker image `ghcr.io/addono/gh-attach`
- WHEN a user runs:
  ```
  docker run -i -e GITHUB_TOKEN=ghp_xxx ghcr.io/addono/gh-attach mcp --transport stdio
  ```
- THEN it SHALL start the MCP server communicating via JSON-RPC 2.0 over stdin/stdout

#### Scenario: Docker HTTP MCP server

- GIVEN the Docker image
- WHEN a user runs:
  ```
  docker run -p 3000:3000 -e GITHUB_TOKEN=ghp_xxx ghcr.io/addono/gh-attach mcp --transport http --port 3000
  ```
- THEN it SHALL start the HTTP MCP server listening on port 3000
- AND the `/health` endpoint SHALL be accessible from the host

#### Scenario: MCP client configuration

- GIVEN an MCP client configuration (e.g., Claude Desktop, VS Code)
- THEN the Docker MCP server SHALL be configurable as:
  ```json
  {
    "mcpServers": {
      "gh-attach": {
        "command": "docker",
        "args": [
          "run",
          "-i",
          "--rm",
          "-e",
          "GITHUB_TOKEN",
          "ghcr.io/addono/gh-attach",
          "mcp",
          "--transport",
          "stdio"
        ]
      }
    }
  }
  ```
