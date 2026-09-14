import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function resolvedLibraries(configPath: string) {
  const { stdout } = await execFileAsync(process.execPath, [
    "./node_modules/typescript/bin/tsc",
    "--showConfig",
    "-p",
    configPath,
  ]);
  const config = JSON.parse(stdout) as { compilerOptions: { lib?: string[] } };
  return config.compilerOptions.lib;
}

describe("TypeScript library environments", () => {
  it("keeps DOM libraries exclusive to the web workspace", async () => {
    await expect(
      resolvedLibraries("packages/game-core/tsconfig.json"),
    ).resolves.toEqual(["es2022"]);
    await expect(
      resolvedLibraries("packages/protocol/tsconfig.json"),
    ).resolves.toEqual(["es2022"]);
    await expect(
      resolvedLibraries("apps/worker/tsconfig.json"),
    ).resolves.toEqual(["es2022"]);
    await expect(resolvedLibraries("apps/web/tsconfig.json")).resolves.toEqual([
      "es2022",
      "dom",
      "dom.iterable",
    ]);
  });
});
