import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.config.*",
        "**/*.typecheck.*",
        "**/*.d.ts",
        "**/fixtures/**",
        "**/generated/**",
      ],
      reportsDirectory: "../../coverage/protocol",
      reporter: ["text", "json-summary"],
      thresholds: { statements: 96, branches: 94, functions: 100, lines: 96 },
    },
  },
});
