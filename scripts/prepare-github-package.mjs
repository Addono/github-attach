import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(rootDir, ".release", "github-package");
const pkgPath = resolve(rootDir, "package.json");
const version = process.env.GH_ATTACH_RELEASE_VERSION;

if (!version) {
  throw new Error("GH_ATTACH_RELEASE_VERSION is required.");
}

const sourcePackage = JSON.parse(readFileSync(pkgPath, "utf8"));
const mirrorPackage = {
  name: "@addono/gh-attach",
  version,
  description: sourcePackage.description,
  type: sourcePackage.type,
  main: sourcePackage.main,
  types: sourcePackage.types,
  bin: sourcePackage.bin,
  exports: sourcePackage.exports,
  files: sourcePackage.files,
  keywords: sourcePackage.keywords,
  author: sourcePackage.author,
  license: sourcePackage.license,
  repository: sourcePackage.repository,
  publishConfig: {
    registry: "https://npm.pkg.github.com",
  },
  engines: sourcePackage.engines,
  dependencies: sourcePackage.dependencies,
};

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

for (const entry of mirrorPackage.files) {
  cpSync(resolve(rootDir, entry), resolve(outputDir, entry), {
    recursive: true,
  });
}

writeFileSync(
  resolve(outputDir, "package.json"),
  `${JSON.stringify(mirrorPackage, null, 2)}\n`,
);
