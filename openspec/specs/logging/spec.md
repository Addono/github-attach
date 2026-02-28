# Ralph Loop Logging Specification

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
