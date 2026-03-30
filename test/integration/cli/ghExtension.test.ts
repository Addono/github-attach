import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, cp, mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const PACKAGE_JSON = JSON.parse(
  readFileSync(resolve(ROOT, "package.json"), "utf8"),
) as {
  version: string;
};
const EXPECTED_VERSION =
  process.env.GH_ATTACH_BUILD_VERSION ?? PACKAGE_JSON.version;
const HAS_GH =
  spawnSync("gh", ["--version"], {
    encoding: "utf8",
  }).status === 0;

const cleanupDirs: string[] = [];

function runGh(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  return execFileSync("gh", args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
  }).trim();
}

async function createIsolatedGhEnv(): Promise<NodeJS.ProcessEnv> {
  const homeDir = await mkdtemp(join(tmpdir(), "gh-attach-home-"));
  const configDir = await mkdtemp(join(tmpdir(), "gh-attach-config-"));
  cleanupDirs.push(homeDir, configDir);

  return {
    ...process.env,
    HOME: homeDir,
    GH_CONFIG_DIR: configDir,
    GH_TOKEN:
      process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "gh-test-token",
  };
}

async function createLocalExtensionCheckout(): Promise<string> {
  const parentDir = await mkdtemp(join(tmpdir(), "gh-attach-ext-"));
  const repoDir = join(parentDir, "gh-attach");
  cleanupDirs.push(parentDir);

  await mkdir(repoDir, { recursive: true });
  await mkdir(join(repoDir, ".git"));
  await cp(join(ROOT, "src"), join(repoDir, "src"), { recursive: true });
  await cp(join(ROOT, "gh-attach"), join(repoDir, "gh-attach"));
  await cp(join(ROOT, "package.json"), join(repoDir, "package.json"));
  await chmod(join(repoDir, "gh-attach"), 0o755);
  await symlink(
    join(ROOT, "node_modules"),
    join(repoDir, "node_modules"),
    "dir",
  );

  return repoDir;
}

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("GitHub CLI extension integration", () => {
  describe.runIf(HAS_GH)("local extension install", () => {
    it("installs the current checkout and exposes gh attach", async () => {
      const env = await createIsolatedGhEnv();

      runGh(["extension", "install", "."], { cwd: ROOT, env });

      expect(runGh(["attach", "--version"], { cwd: ROOT, env })).toBe(
        EXPECTED_VERSION,
      );
      expect(runGh(["attach", "--help"], { cwd: ROOT, env })).toContain(
        "upload",
      );
    });

    it("installs an unbuilt checkout and runs the current source via local tsx", async () => {
      const env = await createIsolatedGhEnv();
      const repoDir = await createLocalExtensionCheckout();

      runGh(["extension", "install", "."], { cwd: repoDir, env });

      expect(runGh(["attach", "--version"], { cwd: repoDir, env })).toBe(
        PACKAGE_JSON.version,
      );
      expect(runGh(["attach", "--help"], { cwd: repoDir, env })).toContain(
        "upload",
      );
    });
  });
});
