import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(rootDir, ".release", "github-package");
const npmrcPath = resolve(packageDir, ".npmrc");
const token = process.env.GITHUB_PACKAGES_TOKEN;
const npmPath = process.platform === "win32" ? "npm.cmd" : "npm";

if (!existsSync(packageDir)) {
  throw new Error("GitHub Packages mirror has not been prepared.");
}

if (!token) {
  throw new Error("GITHUB_PACKAGES_TOKEN is required.");
}

writeFileSync(
  npmrcPath,
  [
    "@addono:registry=https://npm.pkg.github.com",
    `//npm.pkg.github.com/:_authToken=${token}`,
    "",
  ].join("\n"),
);

try {
  const result = spawnSync(
    npmPath,
    ["publish", "--registry", "https://npm.pkg.github.com"],
    {
      cwd: packageDir,
      stdio: "inherit",
      env: {
        ...process.env,
        NPM_CONFIG_USERCONFIG: npmrcPath,
      },
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} finally {
  rmSync(npmrcPath, { force: true });
}
