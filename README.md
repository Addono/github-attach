# gh-attach

> Upload images to GitHub issues, PRs, and comments — from the CLI or via MCP.

GitHub doesn't provide an official API for attaching images to issues and pull requests. `gh-attach` fills this gap with multiple upload strategies, a clean CLI, and an MCP server for AI-powered workflows.

## Features

- **Multiple upload strategies** — browser session, cookie extraction, release assets (official API), repo-branch fallback
- **CLI tool** — works standalone or as a `gh` extension (`gh attach`)
- **MCP server** — expose upload capabilities to AI applications via Model Context Protocol
- **Fully tested** — unit, integration, and E2E test suites
- **Automated releases** — semantic versioning with conventional commits

## Install

```bash
# npm (standalone)
npm install -g gh-attach

# gh extension
gh extension install owner/gh-attach
```

## Quick Start

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

```bash
# stdio transport (for Claude Desktop, VS Code, etc.)
gh-attach mcp --transport stdio

# HTTP transport
gh-attach mcp --transport http --port 3000
```

## Configuration

```bash
gh-attach config set strategy-order "release-asset,browser-session"
gh-attach config set default-target owner/repo
gh-attach config list
```

Config is stored at `~/.config/gh-attach/config.json` (overridable via `GH_ATTACH_CONFIG`).

## Development

```bash
npm install
npm run build       # Build with tsup
npm test            # Unit + integration tests
npm run test:e2e    # E2E tests (requires secrets)
npm run typecheck   # TypeScript strict mode
npm run lint        # ESLint
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