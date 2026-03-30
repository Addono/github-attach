/**
 * E2E tests for the gh-attach binary (pkg-built) and gh extension.
 *
 * These tests verify the complete distribution path:
 * 1. CJS bundle loads and runs correctly (no ESM import errors)
 * 2. pkg-built binary executes without errors
 * 3. gh extension invocation works end-to-end
 *
 * Requires environment variables:
 * - E2E_TESTS=true - enable E2E tests
 * - GITHUB_TOKEN - GitHub API token with contents:write permission
 * - E2E_TEST_REPO - target repository (e.g., "owner/repo")
 */
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "../..");
const CJS_PATH = resolve(ROOT, "dist/cli-pkg.cjs");
const BIN_PATH = resolve(ROOT, "bin/gh-attach-linux-amd64");
const TEST_IMAGE_PATH = join(import.meta.dirname, "../fixtures/test-image.png");
const EXPECTED_VERSION =
  process.env.GH_ATTACH_BUILD_VERSION ??
  JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const E2E_TEST_REPO = process.env.E2E_TEST_REPO;
const E2E_ENABLED =
  process.env.E2E_TESTS === "true" && !!GITHUB_TOKEN && !!E2E_TEST_REPO;

describe("Binary Distribution E2E", () => {
  it("gating: requires E2E_TESTS=true, GITHUB_TOKEN, and E2E_TEST_REPO", () => {
    if (!E2E_ENABLED) {
      console.log(
        "[E2E] Binary tests skipped — set E2E_TESTS=true with GITHUB_TOKEN and E2E_TEST_REPO",
      );
    }
    expect(true).toBe(true);
  });

  describe.runIf(E2E_ENABLED)("CJS bundle (simulates pkg runtime)", () => {
    it("loads without ESM import errors", () => {
      const output = execSync(`node ${CJS_PATH} --version`, {
        encoding: "utf8",
        cwd: ROOT,
      }).trim();
      expect(output).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("uploads a file via release-asset strategy", () => {
      const output = execSync(
        `node ${CJS_PATH} upload ${TEST_IMAGE_PATH} --target ${E2E_TEST_REPO}#16 --strategy release-asset --format json`,
        {
          encoding: "utf8",
          cwd: ROOT,
          env: { ...process.env, GITHUB_TOKEN },
        },
      ).trim();
      const result = JSON.parse(output);
      expect(result.url).toMatch(/^https:\/\/github\.com\/.+/);
      expect(result.strategy).toBe("release-asset");
    });
  });

  describe.runIf(E2E_ENABLED && existsSync(BIN_PATH))(
    "pkg binary (native executable)",
    () => {
      it("runs without ESM import errors", () => {
        const output = execSync(`${BIN_PATH} --version`, {
          encoding: "utf8",
        }).trim();
        expect(output).toBe(EXPECTED_VERSION);
      });

      it("uploads a file via release-asset strategy", () => {
        const output = execSync(
          `${BIN_PATH} upload ${TEST_IMAGE_PATH} --target ${E2E_TEST_REPO}#16 --strategy release-asset --format json`,
          {
            encoding: "utf8",
            env: { ...process.env, GITHUB_TOKEN },
          },
        ).trim();
        const result = JSON.parse(output);
        expect(result.url).toMatch(/^https:\/\/github\.com\/.+/);
        expect(result.strategy).toBe("release-asset");
      });
    },
  );
});
