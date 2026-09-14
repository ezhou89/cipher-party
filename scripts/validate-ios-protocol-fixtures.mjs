import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@cipher-party/protocol",
    "exec",
    "vitest",
    "run",
    "src/ios-fixtures.test.ts"
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit"
  }
);

if (result.error) {
  console.error("Unable to launch the iOS protocol fixture validator.");
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
