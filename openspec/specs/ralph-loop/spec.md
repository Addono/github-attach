# Ralph Loop Specification

## Purpose
Define the autonomous development loop that uses the GitHub Copilot SDK to implement `gh-attach` from OpenSpec specifications. The loop includes model rotation, fitness scoring, and historical tracking via GitHub Issues.

## Requirements

### Requirement: Ralph Loop Core
The system SHALL implement a Ralph Loop using the `@github/copilot-sdk` package.

#### Scenario: Loop execution
- GIVEN `PROMPT_plan.md` or `PROMPT_build.md` and the project files
- WHEN the loop runs
- THEN each iteration SHALL:
  1. Create a fresh Copilot session (isolated context)
  2. Read the prompt file
  3. Send the prompt and wait for completion (10-minute timeout)
  4. Destroy the session
  5. Log the iteration number and outcome

#### Scenario: Plan mode
- GIVEN `npx tsx ralph-loop.ts plan`
- WHEN the loop runs
- THEN it SHALL use `PROMPT_plan.md` as the prompt
- AND the agent SHALL perform gap analysis between specs and code
- AND update `IMPLEMENTATION_PLAN.md`

#### Scenario: Build mode
- GIVEN `npx tsx ralph-loop.ts build`
- WHEN the loop runs
- THEN it SHALL use `PROMPT_build.md` as the prompt
- AND the agent SHALL implement tasks from `IMPLEMENTATION_PLAN.md`
- AND run tests before committing

### Requirement: Model Rotation
The system SHALL rotate models after every evaluation cycle.

#### Scenario: Model pool
- GIVEN the available model pool
- THEN it SHALL include: `gpt-5.1-codex-mini`, `gpt-5.1-codex`, `gpt-4.1`, `claude-sonnet-4`, `claude-haiku-4.5`, `claude-sonnet-4.5`
- AND the pool SHALL be configurable via `ralph-config.json`

#### Scenario: Random model selection
- GIVEN a new evaluation cycle starts (after every N iterations)
- WHEN the next model is selected
- THEN it SHALL be chosen randomly from the pool (excluding the current model)
- AND the selection SHALL be logged to `ralph-loop.log`

#### Scenario: Model tracking
- GIVEN any iteration
- THEN the log SHALL record: `{ iteration, model, startTime, endTime, outcome }`

### Requirement: Fitness Scoring
The system SHALL evaluate the implementation against OpenSpec entries after every N iterations.

#### Scenario: Evaluation trigger
- GIVEN the evaluation interval N (default: 5)
- WHEN iteration count is a multiple of N
- THEN the system SHALL trigger a fitness evaluation

#### Scenario: Fitness evaluation process
- GIVEN a fitness evaluation is triggered
- THEN the system SHALL:
  1. Create a new Copilot session with a lightweight model (e.g., `claude-haiku-4.5`)
  2. Provide all OpenSpec specs from `openspec/specs/`
  3. Provide the current source code structure and key files
  4. Ask the model to score the implementation on a 0-100 scale across dimensions:
     - **Spec Compliance** (0-100): How well does the code match the specifications?
     - **Test Coverage** (0-100): Are tests present and passing?
     - **Code Quality** (0-100): Clean code, error handling, documentation?
     - **Build Health** (0-100): Does the project build and lint cleanly?
  5. Return an aggregate fitness score (weighted average)

#### Scenario: Fitness evaluation prompt
- GIVEN the evaluation session
- THEN the prompt SHALL include:
  - All spec files concatenated with section headers
  - The output of `npm test` (pass/fail + coverage)
  - The output of `npm run build` (success/failure)
  - The output of `npm run lint` (error count)
  - A request for structured JSON output: `{ specCompliance, testCoverage, codeQuality, buildHealth, aggregate, notes }`

### Requirement: GitHub Issue Reporting
The system SHALL post fitness scores to a dedicated GitHub Issue.

#### Scenario: Tracking issue creation
- GIVEN the first fitness evaluation
- WHEN no tracking issue exists
- THEN the system SHALL create a GitHub Issue titled `[Ralph Loop] Fitness Tracking`
- AND label it with `ralph-loop`, `automated`
- AND store the issue number in `ralph-state.json`

#### Scenario: Score posting
- GIVEN a completed fitness evaluation
- WHEN the score is ready
- THEN the system SHALL post a new comment on the tracking issue with:
  ```
  ## Fitness Evaluation — Iteration {n} — {model}

  | Dimension | Score |
  |-----------|-------|
  | Spec Compliance | {specCompliance}/100 |
  | Test Coverage | {testCoverage}/100 |
  | Code Quality | {codeQuality}/100 |
  | Build Health | {buildHealth}/100 |
  | **Aggregate** | **{aggregate}/100** |

  **Model**: {model}
  **Iterations since last eval**: {n}
  **Notes**: {notes}
  ```

#### Scenario: Issue description trend
- GIVEN multiple fitness evaluations have been posted
- WHEN a new evaluation completes
- THEN the system SHALL update the issue description (body) with:
  - An ASCII trend chart showing aggregate scores over time
  - A summary table of all evaluations with model, iteration, and scores
  - A model performance comparison (average score per model)

#### Scenario: Trend chart format
- GIVEN historical fitness scores
- THEN the trend chart SHALL use a text-based sparkline or ASCII bar chart
  ```
  Fitness Trend:
  Iter  5: ████████░░ 40/100 (gpt-5.1-codex-mini)
  Iter 10: ██████████░ 55/100 (claude-sonnet-4)
  Iter 15: ████████████░ 65/100 (gpt-4.1)
  Iter 20: ██████████████░ 72/100 (claude-haiku-4.5)
  ```

### Requirement: State Persistence
The system SHALL persist loop state to disk.

#### Scenario: State file
- GIVEN the ralph loop state
- THEN it SHALL be persisted to `ralph-state.json` containing:
  - `currentIteration: number`
  - `currentModel: string`
  - `trackingIssueNumber: number | null`
  - `evaluations: Array<{ iteration, model, scores, timestamp }>`

#### Scenario: Resume after crash
- GIVEN `ralph-state.json` exists
- WHEN the loop restarts
- THEN it SHALL resume from the last recorded iteration
- AND use the next model in rotation

### Requirement: Loop Configuration
The system SHALL support configuration via `ralph-config.json`.

#### Scenario: Configuration options
- GIVEN `ralph-config.json`
- THEN it SHALL support:
  - `maxIterations: number` (default: 50)
  - `evaluationInterval: number` (default: 5)
  - `models: string[]` (model pool)
  - `evaluationModel: string` (model for fitness scoring)
  - `trackingRepo: string` (owner/repo for the tracking issue)
  - `timeout: number` (per-iteration timeout in ms, default: 600000)

### Requirement: PROMPT Files
The system SHALL include well-crafted prompt files.

#### Scenario: PROMPT_plan.md contents
- GIVEN the planning prompt
- THEN it SHALL instruct the agent to:
  1. Study all specs in `openspec/specs/`
  2. Study existing code in `src/`
  3. Study `IMPLEMENTATION_PLAN.md` if it exists
  4. Perform gap analysis
  5. Create/update `IMPLEMENTATION_PLAN.md` with prioritized tasks
  6. NOT implement anything

#### Scenario: PROMPT_build.md contents
- GIVEN the building prompt
- THEN it SHALL instruct the agent to:
  1. Study specs and existing code
  2. Read `IMPLEMENTATION_PLAN.md`
  3. Pick the highest-priority incomplete task
  4. Implement it fully (no stubs/placeholders)
  5. Run tests and fix failures
  6. Update `IMPLEMENTATION_PLAN.md`
  7. Commit with a descriptive conventional commit message

### Requirement: AGENTS.md
The system SHALL include a concise AGENTS.md file.

#### Scenario: AGENTS.md contents
- GIVEN the operational guide
- THEN it SHALL be ≤60 lines
- AND contain:
  - Build command: `npm run build`
  - Test command: `npm test`
  - Typecheck: `npx tsc --noEmit`
  - Lint: `npm run lint`
  - Project structure overview
  - Key conventions (conventional commits, strict TypeScript)

### Requirement: Graceful Shutdown
The system SHALL handle interruptions gracefully.

#### Scenario: SIGINT handling
- GIVEN the loop is running
- WHEN SIGINT (Ctrl+C) is received
- THEN the system SHALL:
  1. Complete the current iteration if possible (5-second grace period)
  2. Save state to `ralph-state.json`
  3. Exit cleanly

#### Scenario: Iteration timeout
- GIVEN an iteration exceeds the configured timeout
- WHEN the timeout fires
- THEN the session SHALL be destroyed
- AND the loop SHALL continue to the next iteration
- AND log the timeout event
