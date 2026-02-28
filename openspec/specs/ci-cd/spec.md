# CI/CD Specification

## Purpose
Define the continuous integration, automated testing, semantic versioning, and release process for `gh-attach`.

## Requirements

### Requirement: CI Pipeline
The system SHALL run automated checks on every push and pull request.

#### Scenario: CI trigger
- GIVEN a push to `main` or any pull request
- WHEN CI is triggered
- THEN it SHALL run lint, typecheck, build, and test stages in order

#### Scenario: CI matrix
- GIVEN the CI pipeline
- THEN it SHALL test on:
  - Node.js 20 and 22
  - Ubuntu latest and macOS latest

#### Scenario: CI caching
- GIVEN npm dependencies
- THEN the CI SHALL cache `node_modules` by lockfile hash
- AND restore cache on subsequent runs

### Requirement: Lint Stage
The system SHALL enforce code quality via linting.

#### Scenario: ESLint check
- GIVEN the CI lint stage
- WHEN it runs
- THEN it SHALL execute `npm run lint`
- AND fail the build on any ESLint error

#### Scenario: Prettier check
- GIVEN the CI lint stage
- WHEN it runs
- THEN it SHALL execute `npm run format:check`
- AND fail if any file is not formatted

### Requirement: Type Check Stage
The system SHALL enforce TypeScript correctness.

#### Scenario: TypeScript strict mode
- GIVEN `tsconfig.json` with `strict: true`
- WHEN CI runs `npm run typecheck`
- THEN it SHALL fail on any type error

### Requirement: Build Stage
The system SHALL produce distributable artifacts.

#### Scenario: Build output
- GIVEN `npm run build`
- WHEN the build completes
- THEN it SHALL produce:
  - `dist/index.js` — library entry point (ESM)
  - `dist/cli.js` — CLI entry point with shebang
  - `dist/mcp.js` — MCP server entry point
- AND all `.d.ts` type declarations

### Requirement: Test Stage
The system SHALL run the full test suite in CI.

#### Scenario: Unit and integration tests
- GIVEN the CI test stage
- WHEN it runs `npm test`
- THEN it SHALL run all unit and integration tests
- AND upload coverage reports as artifacts

#### Scenario: E2E tests (conditional)
- GIVEN the CI pipeline on the `main` branch
- AND `E2E_TESTS` secret is configured
- WHEN E2E tests run
- THEN it SHALL execute `npm run test:e2e`
- AND use repository secrets for GitHub authentication

### Requirement: Conventional Commits
The system SHALL enforce conventional commit message format.

#### Scenario: Commit message validation
- GIVEN a pull request
- WHEN commits are checked
- THEN all commit messages SHALL follow the conventional commits specification
- AND the CI SHALL use `commitlint` to validate

#### Scenario: Commit types
- GIVEN a commit message
- THEN valid types SHALL include: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

### Requirement: Semantic Release
The system SHALL automate version bumps and releases.

#### Scenario: Patch release
- GIVEN one or more `fix:` commits on `main`
- WHEN the release workflow runs
- THEN it SHALL bump the patch version (e.g., 1.0.0 → 1.0.1)

#### Scenario: Minor release
- GIVEN one or more `feat:` commits on `main`
- WHEN the release workflow runs
- THEN it SHALL bump the minor version (e.g., 1.0.0 → 1.1.0)

#### Scenario: Major release (breaking change)
- GIVEN a commit with `BREAKING CHANGE:` footer or `!` after type
- WHEN the release workflow runs
- THEN it SHALL bump the major version (e.g., 1.0.0 → 2.0.0)

### Requirement: Release Artifacts
The system SHALL publish release artifacts.

#### Scenario: npm publish
- GIVEN a new version is released
- WHEN the release workflow completes
- THEN it SHALL publish the package to npm as `gh-attach`

#### Scenario: GitHub Release
- GIVEN a new version is released
- WHEN the release workflow completes
- THEN it SHALL create a GitHub Release with:
  - Auto-generated changelog from conventional commits
  - The compiled CLI binary as a release asset
  - Source maps

#### Scenario: gh extension release
- GIVEN the GitHub Release
- THEN it SHALL include platform-specific binaries (via `pkg` or `sea`)
- AND a manifest file compatible with `gh extension install`

### Requirement: Dependabot
The system SHALL keep dependencies up to date.

#### Scenario: Dependabot configuration
- GIVEN the repository
- THEN it SHALL include `.github/dependabot.yml`
- AND it SHALL check for npm dependency updates weekly
- AND check for GitHub Actions updates weekly

### Requirement: Branch Protection
The system SHALL document recommended branch protection rules.

#### Scenario: Main branch protection
- GIVEN the `main` branch
- THEN the README SHALL document that the following protections are recommended:
  - Require pull request reviews
  - Require status checks (lint, typecheck, build, test)
  - Require conventional commit messages
