import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { deployStaging } from "./deploy-staging.mjs";
import { defaultRun, projectRoot, sourceState } from "./staging-common.mjs";

export async function pnpmCommand(options = {}) {
  const entry = Object.hasOwn(options, "entry")
    ? options.entry
    : process.env.npm_execpath;
  const exists =
    options.exists ??
    (async (path) => {
      try {
        return (await stat(path)).isFile();
      } catch {
        return false;
      }
    });
  if (typeof entry !== "string" || !isAbsolute(entry) || !(await exists(entry)))
    throw new Error(
      "Invoke this release command via pnpm; an absolute existing npm_execpath is required",
    );
  return /\.[cm]?js$/iu.test(entry)
    ? { command: process.execPath, args: [entry] }
    : { command: entry, args: [] };
}

export async function releaseCommand(run, command, args, cwd, label) {
  try {
    return await run(command, args, {
      cwd,
      timeout: 30 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
  } catch {
    throw new Error(
      `${label} failed (nonzero exit or 30-minute timeout); rerun the local command for value-safe diagnostics`,
    );
  }
}

export function requireClean(source, expectedCommit) {
  if (!source || !/^[a-f0-9]{40}$/u.test(source.commit) || source.dirty)
    throw new Error("Release requires a clean committed source revision");
  if (expectedCommit !== undefined && source.commit !== expectedCommit)
    throw new Error("Source revision changed during the release gate");
}

export async function runRelease({
  root = projectRoot,
  run = defaultRun,
  dryRun = false,
  source = sourceState,
  deploy = deployStaging,
  gate,
} = {}) {
  if (dryRun) return deploy({ root, run, dryRun: true });
  const before = await source(root, run);
  requireClean(before);
  try {
    if (gate) await gate();
    else {
      const pnpm = await pnpmCommand();
      await releaseCommand(
        run,
        pnpm.command,
        [...pnpm.args, "run", "check:release"],
        root,
        "Release gate",
      );
    }
  } catch {
    throw new Error("Release gate failed; deployment was not attempted");
  }
  requireClean(await source(root, run), before.commit);
  return deploy({ root, run, dryRun: false, expectedCommit: before.commit });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { values } = parseArgs({
      options: {
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(
        "Usage: pnpm run deploy:staging [--dry-run]\nLive deployment requires a clean exact source and a fresh complete release gate.",
      );
    else {
      const result = await runRelease({ dryRun: values["dry-run"] });
      console.log(
        `Staging ${result.dryRun ? "dry run" : "release"} completed for source ${result.commit}`,
      );
    }
  } catch {
    console.error(
      "Staging release failed; invoke via pnpm and verify clean source and the local release gate",
    );
    process.exitCode = 1;
  }
}
