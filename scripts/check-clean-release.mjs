import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultRun, projectRoot, sourceState } from "./staging-common.mjs";
import {
  pnpmCommand,
  releaseCommand,
  requireClean,
} from "./release-staging.mjs";

export async function checkCleanRelease({
  root = projectRoot,
  run = defaultRun,
  source = sourceState,
  makeTemp = mkdtemp,
  remove = (directory) => rm(directory, { recursive: true, force: true }),
  pnpmEntry = process.env.npm_execpath,
  exists,
} = {}) {
  const before = await source(root, run);
  requireClean(before);
  const pnpm = await pnpmCommand({
    entry: pnpmEntry,
    ...(exists ? { exists } : {}),
  });
  const directory = await makeTemp(join(tmpdir(), "cipher-party-release-"));
  if (
    !isAbsolute(directory) ||
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !/^cipher-party-release-[A-Za-z0-9]+$/u.test(basename(directory))
  )
    throw new Error("Unsafe temporary release directory; refusing cleanup");
  let failure;
  try {
    const checkout = join(directory, "checkout");
    await releaseCommand(
      run,
      "git",
      ["clone", "--no-hardlinks", "--no-checkout", "--", root, checkout],
      root,
      "Local source clone",
    );
    await releaseCommand(
      run,
      "git",
      ["checkout", "--detach", before.commit],
      checkout,
      "Exact source checkout",
    );
    requireClean(await source(checkout, run), before.commit);
    await releaseCommand(
      run,
      pnpm.command,
      [...pnpm.args, "install", "--frozen-lockfile"],
      checkout,
      "Frozen install",
    );
    await releaseCommand(
      run,
      pnpm.command,
      [...pnpm.args, "run", "check:release"],
      checkout,
      "Clean release gate",
    );
    requireClean(await source(checkout, run), before.commit);
  } catch (error) {
    failure = error;
  }
  // Only this exact validated mkdtemp directory is eligible for removal.
  try {
    await remove(directory);
  } catch {
    failure ??= new Error("Temporary release checkout cleanup failed");
  }
  if (failure) throw failure;
  return { commit: before.commit };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = await checkCleanRelease();
    console.log(
      `Clean-checkout release gate passed for source ${result.commit}; temporary checkout removed`,
    );
  } catch {
    console.error(
      "Clean-checkout release gate failed; verify pnpm invocation, clean committed source, dependencies and browser provisioning",
    );
    process.exitCode = 1;
  }
}
