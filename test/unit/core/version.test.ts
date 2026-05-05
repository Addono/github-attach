import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  DEVELOPMENT_VERSION,
  resolvePackageVersion,
} from "../../../src/core/version.js";

describe("resolvePackageVersion", () => {
  let tempRoot = "";

  beforeEach(() => {
    delete process.env.__PKG_VERSION__;
    delete process.env.GH_ATTACH_BUILD_VERSION;

    tempRoot = mkdtempSync(join(tmpdir(), "gh-attach-version-"));
    writeFileSync(
      join(tempRoot, "package.json"),
      JSON.stringify({ version: "9.9.9" }),
    );
    mkdirSync(join(tempRoot, "src", "mcp"), { recursive: true });
    mkdirSync(join(tempRoot, "dist"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.__PKG_VERSION__;
    delete process.env.GH_ATTACH_BUILD_VERSION;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("resolves the package version from source layout paths", () => {
    const version = resolvePackageVersion(
      pathToFileURL(join(tempRoot, "src", "mcp", "index.ts")).href,
    );

    expect(version).toBe("9.9.9");
  });

  it("resolves the package version from dist layout paths", () => {
    const version = resolvePackageVersion(
      pathToFileURL(join(tempRoot, "dist", "mcp.js")).href,
    );

    expect(version).toBe("9.9.9");
  });

  it("prefers the injected build version when present", () => {
    process.env.__PKG_VERSION__ = "2.3.4";

    const version = resolvePackageVersion(
      pathToFileURL(join(tempRoot, "dist", "mcp.js")).href,
    );

    expect(version).toBe("2.3.4");
  });

  it("uses the release build version during source-driven runs", () => {
    process.env.GH_ATTACH_BUILD_VERSION = "3.4.5";

    const version = resolvePackageVersion(
      pathToFileURL(join(tempRoot, "src", "mcp", "index.ts")).href,
    );

    expect(version).toBe("3.4.5");
  });

  it("prefers the bundled build version over the runtime release override", () => {
    process.env.__PKG_VERSION__ = "2.3.4";
    process.env.GH_ATTACH_BUILD_VERSION = "3.4.5";

    const version = resolvePackageVersion(
      pathToFileURL(join(tempRoot, "dist", "mcp.js")).href,
    );

    expect(version).toBe("2.3.4");
  });

  it("falls back to the development version when package metadata is missing", () => {
    const orphanRoot = mkdtempSync(
      join(tmpdir(), "gh-attach-version-missing-"),
    );
    mkdirSync(join(orphanRoot, "dist"), { recursive: true });

    try {
      const version = resolvePackageVersion(
        pathToFileURL(join(orphanRoot, "dist", "mcp.js")).href,
      );

      expect(version).toBe(DEVELOPMENT_VERSION);
    } finally {
      rmSync(orphanRoot, { recursive: true, force: true });
    }
  });
});
