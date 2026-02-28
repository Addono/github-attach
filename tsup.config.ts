import { defineConfig } from "tsup";

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
]);
