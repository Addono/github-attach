# gh-attach

[![CI](https://github.com/Addono/gh-attach/actions/workflows/ci.yml/badge.svg)](https://github.com/Addono/gh-attach/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/gh-attach)](https://www.npmjs.com/package/gh-attach)

> Upload images to GitHub issues, PRs, and comments — from the CLI or via MCP.

<p align="center">
  <img src="demo.svg" alt="gh-attach CLI demo" width="700">
</p>

GitHub doesn't provide an official API for attaching images to issues and pull requests. `gh-attach` fills this gap with multiple upload strategies, a clean CLI, and an MCP server for AI-powered workflows.

## Features

- **Multiple upload strategies** — browser session, cookie extraction, release assets (official API), repo-branch fallback
- **CLI tool** — works standalone or as a `gh` extension (`gh attach`)
- **MCP server** — expose upload capabilities to AI applications via Model Context Protocol
- **Fully tested** — unit, integration, and E2E test suites
- **Automated releases** — semantic versioning with conventional commits

## Install

### Standalone CLI (npm)

```bash
# Install globally from GitHub Packages
npm install -g @addono/gh-attach --registry=https://npm.pkg.github.com
```

Run it as `gh-attach ...`.

### GitHub CLI extension

```bash
gh extension install Addono/gh-attach
```

Run it as `gh attach ...`.

### Standalone release binary

Download the matching asset from the [latest release](https://github.com/Addono/gh-attach/releases/latest) and place it on your `PATH`. Release assets are published as:

- `gh-attach-darwin-arm64`
- `gh-attach-darwin-amd64`
- `gh-attach-linux-amd64`
- `gh-attach-windows-amd64.exe`

Run it as `gh-attach ...`.

## Run without installing (npx)

```bash
# Upload an image
npx --registry=https://npm.pkg.github.com @addono/gh-attach upload ./screenshot.png --target owner/repo#42

# Start the MCP server
npx --registry=https://npm.pkg.github.com @addono/gh-attach mcp --transport stdio
```

## Keeping gh-attach up to date

```bash
# npm install
npm install -g @addono/gh-attach@latest --registry=https://npm.pkg.github.com

# gh extension install
gh extension upgrade Addono/gh-attach
```

If you run via `npx`, there is nothing to upgrade locally — each invocation resolves the published package. Pin a version explicitly if you do not want the latest release:

```bash
npx --registry=https://npm.pkg.github.com @addono/gh-attach@<version> mcp --transport stdio
```

If you installed a standalone release binary, download the newest matching asset from the latest GitHub release and replace your existing `gh-attach` executable.

Verify the active version with `gh-attach --version` or `gh attach --version`, depending on how you installed it.

## Quick Start

If you installed `gh-attach` as a GitHub CLI extension, replace `gh-attach` with `gh attach` in the examples below.

```bash
# Upload an image to an issue
gh-attach upload ./screenshot.png --target owner/repo#42

# Upload using the release-asset strategy (official API, works with tokens)
gh-attach upload ./diagram.png --target #42 --strategy release-asset

# Get just the URL
gh-attach upload ./img.png --target #42 --format url

# JSON output
gh-attach upload ./img.png --target #42 --format json
```

## Authentication

### Strategy 1: Browser Session (default)

```bash
gh-attach login  # Opens browser, saves session cookies
```

### Strategy 2: Release Assets (official API)

```bash
export GITHUB_TOKEN=ghp_...  # or GH_TOKEN
gh-attach upload ./img.png --target #42 --strategy release-asset
```

### Strategy 3: Cookie Extraction

Automatically extracts GitHub cookies from Chrome/Firefox.

### Strategy 4: Repository Branch

Commits images to an orphan branch. Works with any token.

## MCP Server

Choose the MCP command that matches how you installed `gh-attach`:

| Install method            | MCP command                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Standalone npm install    | `gh-attach mcp --transport stdio`                                                   |
| Standalone release binary | `gh-attach mcp --transport stdio`                                                   |
| `gh` extension            | `gh attach mcp --transport stdio`                                                   |
| `npx`                     | `npx --registry=https://npm.pkg.github.com @addono/gh-attach mcp --transport stdio` |

When the MCP client supports elicitation, `upload_image` can prompt for a GitHub token during the same tool call and continue the upload without requiring a separate `login` step first.

```bash
# stdio transport (standalone install or release binary)
gh-attach mcp --transport stdio

# stdio transport (gh extension)
gh attach mcp --transport stdio

# HTTP transport
gh-attach mcp --transport http --port 3000
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

#### Standalone CLI or release binary

```json
{
  "mcpServers": {
    "gh-attach": {
      "command": "gh-attach",
      "args": ["mcp", "--transport", "stdio"]
    }
  }
}
```

#### GitHub CLI extension

```json
{
  "mcpServers": {
    "gh-attach": {
      "command": "bash",
      "args": [
        "-lc",
        "export GITHUB_TOKEN=\"$(gh auth token)\" && exec gh attach mcp --transport stdio"
      ]
    }
  }
}
```

### VS Code / GitHub Copilot

Add to `.vscode/settings.json`:

#### Standalone CLI or release binary

```json
{
  "mcp": {
    "servers": {
      "gh-attach": {
        "type": "local",
        "command": "gh-attach",
        "args": ["mcp", "--transport", "stdio"],
        "tools": ["*"]
      }
    }
  }
}
```

#### GitHub CLI extension

```json
{
  "mcp": {
    "servers": {
      "gh-attach": {
        "type": "local",
        "command": "bash",
        "args": [
          "-lc",
          "export GITHUB_TOKEN=\"$(gh auth token)\" && exec gh attach mcp --transport stdio"
        ],
        "tools": ["*"]
      }
    }
  }
}
```

If you prefer `npx`, use `command: "npx"` and prepend `--registry=https://npm.pkg.github.com`, `@addono/gh-attach` to the `args` array.

## Configuration

```bash
gh-attach config set strategy-order "release-asset,browser-session"
gh-attach config set default-target owner/repo
gh-attach config list
gh-attach config get default-target
```

Config is stored at `~/.config/gh-attach/config.json` (overridable via `GH_ATTACH_CONFIG` or `XDG_CONFIG_HOME`).

## Environment Variables

| Variable                    | Description                                                   |
| --------------------------- | ------------------------------------------------------------- |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API token for release-asset and repo-branch strategies |
| `GH_ATTACH_COOKIES`         | Session cookies for browser-session strategy                  |
| `GH_ATTACH_STRATEGY`        | Override default strategy selection                           |
| `GH_ATTACH_STATE_PATH`      | Override session state file location                          |
| `GH_ATTACH_CONFIG`          | Override config file location                                 |
| `NO_COLOR`                  | Disable ANSI color codes in output                            |

## Exit Codes

| Code | Meaning                      |
| ---- | ---------------------------- |
| `0`  | Success                      |
| `1`  | General error                |
| `2`  | Authentication error         |
| `3`  | Validation error (bad input) |
| `4`  | Network/upload error         |

## Programmatic Usage

```typescript
import { upload, selectStrategy } from "gh-attach";

const strategy = await selectStrategy({ token: process.env.GITHUB_TOKEN });
const result = await strategy.upload({
  file: "./screenshot.png",
  target: { owner: "octocat", repo: "hello-world", issue: 42 },
});
console.log(result.url); // https://github.com/user-attachments/assets/...
```

## Development

```bash
npm install
npm run build       # Build with tsup
npm test            # Unit + integration tests
npm run test:e2e    # E2E tests (requires secrets)
npm run typecheck   # TypeScript strict mode
npm run lint        # ESLint
```

### Branch Protection (Recommended)

For production repositories, configure the following protections on the `main` branch via **Settings → Branches → Branch protection rules**:

| Setting                                       | Value                                                                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Require a pull request before merging**     | ✅ enabled                                                                                                                                                                    |
| **Require approvals**                         | 1 review                                                                                                                                                                      |
| **Require status checks to pass**             | ✅ enabled                                                                                                                                                                    |
| **Required status checks**                    | `Lint & Format`, `Typecheck`, `Build`, and the `Test (...)` matrix jobs you want to enforce (for example `Test (Node 22, ubuntu-latest)` and `Test (Node 24, ubuntu-latest)`) |
| **Require branches to be up to date**         | ✅ enabled                                                                                                                                                                    |
| **Require conversation resolution**           | ✅ enabled                                                                                                                                                                    |
| **Require linear history**                    | ✅ enabled                                                                                                                                                                    |
| **Do not allow bypassing the above settings** | ✅ enabled                                                                                                                                                                    |

To configure via the GitHub CLI:

```bash
gh api repos/{owner}/{repo}/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"checks":[{"context":"Lint & Format"},{"context":"Typecheck"},{"context":"Build"},{"context":"Test (Node 22, ubuntu-latest)"},{"context":"Test (Node 24, ubuntu-latest)"}]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1}' \
  --field restrictions=null
```

### Ralph Loop (Autonomous Development)

This project uses a [Ralph Loop](https://ghuntley.com/ralph/) for autonomous implementation:

```bash
# Planning mode — generate/update IMPLEMENTATION_PLAN.md
npx tsx ralph-loop.ts plan

# Building mode — implement tasks from the plan
npx tsx ralph-loop.ts build

# Limit iterations
npx tsx ralph-loop.ts build 10
```

The loop rotates models after each evaluation cycle and posts fitness scores to a GitHub issue for tracking.

## Specifications

See [`openspec/specs/`](openspec/specs/) for the full OpenSpec specifications:

- [Core Upload Library](openspec/specs/core/spec.md)
- [CLI](openspec/specs/cli/spec.md)
- [MCP Server](openspec/specs/mcp/spec.md)
- [Testing](openspec/specs/testing/spec.md)
- [CI/CD](openspec/specs/ci-cd/spec.md)
- [Ralph Loop](openspec/specs/ralph-loop/spec.md)

## License

MIT
