import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const TARGETS = [
  {
    target: "node18-linux-x64",
    pkgOutput: "cli-pkg-linux-x64",
    assetName: "gh-attach-linux-amd64",
  },
  {
    target: "node18-macos-x64",
    pkgOutput: "cli-pkg-macos-x64",
    assetName: "gh-attach-darwin-amd64",
  },
  {
    target: "node18-macos-arm64",
    pkgOutput: "cli-pkg-macos-arm64",
    assetName: "gh-attach-darwin-arm64",
  },
  {
    target: "node18-win-x64",
    pkgOutput: "cli-pkg-win-x64.exe",
    assetName: "gh-attach-windows-amd64.exe",
  },
];

const requestedTargets = (
  process.env.GH_ATTACH_PKG_TARGETS ??
  TARGETS.map(({ target }) => target).join(",")
)
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);

if (requestedTargets.length === 0) {
  throw new Error(
    "GH_ATTACH_PKG_TARGETS must contain at least one pkg target.",
  );
}

const selectedTargets = TARGETS.filter(({ target }) =>
  requestedTargets.includes(target),
);

const missingTargets = requestedTargets.filter(
  (target) => !selectedTargets.some((entry) => entry.target === target),
);

if (missingTargets.length > 0) {
  throw new Error(`Unsupported pkg target(s): ${missingTargets.join(", ")}`);
}

const pkgPath = resolve(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "pkg.cmd" : "pkg",
);
const binDir = resolve("bin");

mkdirSync(binDir, { recursive: true });

if (selectedTargets.length === 1) {
  const [{ assetName, target }] = selectedTargets;
  const destinationPath = resolve(binDir, assetName);

  if (existsSync(destinationPath)) {
    rmSync(destinationPath, { force: true });
  }

  execFileSync(
    pkgPath,
    [
      "dist/cli-pkg.cjs",
      "--output",
      destinationPath,
      "--compress",
      "GZip",
      "--targets",
      target,
    ],
    {
      stdio: "inherit",
    },
  );

  process.exit(0);
}

execFileSync(
  pkgPath,
  [
    "dist/cli-pkg.cjs",
    "--out-path",
    "bin",
    "--compress",
    "GZip",
    "--targets",
    selectedTargets.map(({ target }) => target).join(","),
  ],
  {
    stdio: "inherit",
  },
);

for (const { pkgOutput, assetName } of selectedTargets) {
  const sourcePath = resolve(binDir, pkgOutput);
  const destinationPath = resolve(binDir, assetName);

  if (!existsSync(sourcePath)) {
    throw new Error(`Expected pkg output was not created: ${pkgOutput}`);
  }

  if (existsSync(destinationPath)) {
    rmSync(destinationPath, { force: true });
  }

  renameSync(sourcePath, destinationPath);
}
