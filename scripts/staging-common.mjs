import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import { parse } from "jsonc-parser";

export const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const defaultRun = promisify(execFile);
export const roomsNamespace = "f2766441dfa24d10bef55dd8ee4f5599";
const require = createRequire(import.meta.url);

const expectedConfig = {
  name: "cipher-party-staging",
  account_id: "7514dcd2dc3f092c0420d66eb65a383e",
  main: "src/index.ts",
  compatibility_date: "2026-08-30",
  workers_dev: false,
  preview_urls: false,
  send_metrics: false,
  routes: [{ pattern: "staging.oddlyuseful.studio", custom_domain: true }],
  vars: { CANONICAL_ORIGIN: "https://staging.oddlyuseful.studio" },
  durable_objects: {
    bindings: [{ name: "ROOMS", class_name: "RoomDurableObject" }],
  },
  migrations: [{ tag: "v1", new_sqlite_classes: ["RoomDurableObject"] }],
  assets: {
    directory: "../web/dist",
    binding: "ASSETS",
    not_found_handling: "single-page-application",
    run_worker_first: true,
  },
  ratelimits: [
    {
      name: "CREATE_BY_IP",
      namespace_id: "2026090701",
      simple: { limit: 10, period: 60 },
    },
    {
      name: "JOIN_BY_IP",
      namespace_id: "2026090702",
      simple: { limit: 60, period: 60 },
    },
    {
      name: "JOIN_BY_ROOM",
      namespace_id: "2026090703",
      simple: { limit: 120, period: 60 },
    },
    {
      name: "TICKET_BY_IP",
      namespace_id: "2026090704",
      simple: { limit: 120, period: 60 },
    },
    {
      name: "TICKET_BY_ROOM",
      namespace_id: "2026090705",
      simple: { limit: 240, period: 60 },
    },
  ],
};

export async function readStagingConfig(root) {
  const path = resolve(root, "apps/worker/wrangler.staging.jsonc");
  const errors = [];
  const config = parse(await readFile(path, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (
    errors.length ||
    config === null ||
    typeof config !== "object" ||
    Array.isArray(config)
  ) {
    throw new Error("Staging config must be valid JSONC");
  }
  for (const key of Object.keys(config)) {
    if (key !== "$schema" && !Object.hasOwn(expectedConfig, key)) {
      throw new Error(`Staging config contains an unapproved field: ${key}`);
    }
  }
  for (const [key, value] of Object.entries(expectedConfig)) {
    if (!isDeepStrictEqual(config[key], value)) {
      throw new Error(`Staging config has an incorrect ${key}`);
    }
  }
  return { config, path };
}

export function localCli(packageName, entry, directory) {
  return resolve(
    dirname(
      require.resolve(`${packageName}/package.json`, { paths: [directory] }),
    ),
    entry,
  );
}

export async function runChecked(run, command, args, cwd, label) {
  try {
    return await run(command, args, {
      cwd,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
  } catch {
    // Child-process exceptions can embed stdout, stderr, or credentials.
    throw new Error(
      `${label} failed (60-second timeout or nonzero exit); check local tooling and authentication`,
    );
  }
}

export async function sourceState(root, run) {
  const commit = (
    await runChecked(
      run,
      "git",
      ["rev-parse", "HEAD"],
      root,
      "Git revision check",
    )
  ).stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(commit))
    throw new Error("Git revision check failed: expected a full source commit");
  const dirty =
    (
      await runChecked(
        run,
        "git",
        ["status", "--porcelain"],
        root,
        "Git worktree check",
      )
    ).stdout.trim() !== "";
  return { commit, dirty };
}
