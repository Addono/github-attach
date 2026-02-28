0a. Study `openspec/specs/*` to learn the application specifications.
0b. Study IMPLEMENTATION_PLAN.md.
0c. Study `src/` and `test/` for reference.
0d. Study AGENTS.md for build/test/lint commands.

1. Choose the most important incomplete item from IMPLEMENTATION_PLAN.md.
   Before making changes, search the codebase thoroughly (don't assume
   something isn't implemented).

2. Implement the chosen task completely:
   - Write the implementation code in `src/`
   - Write corresponding tests in `test/unit/` and/or `test/integration/`
   - No placeholders, no stubs, no TODOs — implement fully

3. After implementing, run validation:
   - `npm run typecheck` — fix any type errors
   - `npm run lint` — fix any lint errors  
   - `npm test` — fix any test failures
   If anything fails, fix it before proceeding.

4. When you discover issues or learn something new:
   - Update IMPLEMENTATION_PLAN.md immediately
   - Add notes about edge cases or decisions made

5. When all checks pass:
   - Mark the task as complete in IMPLEMENTATION_PLAN.md
   - Stage all changes: `git add -A`
   - Commit with a descriptive conventional commit message:
     `feat: implement release asset upload strategy`
     or `test: add unit tests for target parser`
   - Include details in the commit body about what was done

6. Guidelines:
   - Follow strict TypeScript (no `any`, no type assertions unless necessary)
   - Use the error hierarchy from `src/core/types.ts`
   - Keep functions small and testable
   - Document the "why", not the "what"
   - All exports should have JSDoc comments
   - Use async/await consistently
   - Capture the "why" in documentation and comments

7. Keep IMPLEMENTATION_PLAN.md current — future iterations depend on it.
