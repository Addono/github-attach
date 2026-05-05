# Testing Specification

## Purpose

Define the testing strategy for `gh-attach` to ensure all upload strategies, CLI commands, and MCP tools are thoroughly tested at unit, integration, and E2E levels. Quality and verifiability are top priorities.

## Requirements

### Requirement: Unit Test Coverage

The system SHALL maintain ≥90% line coverage across the core library.

#### Scenario: Core library coverage

- GIVEN the core library source files in `src/core/`
- WHEN unit tests are run via `npm test`
- THEN line coverage SHALL be ≥90%
- AND branch coverage SHALL be ≥80%

#### Scenario: Isolated unit tests

- GIVEN any unit test
- THEN it SHALL NOT make real HTTP requests
- AND it SHALL NOT access the filesystem (except via mocked interfaces)
- AND it SHALL complete in <100ms

### Requirement: Unit Tests for Upload Strategies

Each upload strategy SHALL have comprehensive unit tests.

#### Scenario: Browser session strategy unit tests

- GIVEN the BrowserSessionStrategy class
- THEN tests SHALL cover:
  - Successful 3-step upload flow (policy → S3 → confirm)
  - CSRF token extraction from HTML
  - Expired session handling
  - Malformed HTML handling
  - Network timeout handling

#### Scenario: Release asset strategy unit tests

- GIVEN the ReleaseAssetStrategy class
- THEN tests SHALL cover:
  - Creating a new draft release
  - Reusing an existing release
  - Filename collision handling
  - Permission errors
  - API rate limiting

#### Scenario: Repository branch strategy unit tests

- GIVEN the RepoBranchStrategy class
- THEN tests SHALL cover:
  - Creating orphan branch
  - Committing to existing branch
  - URL generation using the GitHub raw URL format

#### Scenario: Cookie extraction strategy unit tests

- GIVEN the CookieExtractionStrategy class
- THEN tests SHALL cover:
  - Chrome cookie reading (mocked)
  - Firefox cookie reading (mocked)
  - No browser available scenario
  - Cross-platform path resolution

### Requirement: Integration Tests with HTTP Mocking

The system SHALL include integration tests using `msw` (Mock Service Worker) for HTTP interaction replay.

#### Scenario: Full upload flow with msw

- GIVEN recorded HTTP interaction fixtures
- WHEN the integration test runs an upload through the core library
- THEN msw SHALL intercept all HTTP requests
- AND the test SHALL verify the complete request/response sequence
- AND the final URL SHALL be returned correctly

#### Scenario: Fixture organization

- GIVEN HTTP fixtures
- THEN they SHALL be stored in `test/fixtures/` organized by strategy
- AND each fixture SHALL document what it tests in a comment header

#### Scenario: Error response replay

- GIVEN fixture files for error scenarios (401, 403, 422, 500)
- WHEN the integration test replays these
- THEN the appropriate error types SHALL be thrown with correct error codes

### Requirement: CLI Integration Tests

The system SHALL include CLI integration tests that test the full command pipeline.

#### Scenario: CLI help output

- GIVEN the compiled CLI binary
- WHEN `gh-attach --help` is executed
- THEN stdout SHALL contain the help text
- AND exit code SHALL be 0

#### Scenario: CLI upload with mocked backend

- GIVEN a mocked upload strategy injected via dependency injection
- WHEN `gh-attach upload ./test.png --target owner/repo#1 --format json` is executed
- THEN stdout SHALL contain valid JSON with url, markdown, and strategy fields

#### Scenario: CLI error formatting

- GIVEN a failing upload scenario
- WHEN the CLI runs
- THEN stderr SHALL contain a human-readable error message
- AND the exit code SHALL match the error type

### Requirement: MCP Server Integration Tests

The system SHALL include integration tests for the MCP server.

#### Scenario: MCP tool listing

- GIVEN the MCP server running in-process
- WHEN a `tools/list` request is sent
- THEN the response SHALL include `upload_image`, `check_auth`, and `list_strategies` tools

#### Scenario: MCP upload tool call

- GIVEN the MCP server with a mocked upload strategy
- WHEN a `tools/call` request for `upload_image` is sent
- THEN the response SHALL contain the upload result

### Requirement: E2E Tests

The system SHALL include E2E tests that run against real GitHub infrastructure.

#### Scenario: E2E test gating

- GIVEN the `E2E_TESTS` environment variable
- WHEN it is not set or set to `false`
- THEN E2E tests SHALL be skipped with a clear message

#### Scenario: Release asset E2E test

- GIVEN `GITHUB_TOKEN` and `E2E_TEST_REPO` environment variables
- WHEN the E2E test runs
- THEN it SHALL upload a small test image via the release-asset strategy
- AND verify the returned URL is accessible
- AND clean up the test asset afterward

#### Scenario: Repo branch E2E test

- GIVEN the same environment variables
- WHEN the E2E test runs
- THEN it SHALL upload via the repo-branch strategy
- AND verify the raw URL returns the image
- AND clean up the test branch/commit

#### Scenario: E2E test isolation

- GIVEN any E2E test
- THEN it SHALL use a dedicated test repository
- AND clean up all created resources (releases, branches, comments) after execution
- AND be safe to run in parallel

### Requirement: Test Organization

The system SHALL organize tests by type and module.

#### Scenario: Test directory structure

- GIVEN the project
- THEN test files SHALL be organized as:
  - `test/unit/` — unit tests (mirroring `src/` structure)
  - `test/integration/` — integration tests with HTTP mocking
  - `test/e2e/` — end-to-end tests
  - `test/fixtures/` — shared test fixtures and HTTP recordings

#### Scenario: Test naming convention

- GIVEN any test file
- THEN it SHALL be named `*.test.ts`
- AND describe blocks SHALL match the class/module under test

### Requirement: Test Scripts

The system SHALL provide convenient npm scripts for running tests.

#### Scenario: npm test scripts

- GIVEN the `package.json`
- THEN it SHALL define:
  - `test` — run all unit + integration tests
  - `test:unit` — run only unit tests
  - `test:integration` — run only integration tests
  - `test:e2e` — run E2E tests (requires env vars)
  - `test:coverage` — run tests with coverage report
  - `test:watch` — run tests in watch mode

### Requirement: Snapshot Testing for CLI Output

The system SHALL use snapshot tests for CLI help text and output formatting.

#### Scenario: Help text snapshots

- GIVEN the CLI help output
- WHEN the snapshot test runs
- THEN it SHALL compare against stored snapshots
- AND fail if the output has changed unexpectedly
