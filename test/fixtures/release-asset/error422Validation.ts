/**
 * Fixture: release-asset create release validation failure (422)
 *
 * Covers: tag lookup 404 then release creation fails with 422 validation error.
 */
export const releaseAssetError422Validation = {
  name: "release-asset/error-422-validation",
  interactions: [
    {
      id: "get-release-by-tag",
      method: "GET",
      url: "https://api.github.com/repos/testowner/testrepo/releases/tags/_gh-attach-assets",
      response: { status: 404, json: { message: "Not Found" } },
    },
    {
      id: "create-release",
      method: "POST",
      url: "https://api.github.com/repos/testowner/testrepo/releases",
      response: {
        status: 422,
        json: {
          message: "Validation Failed",
          errors: [
            { resource: "Release", field: "tag_name", code: "already_exists" },
          ],
        },
      },
    },
  ],
} as const;
