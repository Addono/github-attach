import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Fallback version used when package metadata cannot be resolved.
 */
export const DEVELOPMENT_VERSION = "0.0.0-development";

const MAX_PACKAGE_SEARCH_DEPTH = 3;

function readInjectedBuildVersion(): string | undefined {
  const version =
    process.env.__PKG_VERSION__ ?? process.env.GH_ATTACH_BUILD_VERSION;

  if (typeof version === "string" && version.length > 0) {
    return version;
  }

  return undefined;
}

function readPackageVersion(pkgPath: string): string | undefined {
  if (!existsSync(pkgPath)) {
    return undefined;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    version?: unknown;
  };

  if (typeof pkg.version === "string" && pkg.version.length > 0) {
    return pkg.version;
  }

  return undefined;
}

/**
 * Resolves the package version for the currently running module.
 *
 * Walks upward from the provided module URL so the same helper works from
 * source files under `src/`, built files under `dist/`, and packaged npm
 * installs used by `npx`.
 */
export function resolvePackageVersion(
  moduleUrl: string,
  fallback = DEVELOPMENT_VERSION,
): string {
  const injectedBuildVersion = readInjectedBuildVersion();
  if (injectedBuildVersion) {
    return injectedBuildVersion;
  }

  try {
    let currentDir = dirname(fileURLToPath(moduleUrl));

    for (let depth = 0; depth <= MAX_PACKAGE_SEARCH_DEPTH; depth += 1) {
      const version = readPackageVersion(resolve(currentDir, "package.json"));
      if (version) {
        return version;
      }

      const parentDir = resolve(currentDir, "..");
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  } catch {
    // Fall through to the development version below.
  }

  return fallback;
}
