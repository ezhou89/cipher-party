import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["scripts/**/*.mjs"],
      exclude: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.config.*",
        "**/fixtures/**",
        "**/generated/**",
      ],
      reportsDirectory: "coverage/root",
      reporter: ["text", "json-summary"],
      thresholds: { statements: 80, branches: 77, functions: 92, lines: 80 },
    },
  },
});
