/**
 * commitlint configuration
 *
 * Enforces conventional commit format as specified in CI-CD/spec.md
 */

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message) => message.trim() === "Initial plan"],
  rules: {
    "body-max-line-length": [0],
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
      ],
    ],
  },
};
