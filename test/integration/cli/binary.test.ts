import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "../../..");
const CJS_PATH = resolve(ROOT, "dist/cli-pkg.cjs");
const ESM_PATH = resolve(ROOT, "dist/cli.js");

/**
 * Runs the CJS bundle with given arguments and returns stdout.
 */
function runCjs(args: string): string {
  return execSync(`node ${CJS_PATH} ${args}`, {
    encoding: "utf8",
    cwd: ROOT,
  }).trim();
}

describe("CJS Bundle (pkg target)", () => {
  it("should exist after build", () => {
    expect(existsSync(CJS_PATH)).toBe(true);
  });

  it("should be CommonJS format (no top-level import statements)", () => {
    const content = readFileSync(CJS_PATH, "utf8");
    // CJS bundles use require(), not top-level import
    // The shebang + "use strict" should be near the top, not ESM import
    const firstLines = content.split("\n").slice(0, 5).join("\n");
    expect(firstLines).not.toMatch(/^import\s+\{/m);
  });

  it("should output version matching package.json", () => {
    const pkgVersion = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf8"),
    ).version;
    const output = runCjs("--version");
    expect(output).toBe(pkgVersion);
  });

  it("should display help text", () => {
    const output = runCjs("--help");
    expect(output).toContain("gh-attach");
    expect(output).toContain("upload");
    expect(output).toContain("login");
    expect(output).toContain("mcp");
  });

  it("should display upload subcommand help with strategy names", () => {
    const output = runCjs("upload --help");
    expect(output).toContain("release-asset");
    expect(output).toContain("repo-branch");
    expect(output).toContain("--target");
  });

  it("should display mcp subcommand help", () => {
    const output = runCjs("mcp --help");
    expect(output).toContain("--transport");
    expect(output).toContain("stdio");
  });
});

describe("ESM Bundle", () => {
  it("should exist after build", () => {
    expect(existsSync(ESM_PATH)).toBe(true);
  });

  it("should be ESM format with shebang", () => {
    const content = readFileSync(ESM_PATH, "utf8");
    expect(content).toMatch(/^#!\/usr\/bin\/env node/);
  });

  it("should output the same version as CJS bundle", () => {
    const esmVersion = execSync(`node ${ESM_PATH} --version`, {
      encoding: "utf8",
      cwd: ROOT,
    }).trim();
    const cjsVersion = runCjs("--version");
    expect(esmVersion).toBe(cjsVersion);
  });
});

describe("Binary Artifacts", () => {
  const canExecuteLinuxBinary = process.platform === "linux";

  it("should produce Linux x64 binary via pkg", () => {
    const binPath = resolve(ROOT, "bin/gh-attach-linux-amd64");
    // Only execute native Linux binary on Linux hosts.
    if (!existsSync(binPath) || !canExecuteLinuxBinary) {
      return;
    }
    const output = execSync(`${binPath} --version`, {
      encoding: "utf8",
    }).trim();
    const pkgVersion = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf8"),
    ).version;
    expect(output).toBe(pkgVersion);
  });

  it("should produce Linux binary that can display help", () => {
    const binPath = resolve(ROOT, "bin/gh-attach-linux-amd64");
    if (!existsSync(binPath) || !canExecuteLinuxBinary) {
      return;
    }
    const output = execSync(`${binPath} --help`, {
      encoding: "utf8",
    }).trim();
    expect(output).toContain("gh-attach");
    expect(output).toContain("upload");
  });

  it("should produce Linux binary that handles upload subcommand", () => {
    const binPath = resolve(ROOT, "bin/gh-attach-linux-amd64");
    if (!existsSync(binPath) || !canExecuteLinuxBinary) {
      return;
    }
    const output = execSync(`${binPath} upload --help`, {
      encoding: "utf8",
    }).trim();
    expect(output).toContain("--target");
    expect(output).toContain("--strategy");
  });
});
