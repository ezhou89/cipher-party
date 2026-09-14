import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  defaultRun,
  localCli,
  projectRoot,
  readStagingConfig,
  runChecked,
  sourceState,
} from "./staging-common.mjs";

export async function deployStaging({
  root = projectRoot,
  run = defaultRun,
  dryRun = false,
  expectedCommit,
} = {}) {
  if (!dryRun && !/^[a-f0-9]{40}$/u.test(expectedCommit ?? ""))
    throw new Error("Live deployment requires a full verified expectedCommit");
  const { path } = await readStagingConfig(root);
  const source = await sourceState(root, run);
  if (!dryRun && source.commit !== expectedCommit)
    throw new Error("Verified source revision does not match expectedCommit");
  if (source.dirty && !dryRun)
    throw new Error("Staging deployment requires a clean, committed worktree");
  const tsc = localCli("typescript", "bin/tsc", root);
  for (const workspace of [
    "packages/game-core",
    "packages/protocol",
    "apps/web",
    "apps/worker",
  ]) {
    await runChecked(
      run,
      process.execPath,
      [tsc, "--noEmit"],
      resolve(root, workspace),
      `${workspace} build`,
    );
  }
  const web = resolve(root, "apps/web");
  await runChecked(
    run,
    process.execPath,
    [localCli("vite", "bin/vite.js", web), "build"],
    web,
    "Web build",
  );
  const current = await sourceState(root, run);
  if (current.commit !== source.commit || (!dryRun && current.dirty))
    throw new Error(
      "Source changed during the build; commit changes and rerun staging deployment",
    );
  const worker = resolve(root, "apps/worker");
  const message = `source:${source.commit}${dryRun && current.dirty ? " (dirty dry run)" : ""}`;
  const args = [
    localCli("wrangler", "bin/wrangler.js", worker),
    "deploy",
    "--strict",
    "--config",
    path,
    "--message",
    message,
  ];
  if (dryRun) args.push("--dry-run");
  await runChecked(
    run,
    process.execPath,
    args,
    worker,
    dryRun ? "Staging dry run" : "Staging deployment",
  );
  return {
    commit: source.commit,
    dryRun,
    dirty: current.dirty,
  };
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
    if (values.help) {
      console.log(
        "Usage: node scripts/deploy-staging.mjs --dry-run\nLive deployment must use pnpm run deploy:staging and its source-bound release gate.",
      );
    } else {
      if (!values["dry-run"])
        throw new Error("Live deployment must use pnpm run deploy:staging");
      const result = await deployStaging({ dryRun: values["dry-run"] });
      console.log(
        `Staging ${result.dryRun ? "dry run" : "deployment"}: source ${result.commit}${result.dirty ? " (dirty dry run)" : ""}`,
      );
    }
  } catch {
    console.error(
      "Staging command refused or failed; live deployment must use pnpm run deploy:staging (direct CLI supports --dry-run only)",
    );
    process.exitCode = 1;
  }
}
