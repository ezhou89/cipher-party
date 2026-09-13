import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
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
      reportsDirectory: "../../coverage/worker",
      reporter: ["text", "json-summary"],
      thresholds: { statements: 93, branches: 91, functions: 98, lines: 93 },
    },
  },
});
