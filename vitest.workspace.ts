import { defineConfig, defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["test/unit/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "integration",
      include: ["test/integration/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "e2e",
      include: ["test/e2e/**/*.test.ts"],
      environment: "node",
    },
  },
]);
