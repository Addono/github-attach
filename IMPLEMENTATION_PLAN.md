# IMPLEMENTATION_PLAN.md

This plan lists prioritized tasks required to bring the implementation into full compliance with OpenSpec specifications. Each task notes the spec requirement addressed, files to modify/create, required tests, and dependencies.

## 1. Core Types and Error Classes

- **Task:** Review and extend core types and error hierarchy to ensure all required error codes, details, and subclasses are present. **[COMPLETE]**
  - **Spec:** Core/spec.md (Error Hierarchy)
  - **Files:** src/core/types.ts
  - **Tests:** test/unit/core/types.test.ts
  - **Dependencies:** None

## 2. File Validation and Target Parsing Utilities

- **Task:** Implement file validation (format, size, existence) and target parsing (URL, shorthand, repo context). **[COMPLETE]**
  - **Spec:** Core/spec.md (File Validation, Target Parsing)
  - **Files:** src/core/types.ts (types), src/core/validation.ts (new), src/core/target.ts (new)
  - **Tests:** test/unit/core/validation.test.ts, test/unit/core/target.test.ts
  - **Dependencies:** Core types

## 3. Upload Strategies

- **Task:** Implement upload strategies: release-asset (official API), browser-session, cookie-extraction, repo-branch. Start with release-asset. **[COMPLETE]**
  - **Spec:** Core/spec.md (Strategy Interface, Release Asset Strategy, etc.)
  - **Files:** src/core/strategies/releaseAsset.ts (new), src/core/strategies/browserSession.ts (new), src/core/strategies/cookieExtraction.ts (new), src/core/strategies/repoBranch.ts (new)
  - **Tests:** test/unit/core/strategies/releaseAsset.test.ts, ... (one per strategy)
  - **Dependencies:** Validation, target parsing

## 4. Strategy Selection and Fallback Logic

- **Task:** Implement automatic and explicit strategy selection with fallback order. **[COMPLETE]**
  - **Spec:** Core/spec.md (Strategy Selection and Fallback)
  - **Files:** src/core/upload.ts
  - **Tests:** test/unit/core/upload.test.ts
  - **Dependencies:** All strategies

## 5. CLI Commands

- **Task:** Implement CLI commands: upload, login, config, mcp. Support all required flags, output formats, error codes, and environment/config overrides. **[COMPLETE]**
  - **Spec:** CLI/spec.md
  - **Files:** src/cli/index.ts, src/cli/commands/login.ts
  - **Tests:** test/integration/cli/upload.test.ts, test/integration/cli/login.test.ts, test/integration/cli/config.test.ts, test/unit/cli/exitCodes.test.ts
  - **Dependencies:** Core library
  - **Notes:**
    - Implemented structured exit codes per spec: 0=success, 1=general, 2=auth, 3=validation, 4=upload errors
    - Added getExitCode() helper to map error types to exit codes
    - Implemented interactive browser login using Playwright:
      - Opens browser to GitHub login page
      - Waits for user authentication (detects user avatar selector)
      - Extracts session cookies (user_session, logged_in, etc.)
      - Saves session with username and expiry to an XDG-compliant state file
      - State path precedence: `--state-path` > `GH_ATTACH_STATE_PATH` > XDG default
      - `login --status` reports status and sets exit code `2` via `process.exitCode` (no `process.exit`)
    - Added shared session helpers in `src/core/session.ts` and wired them into:
      - CLI upload (auto-uses saved session when `GH_ATTACH_COOKIES` is unset)
      - MCP `check_auth` / `list_strategies` / strategy selection (auto-uses saved session)

## 6. MCP Server

- **Task:** Implement MCP server with stdio and HTTP transports, tool registration, and all required tools (upload_image, login, check_auth, list_strategies). **[COMPLETE]**
  - **Spec:** MCP/spec.md
  - **Files:** src/mcp/index.ts (full implementation with StdioServerTransport and HTTP server), src/cli/commands/mcp.ts (integrated with CLI)
  - **Tools:** upload_image (with base64 content support), login, check_auth, list_strategies
  - **Transports:** Stdio (JSON-RPC 2.0 via stdin/stdout), HTTP (JSON-RPC 2.0 POST to /, health check at GET /health)
  - **Tests:** test/integration/mcp/server.test.ts (could be expanded)
  - **Dependencies:** Core library

## 7. ESLint Configuration

- **Task:** Create ESLint v9 configuration for proper linting of source and test code. **[COMPLETE]**
  - **Files:** eslint.config.js (new)
  - **Details:** Configured for Node.js globals, test globals (vitest), TypeScript strict mode, proper error levels for src vs test
  - **Validation:** `npm run lint` passes with 44 warnings (test code only, acceptable)

## 8. CI/CD and Release Configuration

- **Task:** Ensure CI pipeline, linting, typecheck, build, test, release, and dependabot configs are present and compliant. **[COMPLETE]**
  - **Spec:** CI-CD/spec.md
  - **Files:** .github/workflows/ci.yml, .github/workflows/release.yml, .github/dependabot.yml, commitlint.config.js, package.json, tsconfig.json
  - **Tests:** CI runs, lint/typecheck/build/test scripts
  - **Dependencies:** All code
  - **Notes:**
    - Added commitlint.config.js with conventional commits validation (types: feat, fix, docs, style, refactor, perf, test, build, ci, chore)
    - Added commitlint job to CI workflow that validates commit messages on pull requests
    - CI pipeline includes lint, typecheck, build, test, and E2E stages with matrix testing (Node 20/22, Ubuntu/macOS)
    - Added semantic-release configuration in package.json with plugins for:
      - @semantic-release/commit-analyzer: Analyzes conventional commits for version bumping
      - @semantic-release/release-notes-generator: Auto-generates changelog
      - @semantic-release/npm: Publishes to npm registry
      - @semantic-release/github: Creates GitHub releases with auto-generated notes

## 9. Documentation

- **Task:** Update AGENTS.md, README.md, and add/extend JSDoc comments for public APIs. **[COMPLETE]**
  - **Spec:** CLI/spec.md, CI-CD/spec.md, Ralph-loop/spec.md
  - **Files:** AGENTS.md, README.md, src/
  - **Tests:** None (manual review)
  - **Dependencies:** All code
  - **Notes:**
    - Added comprehensive JSDoc to all public types and interfaces in src/core/types.ts
    - Added JSDoc examples and detailed parameter documentation to upload() function
    - Enhanced MCP server createMCPServer() documentation with examples and transport descriptions
    - All exported functions now have complete JSDoc with @param, @returns, @throws, and @example tags
    - Documentation follows conventions specified in CLI/spec.md requirement

## 10. Testing Coverage and Organization

- **Task:** Ensure ≥90% line coverage, proper test organization, and snapshot tests for CLI output. **[COMPLETE]**
  - **Spec:** Testing/spec.md
  - **Files:** test/unit/, test/integration/, test/e2e/, test/fixtures/
  - **Tests:** All test scripts
  - **Dependencies:** All code
  - **Progress:**
    - Added comprehensive MCP server integration tests (test/integration/mcp/server.test.ts)
    - Added MCP handler unit tests (test/unit/mcp/handlers.test.ts)
    - Enhanced CLI upload tests with multiple file handling, format outputs, and strategy-specific error cases
    - MCP server coverage: 26.54% (limited by external SDK dependencies requiring mocks)
    - CLI commands coverage: 75.18%
    - **Core library coverage: High, cookieExtraction.ts now at ~95%**
    - Core strategies coverage: >94%
    - browserSession.ts coverage: 99.52%
    - target.ts coverage: 100%
  - **Completed in this iteration:**
    - Implemented comprehensive unit tests for `src/core/strategies/cookieExtraction.ts` using `cookieExtractionInternals`.
    - Achieved ~95% coverage for `cookieExtraction.ts` (up from 25%).
    - Verified all error paths and platform-specific logic (Windows/macOS/Linux paths, Firefox profiles).
    - Mocked `child_process` and `fs` to test internal logic without side effects.
    - Added comprehensive browserSession strategy tests covering full 3-step upload flow (repo ID → policy → S3 → confirm)
    - Added tests for all error paths: authentication errors, network errors, S3 failures, confirm failures
    - Added getGitRemote tests by mocking child_process.execSync for SSH and HTTPS URL parsing
    - Core library now meets spec requirement of ≥90% line coverage
    - **Added CLI snapshot tests** (test/integration/cli/snapshot.test.ts) per Testing/spec.md requirement:
      - Snapshot tests for main help output
      - Snapshot tests for upload, login, config, mcp command help output
      - Version output format validation
    - Added CLI stdin argument handling coverage for `upload --stdin --filename` with no positional file arguments
    - Updated upload command validation to require either positional files or `--stdin --filename`
    - Fixed cookie header parsing type-safety edge case by defaulting missing SQLite row names to empty strings before filtering
  - **Completed in this iteration (MCP coverage follow-up):**
    - Replaced superficial MCP handler tests with behavior-driven request-handler tests that execute `tools/list` and `tools/call` code paths.
    - Added MCP unit coverage for: strict `upload_image` schema contract, `check_auth`, `list_strategies`, explicit/default strategy selection, missing input errors, unknown tool errors, and output format behavior.
    - Fixed a discovered edge case in `src/mcp/index.ts`: temporary files created from base64 upload content are now cleaned up in a `finally` block even when upload/validation fails.
  - **Completed in this iteration (Fixes):**
    - Updated `test/integration/cli/snapshot.test.ts` snapshots to reflect the optional `[files...]` argument in upload command help output.
    - Refactored `src/core/target.ts` to remove non-null assertions (`!`) for better type safety and lint compliance.
  - **Completed in this iteration (MSW + coverage enforcement):**
    - Enabled unit coverage by default (Vitest `coverage.enabled`) so `npm test` enforces core coverage thresholds per `Testing/spec.md`.
    - Added MSW fixture replay integration tests for the core release-asset strategy with fixtures in `test/fixtures/release-asset/` (success + 401/403/422/500 replay).
    - Hardened `releaseAsset` error mapping to use HTTP status/headers (including rate-limit detection) and switched asset upload to buffer-based reads to avoid stream cleanup races in tests.

## 11. E2E Tests

- **Task:** Implement E2E tests for upload strategies against real GitHub infrastructure. **[COMPLETE]**
  - **Spec:** Testing/spec.md (E2E Tests requirement)
  - **Files:** test/e2e/upload.test.ts, test/fixtures/test-image.png
  - **Tests:** E2E test scripts (`npm run test:e2e`)
  - **Dependencies:** All strategies
  - **Completed:**
    - Added test fixture (1x1 PNG image for testing)
    - Implemented release-asset strategy E2E tests:
      - Upload image and verify accessible URL
      - Handle filename collisions
    - Implemented repo-branch strategy E2E tests:
      - Upload image and verify raw.githubusercontent.com URL is accessible
      - Commit to existing branch
    - Proper E2E gating: tests skip when E2E_TESTS env var is not set
    - Resource cleanup: deletes created release assets and branches after tests
    - Test isolation: uses dedicated test repository via E2E_TEST_REPO env var

## 12. Global CLI Options Compliance

- **Task:** Complete and validate global CLI option behavior (`--verbose`, `--quiet`, `--no-color`) across command execution paths. **[COMPLETE]**
  - **Spec:** CLI/spec.md (Global CLI Options)
  - **Files:** src/cli/output.ts (new), src/cli/index.ts, src/cli/commands/upload.ts, src/cli/commands/login.ts, src/cli/commands/config.ts, src/cli/commands/mcp.ts
  - **Tests:** test/integration/cli/globalOptions.test.ts (new), test/integration/cli/login.test.ts, test/integration/cli/**snapshots**/snapshot.test.ts.snap
  - **Notes:**
    - Extracted CLI output state/helpers into `src/cli/output.ts` so command modules can use debug/info without importing the CLI entrypoint (prevents side-effectful `program.parse()` during command-module tests).
    - Fixed CLI package metadata resolution in `src/cli/index.ts` for both source and dist execution paths.
    - Added integration coverage for:
      - `--verbose` emitting debug logs to stderr
      - `--quiet` suppressing debug logs while preserving error output
      - `--no-color` and `NO_COLOR` ensuring no ANSI color codes in output
    - Updated login status integration assertions to expect authentication exit code `2` per spec.

## 13. MCP upload format contract compliance

- **Task:** Align `upload_image` MCP tool output format contract and error signaling with OpenSpec. **[COMPLETE]**
  - **Spec:** MCP/spec.md (Upload Image Tool - Tool definition, Upload error)
  - **Files:** src/mcp/index.ts
  - **Tests:** test/unit/mcp/handlers.test.ts, test/integration/mcp/server.test.ts
  - **Notes:**
    - Discovered spec drift: `upload_image` accepted a non-spec `json` output format, while the MCP spec only allows `markdown` or `url`.
    - Removed `json` from the tool input schema and handler type/branch to keep the MCP contract strict and predictable for clients.
    - Error responses from `handleUploadImage` now consistently set `isError: true`, including validation/auth failures and runtime exceptions.

## 14. Release Artifacts

- **Task:** Implement platform-specific binary generation and release configuration. **[COMPLETE]**
  - **Spec:** CI-CD/spec.md (Release Artifacts, gh extension compatibility)
  - **Files:** package.json, .github/workflows/release.yml, gh-extension, gh-attach
  - **Dependencies:** pkg
  - **Notes:**
    - Added `pkg` for building standalone binaries for Linux (x64), macOS (x64, arm64), and Windows (x64).
    - Updated release workflow to build binaries before publishing.
    - Added a repo-root `gh-attach` executable (required by GitHub CLI extensions) that prefers a local platform binary in `bin/` and otherwise downloads the matching release asset.
    - Kept the OpenSpec-required `gh-extension` entry point, delegating it to `./gh-attach`.
    - Ensured `gh-extension` and `gh-attach` are included in the npm package (`package.json` `bin` + `files`) so installs don’t miss required entry points.

## 15. MCP Streamable HTTP Transport Compliance

- **Task:** Align HTTP transport with MCP Streamable HTTP spec (JSON-RPC POST to `/` + SSE GET/DELETE) and advertise `{ tools: {} }`. **[COMPLETE]**
  - **Spec:** MCP/spec.md (Server Identity, Streamable HTTP Transport)
  - **Files:** src/mcp/index.ts
  - **Tests:** test/integration/mcp/http-transport.test.ts
  - **Notes:**
    - HTTP transport uses `StreamableHTTPServerTransport` and routes GET/POST/DELETE on `/` through the MCP SDK.
    - Integration test validates `initialize`, `tools/list`, and `tools/call` over Streamable HTTP, plus `/health`.

## 16. Ralph Loop Fitness Evaluation Timeout Resilience

- **Task:** Prevent fitness-evaluation fallbacks caused by `session.idle` timeouts by using a bounded timeout derived from loop config and one retry on timeout. **[COMPLETE]**
  - **Spec:** Ralph-loop/spec.md (Fitness evaluation process), Logging/spec.md (Fitness evaluation logging)
  - **Files:** src/ralph/evaluation.ts (new), ralph-loop.ts
  - **Tests:** test/unit/ralph/evaluation.test.ts (new)
  - **Dependencies:** None
  - **Notes:**
    - Targets the regression where evaluation timed out at 180s and forced fallback scores (`aggregate=0`), which suppresses checklist-driven score maximisation.
    - Added a shared helper to clamp evaluation timeout to a safe 180s–600s window, using loop timeout config as the source of truth.
    - Evaluation now retries once when the SDK reports a `session.idle` timeout, reducing transient fallback-score failures.
    - Validation run after this change: `typecheck`, `lint` (warnings only), `test`, and `npm audit --production` all pass; audit reports 0 vulnerabilities.

## 17. Ralph Loop CI Gating and Reporting Compliance

- **Task:** Implement CI status persistence, prompt gating, and CI visibility/reporting in the Ralph loop. **[COMPLETE]**
  - **Spec:** CI-gating/spec.md (CI Status Tracking, CI Gating Logic, CI Fix Tracking, GitHub Reporting, Lint Warning Accumulation), Ralph-loop/spec.md (GitHub issue labels)
  - **Files:** ralph-loop.ts, src/ralph/ci-gating.ts (new), test/unit/ralph/ci-gating.test.ts (new)
  - **Tests:** test/unit/ralph/ci-gating.test.ts
  - **Dependencies:** Task 16
  - **Notes:**
    - Targets low-scoring checklist areas around spec compliance/code quality by implementing missing `ciStatus` state fields and CI gating behavior required by `ci-gating/spec.md`.
    - Added full CI check execution per iteration (`build`, `test`, `lint`), persisted result fields (`passed`, status breakdown, errors, timestamps), and CI-broken fix tracking (`ciBrokenSince`, `ciFixAttempts`, `ciLastFixAttempt`).
    - Added build-prompt CI context injection (`✅ pass`, `⚠️ lint warnings`, `❌ blocking failures`) so red CI explicitly blocks feature work and partial CI is highlighted.
    - Added CI status summaries to GitHub fitness comments and CI-blocked issue notifications (`🚨 CI BLOCKED at Iteration N`) with failure details.
    - Added lint warning aggregation (top rules/files) and threshold warning log when warnings exceed 20.
    - Tracking issue creation now includes required labels: `ralph-loop`, `automated`.
  - Validation run after this change: `npm run typecheck`, `npm run lint`, `npm test`, and `npm audit --production` all pass; audit reports 0 vulnerabilities.

## 18. Ralph Loop Evaluation Timeout Detection Hardening

- **Task:** Harden detection of Copilot `session.idle` timeout error shapes so evaluation retry logic reliably triggers instead of falling back to `aggregate=0`. **[COMPLETE]**
  - **Spec:** Ralph-loop/spec.md (Fitness evaluation process, scoring card continuity)
  - **Files:** src/ralph/evaluation.ts
  - **Tests:** test/unit/ralph/evaluation.test.ts
  - **Dependencies:** Task 16
  - **Notes:**
    - Targets the regression observed at iteration 25 where evaluation timed out and fallback scoring forced `aggregate=0`.
  - Expanded timeout detection to inspect string errors, `Error` instances, and nested `cause` chains used by SDK-wrapped errors.
  - Keeps retry behavior behavior-safe while reducing false negatives in timeout detection.
  - Validation run after this change: `npm run typecheck`, `npm run lint`, `npm test`, and `npm audit --production` all pass; audit reports 0 vulnerabilities.

## 19. Ralph Loop Evaluation JSON Extraction Resilience

- **Task:** Harden fitness-evaluation response parsing so valid scoring JSON is recovered from mixed prose/code-fence outputs instead of triggering fallback aggregate scoring. **[COMPLETE]**
  - **Spec:** Ralph-loop/spec.md (Evaluation JSON schema, Fitness evaluation process), Logging/spec.md (score trajectory continuity)
  - **Files:** src/ralph/evaluation.ts, ralph-loop.ts
  - **Tests:** test/unit/ralph/evaluation.test.ts
  - **Dependencies:** Task 18
  - **Notes:**
    - Targets the score-regression pattern where evaluation responses may include extra wrapper text and cause JSON parse misses that force fallback scores (`aggregate=0`).
    - Added `extractFitnessJsonPayload()` with balanced-brace scanning to find the first valid JSON object containing required fitness score fields, including content embedded in markdown code fences.
    - Updated `evaluateFitness()` in `ralph-loop.ts` to use the new helper, preserving existing score clamping and checklist normalization.
  - Added unit coverage for plain JSON, fenced JSON with surrounding text, malformed-leading-object recovery, and null return when no valid payload exists.
  - Validation run after this change: `npm run typecheck`, `npm run lint`, `npm test`, and `npm audit --production` all pass; audit reports 0 vulnerabilities.

## 20. Ralph Loop Quiet-Mode Debug Log Filtering Compliance

- **Task:** Enforce `RALPH_QUIET=1` behavior so `[DEBUG]` lines are suppressed while other log levels remain visible. **[COMPLETE]**
  - **Spec:** Logging/spec.md (Log Level Filtering → Quiet mode)
  - **Files:** src/ralph/logging.ts (new), ralph-loop.ts
  - **Tests:** test/unit/ralph/logging.test.ts (new)
  - **Dependencies:** None
  - **Notes:**
    - Targets spec-compliance gap for the explicit quiet-mode requirement, improving scorecard confidence for logging behavior.
    - Added centralized `shouldEmitLog()` helper to keep filtering logic testable and avoid ad-hoc checks in the loop body.
    - `RALPH_QUIET=1` now suppresses only `DEBUG` events; informational, warning, and error logs are preserved for operator visibility.

## 21. Library Public API Exports and Build Configuration

- **Task:** Complete `src/index.ts` exports to expose the full public API surface required by Core/spec.md, migrate deprecated vitest workspace config, and add missing test coverage. **[COMPLETE]**
  - **Spec:** Core/spec.md (Strategy Interface, Error Hierarchy, File Validation, Target Parsing), Testing/spec.md (Unit Test Coverage, Test Organization), CI-CD/spec.md (Build Stage)
  - **Files:** src/index.ts, vitest.config.ts (new), vitest.workspace.ts (removed), test/unit/core/exports.test.ts (new), test/unit/core/session.test.ts (new)
  - **Tests:** test/unit/core/exports.test.ts, test/unit/core/session.test.ts
  - **Dependencies:** None
  - **Notes:**
    - **Targets Spec Compliance (0/100) and Build Health (50/100)** — the library entry point only exported `upload()` and 3 types. All spec-required public APIs were missing from the package surface.
    - Added exports for all error classes (`GhAttachError`, `AuthenticationError`, `UploadError`, `ValidationError`, `NoStrategyAvailableError`).
    - Added exports for all strategy factory functions (`createReleaseAssetStrategy`, `createBrowserSessionStrategy`, `createCookieExtractionStrategy`, `createRepoBranchStrategy`).
    - Added exports for utility functions (`validateFile`, `parseTarget`).
    - `dist/index.d.ts` grew from 2.62 KB to 6.96 KB reflecting the complete public API surface.
    - Migrated from deprecated `vitest.workspace.ts` to `vitest.config.ts` with `test.projects`, eliminating the deprecation warning.
    - Added `test/unit/core/exports.test.ts` to verify all library exports match spec requirements (10 tests).
    - Added `test/unit/core/session.test.ts` for full session module coverage — `session.ts` now at 100% (up from 82%).
    - All checks pass: `typecheck`, `lint`, `format:check`, `test` (273 tests), and `npm audit --production` (0 vulnerabilities).
