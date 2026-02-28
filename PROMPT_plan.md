0a. Study `openspec/specs/*` to learn the application specifications.
0b. Study IMPLEMENTATION_PLAN.md (if present) to understand the plan so far.
0c. Study `src/` to understand existing code and shared utilities.

1. Compare specs against code (gap analysis). Create or update
   IMPLEMENTATION_PLAN.md as a prioritized bullet-point list of tasks
   yet to be implemented. Do NOT implement anything.

2. For each task in the plan, note:
   - Which spec requirement it addresses
   - What files need to be created or modified
   - What tests need to be written
   - Any dependencies on other tasks

IMPORTANT: Do NOT assume functionality is missing — search the
codebase first to confirm. Prefer updating existing utilities over
creating ad-hoc copies. Study test/ directory to understand what's
already tested.

3. Prioritize tasks in this order:
   a. Core types and error classes (foundation)
   b. File validation and target parsing (shared utilities)
   c. Upload strategies (one at a time, starting with release-asset as it uses official APIs)
   d. CLI commands
   e. MCP server
   f. CI/CD and release configuration
   g. Documentation

4. Each task should be small enough to implement and test in a single iteration.
