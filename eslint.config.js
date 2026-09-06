import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      ".worktrees/**",
      "**/.worktrees/**",
      ".superpowers/**",
      "**/.superpowers/**",
      "test-results/**",
      "playwright-report/**",
      "**/worker-configuration.d.ts"
    ]
  },
  {
    files: [
      "scripts/**/*.mjs",
      "scripts/**/*.js",
      "*.config.js",
      "*.config.ts"
    ],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly"
      }
    }
  }
);
