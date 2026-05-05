# Core Upload Library Specification

## Purpose

The core library provides a strategy-based image upload engine for GitHub. It abstracts four distinct upload mechanisms behind a unified interface, handling authentication, file validation, upload execution, and URL generation.

## Requirements

### Requirement: Strategy Interface

The system SHALL define a common `UploadStrategy` interface that all upload strategies implement.

#### Scenario: Strategy contract

- GIVEN any upload strategy implementation
- WHEN the strategy is instantiated
- THEN it SHALL expose `name: string`, `upload(file, target): Promise<UploadResult>`, and `isAvailable(): Promise<boolean>` methods
- AND `UploadResult` SHALL contain `{ url: string; markdown: string; strategy: string }`

### Requirement: Browser Session Strategy

The system SHALL support uploading images via GitHub's undocumented browser upload flow.

#### Scenario: Successful upload with saved session

- GIVEN a valid saved browser session (cookies)
- AND a target issue/PR URL
- WHEN `upload(file, target)` is called
- THEN the system SHALL POST to `/upload/policies/assets` with CSRF token and repository ID
- AND upload the file to the returned S3 URL using the form fields
- AND confirm the upload via PUT to the asset upload URL
- AND return the `user-images.githubusercontent.com` URL

#### Scenario: Expired session

- GIVEN an expired or invalid browser session
- WHEN `upload(file, target)` is called
- THEN the system SHALL throw an `AuthenticationError` with message indicating session renewal is needed
- AND the error SHALL include `code: 'SESSION_EXPIRED'`

#### Scenario: CSRF token extraction failure

- GIVEN a valid session but an unexpected HTML structure
- WHEN the system attempts to extract the CSRF token
- THEN it SHALL throw a `UploadError` with `code: 'CSRF_EXTRACTION_FAILED'`
- AND include the HTTP status code and a truncated response body in the error details

### Requirement: Cookie Extraction Strategy

The system SHALL support extracting GitHub session cookies from locally installed browsers.

#### Scenario: Chrome cookie extraction

- GIVEN Chrome is installed with a GitHub session
- WHEN `isAvailable()` is called
- THEN it SHALL return `true`
- AND `upload()` SHALL extract cookies from Chrome's cookie store
- AND proceed with the browser upload flow

#### Scenario: Firefox cookie extraction

- GIVEN Firefox is installed with a GitHub session
- WHEN `isAvailable()` is called
- THEN it SHALL return `true`
- AND `upload()` SHALL extract cookies from Firefox's cookie store

#### Scenario: No browser sessions available

- GIVEN no supported browser has GitHub cookies
- WHEN `isAvailable()` is called
- THEN it SHALL return `false`

### Requirement: Release Asset Strategy

The system SHALL support uploading images as GitHub release assets via the official REST API.

#### Scenario: First upload to repository

- GIVEN a valid GitHub API token with `contents:write` permission
- AND no existing image-assets release in the target repository
- WHEN `upload(file, target)` is called
- THEN the system SHALL create a prerelease (non-draft) tagged `_gh-attach-assets`
- AND the release SHALL have the title `"gh-attach image assets"`
- AND the release SHALL have a body explaining it is a dummy release used by gh-attach as storage for image assets, and that it should not be deleted
- AND upload the image as a release asset
- AND return the asset download URL

#### Scenario: Subsequent upload to existing release

- GIVEN an existing `_gh-attach-assets` prerelease
- WHEN `upload(file, target)` is called
- THEN the system SHALL reuse the existing release
- AND upload the image as an additional asset
- AND handle filename collisions by appending a hash suffix

#### Scenario: Insufficient permissions

- GIVEN a token without `contents:write` permission
- WHEN `upload(file, target)` is called
- THEN the system SHALL throw `AuthenticationError` with `code: 'INSUFFICIENT_PERMISSIONS'`

### Requirement: Repository Branch Strategy

The system SHALL support committing images to a dedicated orphan branch.

#### Scenario: First upload with no assets branch

- GIVEN a valid GitHub API token with `contents:write` permission
- AND no existing `gh-attach-assets` branch
- WHEN `upload(file, target)` is called
- THEN the system SHALL create an orphan branch `gh-attach-assets`
- AND commit the image file to a unique path on that branch
- AND return the GitHub raw URL rooted at `refs/heads/gh-attach-assets`

#### Scenario: Subsequent upload

- GIVEN an existing `gh-attach-assets` branch
- WHEN `upload(file, target)` is called
- THEN the system SHALL commit the image to a new unique path on the existing branch
- AND return the GitHub raw URL for that branch path

### Requirement: Strategy Selection and Fallback

The system SHALL support automatic strategy selection with configurable fallback order.

#### Scenario: Automatic strategy selection

- GIVEN a configured strategy preference order (default: `[browser-session, cookie-extraction, release-asset, repo-branch]`)
- WHEN `upload()` is called without specifying a strategy
- THEN the system SHALL try each strategy in order via `isAvailable()`
- AND return the first strategy that uploads successfully

#### Scenario: Fallback after upload failure

- GIVEN multiple strategies are configured
- AND an earlier strategy is available but fails with an `AuthenticationError` or `UploadError`
- WHEN `upload()` is called
- THEN the system SHALL continue to the next configured strategy
- AND only fail after every available strategy has been exhausted

#### Scenario: Explicit strategy selection

- GIVEN the user specifies `--strategy release-asset`
- WHEN `upload()` is called
- THEN the system SHALL use only the specified strategy
- AND throw if that strategy is not available

#### Scenario: All strategies unavailable

- GIVEN no strategies are available
- WHEN `upload()` is called
- THEN the system SHALL throw `NoStrategyAvailableError` listing what was tried and why each failed

### Requirement: File Validation

The system SHALL validate files before attempting upload.

#### Scenario: Supported image format

- GIVEN a file with extension `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, or `.webp`
- WHEN the file is validated
- THEN validation SHALL pass

#### Scenario: Unsupported file format

- GIVEN a file with an unsupported extension
- WHEN the file is validated
- THEN the system SHALL throw `ValidationError` with `code: 'UNSUPPORTED_FORMAT'`

#### Scenario: File too large

- GIVEN a file larger than 10MB (GitHub's limit for images)
- WHEN the file is validated
- THEN the system SHALL throw `ValidationError` with `code: 'FILE_TOO_LARGE'`

#### Scenario: File does not exist

- GIVEN a file path that does not exist
- WHEN the file is validated
- THEN the system SHALL throw `ValidationError` with `code: 'FILE_NOT_FOUND'`

### Requirement: Target Parsing

The system SHALL parse GitHub issue/PR/comment URLs and shorthand references.

#### Scenario: Full URL parsing

- GIVEN a URL like `https://github.com/owner/repo/issues/42`
- WHEN the target is parsed
- THEN it SHALL extract `owner`, `repo`, `type` (issue/pull), and `number`

#### Scenario: Shorthand reference

- GIVEN a reference like `owner/repo#42`
- WHEN the target is parsed
- THEN it SHALL resolve to the same components as the full URL

#### Scenario: Current repo context

- GIVEN a reference like `#42` and a git repository in the current directory
- WHEN the target is parsed
- THEN it SHALL infer `owner` and `repo` from the git remote

#### Scenario: Invalid target

- GIVEN an unparseable target string
- WHEN the target is parsed
- THEN the system SHALL throw `ValidationError` with `code: 'INVALID_TARGET'`

### Requirement: Error Hierarchy

The system SHALL use a structured error hierarchy.

#### Scenario: Error types

- GIVEN any error thrown by the library
- THEN it SHALL extend `GhAttachError` base class
- AND include `code: string`, `message: string`, and optional `details: Record<string, unknown>`
- AND specific subclasses SHALL include `AuthenticationError`, `UploadError`, `ValidationError`, `NoStrategyAvailableError`
