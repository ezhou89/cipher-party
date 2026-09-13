import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      coverage: {
        provider: "istanbul",
        include: ["src/**/*.ts", "src/**/*.tsx"],
        exclude: [
          "**/*.test.*",
          "**/*.spec.*",
          "**/*.config.*",
          "**/*.typecheck.*",
          "**/*.d.ts",
          "**/fixtures/**",
          "**/generated/**",
          "src/test/**",
        ],
        reportsDirectory: "../../coverage/web",
        reporter: ["text", "json-summary"],
        thresholds: { statements: 91, branches: 87, functions: 91, lines: 91 },
      },
    },
  }),
);
