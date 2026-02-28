import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["test/unit/**/*.test.ts"],
      environment: "node",
      coverage: {
        enabled: true,
        provider: "v8",
        reporter: ["text", "html", "json", "lcov"],
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.d.ts", "src/cli/**", "src/mcp/**", "src/index.ts"],
        thresholds: {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
      },
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
