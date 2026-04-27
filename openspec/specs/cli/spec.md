# CLI Specification

## Purpose

The `gh-attach` CLI provides a command-line interface for uploading images to GitHub issues, PRs, and comments. It works both as a standalone tool and as a `gh` CLI extension.

## Requirements

### Requirement: CLI Entry Point

The system SHALL provide a CLI executable named `gh-attach`.

#### Scenario: Standalone invocation

- GIVEN the package is installed globally via `npm install -g gh-attach`
- WHEN the user runs `gh-attach --version`
- THEN it SHALL print the version number and exit with code 0

#### Scenario: gh extension invocation

- GIVEN the tool is installed via `gh extension install`
- WHEN the user runs `gh attach --version`
- THEN it SHALL behave identically to standalone mode

#### Scenario: No arguments

- GIVEN no subcommand is provided
- WHEN the user runs `gh-attach`
- THEN it SHALL display the help text and exit with code 0

### Requirement: Upload Command

The system SHALL provide an `upload` command as the primary action.

#### Scenario: Basic image upload

- GIVEN a valid session and a file path
- WHEN the user runs `gh-attach upload ./screenshot.png --target owner/repo#42`
- THEN it SHALL upload the image and print the markdown embed to stdout
- AND exit with code 0

#### Scenario: Upload with explicit strategy

- GIVEN the user specifies a strategy
- WHEN the user runs `gh-attach upload ./img.png --target #42 --strategy release-asset`
- THEN it SHALL use only the specified strategy

#### Scenario: Upload to current repo issue

- GIVEN the user is in a git repo with a GitHub remote
- WHEN the user runs `gh-attach upload ./img.png --target #42`
- THEN it SHALL infer the owner/repo from the git remote

#### Scenario: Upload with URL output

- GIVEN the `--format url` flag
- WHEN the upload completes
- THEN it SHALL print only the raw URL (no markdown wrapping)

#### Scenario: Upload with markdown output (default)

- GIVEN no `--format` flag or `--format markdown`
- WHEN the upload completes
- THEN it SHALL print `![filename](url)` to stdout

#### Scenario: Upload with JSON output

- GIVEN the `--format json` flag
- WHEN the upload completes
- THEN it SHALL print `{ "url": "...", "markdown": "...", "strategy": "..." }` to stdout

#### Scenario: Multiple files

- GIVEN multiple file paths
- WHEN the user runs `gh-attach upload ./a.png ./b.png --target #42`
- THEN it SHALL upload each file sequentially
- AND print each result on a separate line

#### Scenario: Pipe/stdin support

- GIVEN image data piped via stdin
- WHEN the user runs `cat screenshot.png | gh-attach upload --target #42 --stdin --filename screenshot.png`
- THEN it SHALL read the image from stdin and upload it

#### Scenario: Upload failure

- GIVEN an upload that fails
- WHEN the error occurs
- THEN it SHALL print the error message to stderr
- AND exit with a non-zero exit code (1 for general errors, 2 for auth errors)

### Requirement: Login Command

The system SHALL provide a `login` command for interactive authentication.

#### Scenario: Interactive browser login

- GIVEN no existing session
- WHEN the user runs `gh-attach login`
- THEN it SHALL open a browser window to GitHub
- AND wait for the user to authenticate
- AND save the session cookies to the configured state file
- AND print a success message

#### Scenario: Login with custom state path

- GIVEN the `--state-path` flag
- WHEN the user runs `gh-attach login --state-path ~/.gh-attach/session.json`
- THEN it SHALL save the session to the specified path

#### Scenario: Login status check

- GIVEN an existing session
- WHEN the user runs `gh-attach login --status`
- THEN it SHALL check if the session is still valid
- AND print the status (valid/expired) and the authenticated username

### Requirement: Config Command

The system SHALL provide a `config` command for managing settings.

#### Scenario: View config (no arguments)

- GIVEN an existing config
- WHEN the user runs `gh-attach config` (no action argument)
- THEN it SHALL print all configuration key-value pairs
- AND behave identically to `gh-attach config list`

#### Scenario: View config

- GIVEN an existing config
- WHEN the user runs `gh-attach config list`
- THEN it SHALL print all configuration key-value pairs

#### Scenario: Set strategy order

- WHEN the user runs `gh-attach config set strategy-order "release-asset,browser-session"`
- THEN it SHALL update the strategy preference order

#### Scenario: Set default target

- WHEN the user runs `gh-attach config set default-target owner/repo`
- THEN it SHALL set the default target repository for uploads

#### Scenario: Config file location

- GIVEN the config file
- THEN it SHALL be stored at `~/.config/gh-attach/config.json` (XDG compliant)
- AND be overridable via `GH_ATTACH_CONFIG` environment variable

### Requirement: Global CLI Options

The system SHALL support standard global options.

#### Scenario: Verbose output

- GIVEN the `--verbose` or `-v` flag
- WHEN any command is run
- THEN it SHALL print debug information to stderr (strategy selection, HTTP requests, timing)

#### Scenario: Quiet mode

- GIVEN the `--quiet` or `-q` flag
- WHEN any command is run
- THEN it SHALL suppress all output except the final result or errors

#### Scenario: No color

- GIVEN the `--no-color` flag or `NO_COLOR` environment variable
- WHEN any command produces output
- THEN it SHALL omit ANSI color codes

#### Scenario: Help flag

- GIVEN `--help` or `-h` on any command
- WHEN the user invokes it
- THEN it SHALL print command-specific help and exit with code 0

### Requirement: Exit Codes

The system SHALL use structured exit codes.

#### Scenario: Exit code mapping

- GIVEN any CLI execution
- THEN exit code 0 SHALL indicate success
- AND exit code 1 SHALL indicate a general error
- AND exit code 2 SHALL indicate an authentication error
- AND exit code 3 SHALL indicate a validation error (bad input)
- AND exit code 4 SHALL indicate a network/upload error

### Requirement: gh Extension Compatibility

The system SHALL be distributable as a `gh` CLI extension.

#### Scenario: Extension manifest

- GIVEN the repository
- THEN it SHALL include a `gh-extension` binary entry point
- AND the repository name SHALL be `gh-attach` (matching `gh` extension convention)

#### Scenario: Extension installation

- GIVEN the user runs `gh extension install owner/gh-attach`
- THEN the tool SHALL be usable as `gh attach upload ...`

### Requirement: Environment Variables

The system SHALL support configuration via environment variables.

#### Scenario: GitHub token

- GIVEN `GITHUB_TOKEN` or `GH_TOKEN` environment variable
- WHEN the release-asset or repo-branch strategy is used
- THEN it SHALL use the token for authentication

#### Scenario: GitHub CLI token fallback

- GIVEN neither `GITHUB_TOKEN` nor `GH_TOKEN` is set
- AND the user has authenticated via the GitHub CLI (`gh auth login`)
- WHEN the release-asset or repo-branch strategy is used (whether selected explicitly via `--strategy` or chosen from the default order)
- THEN the system SHALL fall back to the token returned by `gh auth token`, preferring an account that can access the target repository
- AND it SHALL only emit `Strategy '<name>' is not available` when neither an environment token nor a usable GitHub CLI token can be resolved

#### Scenario: State path override

- GIVEN `GH_ATTACH_STATE_PATH` environment variable
- THEN it SHALL override the default session state file location

#### Scenario: Strategy override

- GIVEN `GH_ATTACH_STRATEGY` environment variable
- THEN it SHALL override the default strategy selection

### Requirement: Docker CLI Usage

The system SHALL be usable as a CLI tool via Docker container.

#### Scenario: Docker upload with token

- GIVEN the Docker image `ghcr.io/addono/gh-attach`
- WHEN a user runs:
  ```
  docker run -e GITHUB_TOKEN=ghp_xxx -v $(pwd):/workspace ghcr.io/addono/gh-attach upload /workspace/screenshot.png --target owner/repo#42
  ```
- THEN it SHALL upload the image and print the markdown embed to stdout

#### Scenario: Docker upload with stdin

- GIVEN the Docker image
- WHEN a user runs:
  ```
  cat screenshot.png | docker run -i -e GITHUB_TOKEN=ghp_xxx ghcr.io/addono/gh-attach upload --target owner/repo#42 --stdin --filename screenshot.png
  ```
- THEN it SHALL read from stdin and upload the image
