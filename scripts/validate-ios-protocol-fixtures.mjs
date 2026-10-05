import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const protocolFixtureArgs = [
  "--filter",
  "@cipher-party/protocol",
  "exec",
  "vitest",
  "run",
  "src/ios-fixtures.test.ts",
];

export function validateIOSProtocolFixtures({
  spawn = spawnSync,
  cwd = repositoryRoot,
  reportError = console.error,
} = {}) {
  const result = spawn("pnpm", protocolFixtureArgs, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    reportError("Unable to launch the iOS protocol fixture validator.");
    return 1;
  }
  return result.status ?? 1;
}

export function runIOSProtocolFixtureValidator({
  argv = process.argv,
  modulePath = fileURLToPath(import.meta.url),
  validate = validateIOSProtocolFixtures,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  if (argv[1] && resolve(argv[1]) === modulePath) {
    setExitCode(validate());
  }
}

runIOSProtocolFixtureValidator();
