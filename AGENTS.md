## Build & Run

```bash
npm run build        # Build with tsup (ESM output to dist/)
npm run dev          # Build in watch mode
```

## Validation

```bash
npm test             # Run unit + integration tests (vitest)
npm run test:unit    # Unit tests only
npm run test:e2e     # E2E tests (needs E2E_TESTS=true + secrets)
npm run typecheck    # TypeScript strict mode check
npm run lint         # ESLint
npm run format:check # Prettier
```

## Project Structure

```
src/
  core/         # Upload strategies, types, validation
  cli/          # Commander.js CLI entry point
  mcp/          # MCP server (stdio + HTTP)
test/
  unit/         # Unit tests (mirrors src/ structure)
  integration/  # Integration tests with msw HTTP mocking
  e2e/          # End-to-end tests against real GitHub
  fixtures/     # Shared test fixtures
openspec/
  specs/        # Source-of-truth specifications
  changes/      # Active change proposals
```

## Conventions

- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, etc.)
- Strict TypeScript (no `any`)
- ESM-only output
- All public APIs have JSDoc comments
- Error hierarchy: GhAttachError → AuthenticationError | UploadError | ValidationError
