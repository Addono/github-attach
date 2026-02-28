# Ralph Loop CI Gating Specification

## Purpose

Define CI gating requirements for the Ralph Loop to ensure code quality is maintained across iterations. The loop should prevent feature work when CI is broken and prioritize fixes.

## Requirements

### Requirement: CI Status Tracking

The system SHALL track CI status throughout the loop lifecycle.

#### Scenario: CI health tracking

- GIVEN the end of each iteration
- WHEN all work is committed
- THEN the system SHALL execute a full CI check:
  - `npm run build` (must succeed)
  - `npm test` (must succeed with all tests passing)
  - `npm run lint` (must have zero errors, warnings are acceptable)
- AND store the result: `{ passed: boolean, buildStatus, testStatus, lintStatus, timestamp }`

#### Scenario: CI status persistence

- GIVEN a CI check completes
- THEN the result SHALL be persisted to `ralph-state.json` as:
  ```json
  {
    "ciStatus": {
      "passed": boolean,
      "lastCheck": ISO8601 timestamp,
      "buildStatus": "success" | "failed" | "skipped",
      "testStatus": "success" | "failed" | "skipped",
      "lintStatus": "success" | "warnings" | "failed" | "skipped",
      "buildError": "error message if failed",
      "testError": "error message if failed",
      "lintError": "error message if failed"
    }
  }
  ```

### Requirement: CI Gating Logic

The system SHALL gate feature work based on CI status.

#### Scenario: Green CI — proceed with feature work

- GIVEN the previous iteration left CI in a passing state
- WHEN the next iteration starts
- THEN the prompt SHALL include:
  - `[CI Status] ✅ All checks pass`
  - The agent SHALL be free to work on the highest-priority incomplete task from `IMPLEMENTATION_PLAN.md`

#### Scenario: Red CI — prioritize fixes

- GIVEN the previous iteration left CI in a failing state
- WHEN the next iteration starts
- THEN the prompt SHALL include:
  - `[CI Status] ❌ Build/Test/Lint failures detected`
  - Include the failure details (error messages, test names, lint errors)
  - Explicitly instruct: **"Do not work on new features. Instead, focus EXCLUSIVELY on fixing the failing CI."**
  - Reference which check failed and what output was produced

#### Scenario: Partial CI failure

- GIVEN only some CI checks fail (e.g., lint warnings + test pass)
- WHEN the next iteration starts
- THEN the agent MAY continue feature work
- BUT the prompt SHALL highlight the partial failure:
  - `[CI Status] ⚠️ Lint produced {N} warnings; build and tests pass`
  - Recommend addressing lint warnings before major commits

### Requirement: Fitness Impact

The system SHALL incorporate CI status into fitness scoring.

#### Scenario: CI failure penalty

- GIVEN a fitness evaluation occurs
- WHEN CI status is "failed"
- THEN `buildHealth` score SHALL be clamped to ≤ 30/100
- AND a note SHALL be added to the checklist: `"CI Failed: {failureType} — blocking feature work"`

#### Scenario: CI warning impact

- GIVEN a fitness evaluation occurs
- WHEN lint produced warnings (but build + tests pass)
- THEN `codeQuality` score SHALL incur a 10-point penalty per 5 unique warning types
- AND a note SHALL be added: `"Lint warnings reduce code quality score"`

### Requirement: CI Fix Tracking

The system SHALL track iterations spent fixing broken CI.

#### Scenario: Fix attempt tracking

- GIVEN CI is broken
- WHEN an iteration attempts to fix it
- THEN the state SHALL track:
  - `ciBrokenSince: number` (iteration number when CI first failed)
  - `ciFixAttempts: number` (count of iterations spent trying to fix it)
  - `ciLastFixAttempt: number` (most recent iteration that attempted a fix)

#### Scenario: Fix success notification

- GIVEN CI was previously broken
- WHEN the next CI check passes
- THEN the log SHALL include:
  - `[CI Recovery] Fixed after {N} iterations and {N} attempts`
  - The GitHub tracking issue comment SHALL celebrate the recovery:
    ```
    🎉 **CI Restored!**
    - Broken for 3 iterations
    - Fixed in iteration 15
    ```

### Requirement: GitHub Reporting

The system SHALL report CI status to GitHub with visibility.

#### Scenario: CI status in issue comment

- GIVEN a fitness evaluation completes
- WHEN posting the evaluation comment to GitHub
- THEN include a CI status badge:
  - `✅ CI: All checks pass` if passing
  - `❌ CI: Build/Test/Lint failed` if failing
  - `⚠️ CI: {N} lint warnings` if partial
- AND include a summary of failures if applicable

#### Scenario: CI failure blocking notification

- GIVEN CI is broken
- WHEN the next iteration starts
- THEN post a comment on the tracking issue:

  ```
  🚨 **CI BLOCKED at Iteration {N}**

  Current failure:
  {failureType}: {errorMessage (first 200 chars)}

  Next iteration will focus on fixing this before resuming feature work.
  ```

### Requirement: Lint Warning Accumulation

The system SHALL monitor and report lint warnings explicitly.

#### Scenario: Lint warning threshold

- GIVEN lint is run
- WHEN warnings exceed 20
- THEN the loop SHALL log a warning:
  - `[Lint Warning] Threshold exceeded: {count} > 20`
  - Recommend a future iteration to address them
- AND the code quality score SHALL be reduced proportionally

#### Scenario: Lint warning details

- GIVEN a CI check completes with lint warnings
- THEN capture and log:
  - Top 10 warning types by frequency
  - Files with most warnings
  - Recommendation for fixes
