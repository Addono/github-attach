import { readFileSync } from "fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      mcp: "src/mcp/index.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node20",
  },
  {
    entry: {
      cli: "src/cli/index.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    target: "node20",
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  // CJS bundle for pkg binary packaging (pkg doesn't support ESM)
  {
    entry: {
      "cli-pkg": "src/cli/index.ts",
    },
    format: ["cjs"],
    dts: false,
    sourcemap: false,
    target: "node18",
    noExternal: [/.*/],
    banner: {
      js: "#!/usr/bin/env node",
    },
    define: {
      "process.env.__PKG_VERSION__": JSON.stringify(pkg.version),
    },
  },
]);
