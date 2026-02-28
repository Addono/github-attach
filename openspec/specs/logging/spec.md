# Ralph Loop Logging Specification

## Purpose

Define detailed logging requirements for the Ralph Loop to give a human observer clear, real-time visibility into what the model is doing, what scores were achieved, and what the loop intends to work on next.

## Requirements

### Requirement: Structured Log Format

Every log line SHALL carry a timestamp and a severity/category level.

#### Scenario: Log line format

- GIVEN any log call
- THEN the line SHALL conform to:
  ```
  [{ISO8601}] [{LEVEL}] {MESSAGE}
  ```
  where `LEVEL` ∈ `INFO | DEBUG | WARN | ERROR | EVAL | GITHUB | ITER | MODEL`

#### Scenario: Multiline messages

- GIVEN a message that contains embedded newlines
- THEN the first line SHALL use the standard format
- AND every continuation line SHALL be prefixed with ` |` so `tail -f` stays readable:
  ```
  [2026-02-28T11:45:00.000Z] [EVAL] Scores: aggregate=75/100 (+3 vs prev)
    | spec=72/100  tests=78/100  quality=70/100  build=88/100
    | notes: Build and tests pass; lint warnings remain.
  ```

### Requirement: Session and Resume Logging

The system SHALL log startup context so an observer knows where the loop is in its lifecycle.

#### Scenario: Fresh start

- GIVEN no prior state exists
- WHEN the loop starts
- THEN the log SHALL include `[INFO]`:
  - `Starting Ralph Loop: mode={mode}, max={maxIterations}`
  - `Model pool (regular): {models}`
  - `Model pool (premium): {premiumModels}`
  - `Initial model selected: {model}`

#### Scenario: Resume from state file

- GIVEN `ralph-state.json` exists with prior iterations
- WHEN the loop starts
- THEN the log SHALL include:
  - `[INFO] Resuming from iteration {n} (model: {model}, {count} prior evaluations)`
  - `[INFO] Last evaluation: iteration {n}, aggregate={score}/100 — {notes}`

### Requirement: Iteration Boundary Logging

Each iteration SHALL be clearly delimited in the log so the observer can see work units.

#### Scenario: Iteration start

- GIVEN iteration N begins
- THEN the log SHALL include one `[ITER]` line:

  ```
  === Iteration {N} | Model: {model} | Last score: {aggregate}/100 ===
  ```

  - `Last score` is omitted if no evaluation has run yet

- AND if the last evaluation had a lowest-scoring checklist item, log:
  ```
  [ITER] Target this iteration: [{score}/100] {requirement}
  ```

#### Scenario: Iteration completion

- GIVEN iteration N ends
- THEN the log SHALL include one `[ITER]` line with:
  - Elapsed time in seconds
  - A tool-count summary, e.g.: `view×14, bash×8, edit×5`
  - Example: `Iteration 11 complete in 94s | Tools used: view×14, bash×8, edit×5`

### Requirement: Tool Execution Logging

The system SHALL log each tool invocation with enough context for the observer to understand what the agent is doing.

#### Scenario: Tool start event

- GIVEN `tool.execution_start` is emitted by the Copilot SDK
- THEN the system SHALL log `[DEBUG]` with a human-readable description extracted from `arguments`:
  - `view` / `read_file`: `⚙ view — src/core/upload.ts L10–50`
  - `bash` / `shell`: `⚙ bash — npm test 2>&1 | tail -40`
  - `grep` / `rg`: `⚙ grep — "AuthenticationError" in src/`
  - `edit` / `create` / `replace_string_in_file`: `⚙ edit — src/cli/index.ts (add login command)`
  - `report_intent`: `⚙ report_intent — Implementing the release-asset upload strategy`
  - `sql` / `db_query`: `⚙ sql — SELECT * FROM sessions WHERE ...`
  - `glob` / `list_dir`: `⚙ glob — src/**/*.ts`
  - Other tools: best-effort extraction of first meaningful string field
- Input SHALL be capped at 200 characters per line

#### Scenario: Tool progress event

- GIVEN `tool.execution_progress` is emitted
- WHEN `progressMessage` is non-empty
- THEN log `[DEBUG]`:
  ```
    ↳ {progressMessage}
  ```

#### Scenario: Tool completion event

- GIVEN `tool.execution_complete` is emitted
- WHEN `success=false`
- THEN log `[WARN]`:
  ```
    ✗ tool failed: {first 200 chars of result.content}
  ```
- WHEN `success=true` and result content is non-trivial
- THEN log `[DEBUG]`:
  ```
    ✓ {line count} lines — {first line of output}
  ```
  or for short results: the full output on one line

#### Scenario: Tool call aggregation

- GIVEN an iteration has completed
- THEN the per-iteration summary SHALL include how many times each tool was invoked
- AND tools with 0 calls SHALL be omitted from the summary

### Requirement: Fitness Evaluation Logging

The system SHALL log evaluation progress and results in a way that makes the score trajectory immediately visible.

#### Scenario: Evaluation start

- GIVEN a fitness evaluation is triggered
- THEN log `[EVAL] Starting fitness check at iteration {n}`

#### Scenario: Evaluation score summary

- GIVEN an evaluation response is parsed
- THEN log `[EVAL]` multiline with:
  - `Scores: aggregate={n}/100 ({+/-delta} vs prev)` on the first line
  - Dimension breakdown on the continuation lines
  - `notes: {text}` on a continuation line

#### Scenario: Lowest-score spotlight

- GIVEN an evaluation completes with a checklist
- THEN log `[EVAL]` multiline:
  ```
  Lowest scores:
    [{score}/100] {requirement}
    [{score}/100] {requirement}
    [{score}/100] {requirement}
  ```
  (top 3 worst items, to tell the observer what will be targeted next)

#### Scenario: Evaluation parse error

- GIVEN the model returns a response from which no JSON can be extracted
- THEN log `[WARN] Fitness evaluation: could not extract JSON from response (len={n})`

### Requirement: Model Rotation Logging

The system SHALL log model selection decisions at the `[MODEL]` level.

#### Scenario: Stall detected

- GIVEN stall detection fires
- THEN log `[MODEL]`:
  ```
  Stall detected (Δ{delta} < {threshold} over {window} evals) → escalating to premium: {model}
  ```

#### Scenario: Normal rotation

- GIVEN model rotation happens after an evaluation
- WHEN the new model differs from the old one
- THEN log `[MODEL] Model rotation: {oldModel} → {newModel}`

#### Scenario: Initial selection

- GIVEN the loop starts fresh
- THEN log `[MODEL] Initial model selected: {model}`

### Requirement: GitHub Reporting Logs

The system SHALL log GitHub API interactions at the `[GITHUB]` level.

#### Scenario: Issue creation

- GIVEN the tracking issue is created for the first time
- THEN log `[GITHUB] Created tracking issue #{issueNumber}`

#### Scenario: Comment posted

- GIVEN an evaluation comment is successfully posted
- THEN log `[GITHUB] Posted evaluation comment to issue #{issueNumber} ({N} checklist items)`

#### Scenario: GitHub error

- GIVEN any GitHub API call fails
- THEN log `[ERROR] Failed to post to GitHub: {message}`

#### Scenario: Retry attempt

- GIVEN `ghExecWithRetry` is about to retry
- THEN log `[WARN] gh command failed (attempt {n}/{max}), retrying in {delay}ms…`

### Requirement: Error and Warning Logging

Critical failures SHALL be immediately visible in the log stream.

#### Scenario: Iteration error

- GIVEN an exception occurs during a session
- THEN log `[ERROR] Iteration {N} error: {message}`

#### Scenario: Fitness evaluation error

- GIVEN an exception occurs during evaluation
- THEN log `[ERROR] Fitness evaluation error: {message}`

#### Scenario: Git push failure

- GIVEN `git push` fails
- THEN log `[WARN] Git push skipped/failed (non-fatal): {message}`
- The loop SHALL continue regardless (non-fatal)

#### Scenario: No tracking repo configured

- GIVEN `trackingRepo` is empty in config
- THEN log `[WARN] No trackingRepo configured, skipping GitHub posting`

### Requirement: Log Level Filtering

The system MAY support filtering logs by level.

#### Scenario: DEBUG suppression

- GIVEN `ralph-config.json` does not set `logLevel`
- THEN `[DEBUG]` lines (individual tool invocations) SHALL still be emitted by default
- AND the per-iteration tool-count summary SHALL always appear regardless of level

#### Scenario: Quiet mode

- GIVEN the environment variable `RALPH_QUIET=1` is set
- THEN `[DEBUG]` lines SHALL be suppressed
- AND all other levels SHALL remain visible

## Purpose

Define detailed logging requirements for the Ralph Loop to enable real-time observability of model decision-making and tool execution.

## Requirements

### Requirement: Session Context Logging

The system SHALL log session context at the start of each iteration.

#### Scenario: Iteration start logging

- GIVEN a new iteration begins
- WHEN the session is created
- THEN the system SHALL log:
  - `[Iteration N] Starting with model: {model}`
  - `[Iteration N] Prompt source: {promptFile}`
  - `[Iteration N] Session ID: {sessionId}`
  - The current state: `{ currentIteration, evaluations.length, trackingIssueNumber }`

### Requirement: Tool Execution Logging

The system SHALL log detailed information about each tool invocation.

#### Scenario: Tool start event

- GIVEN a tool execution starts
- WHEN `tool.execution_start` event is emitted
- THEN the system SHALL log:
  - Tool name and category (e.g., `⚙ view (read)` instead of just `⚙ view`)
  - Tool description or purpose context if available

#### Scenario: Tool result event

- GIVEN a tool execution completes
- WHEN `tool.execution_result` event is emitted
- THEN the system SHALL log:
  - Tool name, execution time (ms), and result status (success/failure/error)
  - For failures: a brief summary of the error (first 100 chars)
  - For reads: `{ bytesRead, lineCount }` or similar
  - For writes: `{ filesModified, linesChanged }`

#### Scenario: Tool result sampling

- GIVEN a tool produces large output
- WHEN the result exceeds 500 characters
- THEN the system SHALL log only the first and last 200 characters
- AND annotate with `[... {n} chars omitted ...]`

### Requirement: Model Reasoning Logging

The system SHALL capture model intent and decision points.

#### Scenario: Intent change log

- GIVEN the model switches tasks or goals
- WHEN a significant intent change is detected (e.g., "reading X" → "implementing Y")
- THEN the system SHALL log:
  - `[Intent] Previous: {previousIntent}`
  - `[Intent] New: {newIntent}`
  - Confidence or reasoning if available

#### Scenario: Decision explanation

- GIVEN the model makes a noteworthy decision
- WHEN relevant context is available
- THEN the system SHALL log:
  - `[Decision] {what}: {why}` (e.g., `[Decision] Skip test run: coverage already 95%`)

### Requirement: Evaluation Logging

The system SHALL log fitness evaluation progress and results.

#### Scenario: Evaluation start

- GIVEN a fitness evaluation begins
- THEN the system SHALL log:
  - `[Evaluation] Starting fitness check at iteration {n}`
  - Commands that will be run: build, test, lint

#### Scenario: Evaluation result

- GIVEN an evaluation completes
- THEN the system SHALL log:
  - `[Evaluation] Build: {status}` (e.g., "success" or "failed with 3 errors")
  - `[Evaluation] Tests: {count} pass, {count} fail, coverage {n}%`
  - `[Evaluation] Lint: {count} errors, {count} warnings`
  - `[Evaluation] Scores: spec={n}/100, tests={n}/100, quality={n}/100, build={n}/100, aggregate={n}/100`

#### Scenario: GitHub posting log

- GIVEN results are posted to GitHub
- THEN the system SHALL log:
  - `[GitHub] Creating/updating issue #{issueNumber}`
  - `[GitHub] Comment posted with {checklistItemCount} checklist items`
  - `[GitHub] Issue updated with trend chart`

### Requirement: Model Rotation Logging

The system SHALL log model selection decisions.

#### Scenario: Stall detection

- GIVEN stall detection fires
- WHEN the last N evaluations show minimal improvement
- THEN the system SHALL log:
  - `[Stall Detected] Last {stallWindow} evals: best={score}, worst={score}, delta={score}`
  - `[Model Escalation] Switching from {currentModel} to {newModel} (premium)`

#### Scenario: Model rotation

- GIVEN an evaluation cycle completes
- WHEN the next model is selected
- THEN the system SHALL log:
  - `[Model Rotation] {oldModel} → {newModel}`
  - Reason: `(random selection | premium escalation | recovery attempt)`

### Requirement: Error and Warning Logging

The system SHALL log all errors and warnings prominently.

#### Scenario: Session error

- GIVEN an error occurs during a session
- THEN the system SHALL log:
  - `[ERROR] {location}: {message}`
  - Full stack trace (first 500 chars) if available

#### Scenario: GitHub API error

- GIVEN a GitHub API call fails
- THEN the system SHALL log:
  - `[GitHub Error] {endpoint}: {status} {message}`
  - Retry attempt number if applicable
  - `[GitHub Retry] Attempt {n}/{maxAttempts} after {delayMs}ms`

#### Scenario: Timeout warning

- GIVEN an operation approaches or exceeds timeout
- THEN the system SHALL log:
  - `[Timeout] {operation} exceeded {timeoutMs}ms`

### Requirement: State Persistence Logging

The system SHALL log state changes.

#### Scenario: State save

- GIVEN state is persisted to disk
- THEN the system SHALL log:
  - `[State] Saved at iteration {n}: {checksumOrSize}`

#### Scenario: State resume

- GIVEN the loop resumes from a crash
- THEN the system SHALL log:
  - `[Resume] State file found: last iteration was {n}, last model was {model}`
  - `[Resume] {evaluationCount} prior evaluations in history`

### Requirement: Log Format and Structure

The system SHALL use a consistent, parseable log format.

#### Scenario: Log line format

- GIVEN each log line
- THEN it SHALL conform to:
  - `[{ISO8601_TIMESTAMP}] [{LEVEL}] {MESSAGE}`
  - Where `LEVEL` ∈ `{INFO, DEBUG, WARN, ERROR, STALL, DECISION, INTENT, GITHUB, EVAL}`
  - Example: `[2026-02-28T11:45:00.000Z] [INTENT] Switching from planning to implementation`

#### Scenario: Multiline output

- GIVEN a log message contains multiple lines
- THEN the system SHALL format as:
  - First line: same as above
  - Subsequent lines: indented with `  |` to preserve readability in `tail -f`
  - Example:
    ```
    [2026-02-28T11:45:00.000Z] [ERROR] Build failed
      | npm ERR! code ERESOLVE
      | npm ERR! ERESOLVE unable to resolve dependency tree
    ```

### Requirement: Log Filtering and Control

The system SHALL support log level configuration.

#### Scenario: Log level configuration

- GIVEN the `ralph-config.json` file
- THEN it MAY include:
  - `logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"` (default: "INFO")
  - When `logLevel="INFO"`: skip `[DEBUG]` entries
  - When `logLevel="ERROR"`: only show errors and critical state changes

#### Scenario: Quiet mode

- GIVEN an environment variable `RALPH_QUIET=1`
- THEN the system SHALL suppress tool execution logs
- AND only log: model changes, evaluations, GitHub posts, errors
