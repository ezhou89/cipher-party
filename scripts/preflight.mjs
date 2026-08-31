import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { URL } from "node:url";
import { promisify } from "node:util";

import { parse, printParseErrorCode } from "jsonc-parser";

import { verifyProjectDocs } from "./check-project-docs.mjs";

const execFileAsync = promisify(execFile);

const configFiles = [
  ["wrangler.jsonc", "apps/worker/wrangler.jsonc"],
  ["wrangler.dev.jsonc", "apps/worker/wrangler.dev.jsonc"],
  ["wrangler.test.jsonc", "apps/worker/wrangler.test.jsonc"],
];

const requiredExpiryTests = [
  "RoomDurableObject persistence reschedules expiry only after accepted revision-changing activity",
  "RoomDurableObject inactivity alarm reschedules the unchanged deadline when an alarm arrives early",
  "RoomDurableObject inactivity alarm expires at the exact deadline and is empty on an idempotent repeat",
  "RoomDurableObject inactivity alarm expires after the deadline and is empty on an idempotent repeat",
  "RoomDurableObject inactivity alarm closes every accepted socket with the room-expired close frame",
  "RoomDurableObject inactivity alarm uses the approved 24-hour inactivity duration",
];

class PreflightError extends Error {
  constructor(results) {
    const failures = results.filter((result) => result.status === "FAIL");
    super(
      `Preflight failed:\n${failures
        .map((failure) => `- ${failure.check}: ${failure.detail}`)
        .join("\n")}`,
    );
    this.name = "PreflightError";
    this.results = results;
  }
}

function messageFrom(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseNodeMajor(nodeVersion) {
  const match = /^v?(\d+)(?:\.|$)/u.exec(nodeVersion);
  if (match === null) {
    throw new Error(`Could not parse Node.js version: ${nodeVersion}`);
  }
  return Number(match[1]);
}

async function requireFile(path, message) {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new Error(message);
    }
  } catch (error) {
    if (error instanceof Error && error.message === message) {
      throw error;
    }
    throw new Error(message, { cause: error });
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

async function parseConfig(root, [label, relativePath], readTextFile) {
  const path = resolve(root, relativePath);
  const source = await readTextFile(path, "utf8");
  const errors = [];
  const config = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const codes = errors
      .map((error) => printParseErrorCode(error.error))
      .join(", ");
    throw new Error(`${label} is invalid JSONC (${codes})`);
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${label} must contain a JSONC object`);
  }
  return deepFreeze({ config: deepFreeze(config), label, path });
}

async function readConfigs(root, readTextFile) {
  return deepFreeze(
    await Promise.all(
      configFiles.map((entry) => parseConfig(root, entry, readTextFile)),
    ),
  );
}

function requireRoomsBinding({ config, label }) {
  const bindings = config.durable_objects?.bindings;
  const rooms = Array.isArray(bindings)
    ? bindings.filter((binding) => binding?.name === "ROOMS")
    : [];
  if (rooms.length !== 1 || rooms[0]?.class_name !== "RoomDurableObject") {
    throw new Error(
      `${label} must bind ROOMS to RoomDurableObject exactly once`,
    );
  }
  return rooms[0].class_name;
}

function requireSqliteMigration({ config, label }) {
  const migrations = Array.isArray(config.migrations) ? config.migrations : [];
  const v1 = migrations.filter((migration) => migration?.tag === "v1");
  if (
    v1.length !== 1 ||
    !Array.isArray(v1[0]?.new_sqlite_classes) ||
    v1[0].new_sqlite_classes.length !== 1 ||
    v1[0].new_sqlite_classes[0] !== "RoomDurableObject"
  ) {
    throw new Error(
      `${label} v1 migration must declare RoomDurableObject in new_sqlite_classes`,
    );
  }
  return JSON.stringify(v1[0]);
}

function sameValue(values) {
  return values.every((value) => value === values[0]);
}

function verifyWranglerParity(configs) {
  const roomClasses = configs.map(requireRoomsBinding);
  const migrations = configs.map(requireSqliteMigration);
  const compatibilityDates = configs.map(
    ({ config }) => config.compatibility_date,
  );
  const canonicalOrigins = configs.map(
    ({ config }) => config.vars?.CANONICAL_ORIGIN,
  );

  if (
    compatibilityDates.some(
      (compatibilityDate) =>
        typeof compatibilityDate !== "string" || compatibilityDate.length === 0,
    ) ||
    !sameValue(compatibilityDates)
  ) {
    throw new Error(
      "Wrangler compatibility_date must match across production, development, and test configs",
    );
  }
  if (
    canonicalOrigins.some(
      (canonicalOrigin) => typeof canonicalOrigin !== "string",
    ) ||
    !sameValue(canonicalOrigins)
  ) {
    throw new Error(
      "Wrangler CANONICAL_ORIGIN must match across production, development, and test configs",
    );
  }
  if (!sameValue(roomClasses)) {
    throw new Error(
      "Wrangler ROOMS class must match across production, development, and test configs",
    );
  }
  if (!sameValue(migrations)) {
    throw new Error(
      "Wrangler v1 SQLite migration must match across production, development, and test configs",
    );
  }

  return "3 configs; ROOMS and v1 SQLite migration agree";
}

function verifyCanonicalOrigin(configs) {
  const value = configs[0].config.vars?.CANONICAL_ORIGIN;
  if (typeof value !== "string") {
    throw new Error(
      "CANONICAL_ORIGIN must be an absolute canonical http(s) origin",
    );
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "CANONICAL_ORIGIN must be an absolute canonical http(s) origin",
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== value
  ) {
    throw new Error(
      "CANONICAL_ORIGIN must be an absolute canonical http(s) origin",
    );
  }
  return value;
}

async function verifyStaticAssets(root, configs) {
  const production = configs[0];
  const directory = production.config.assets?.directory;
  if (typeof directory !== "string") {
    throw new Error("wrangler.jsonc must configure the Worker asset directory");
  }

  const configuredPath = resolve(dirname(production.path), directory);
  const expectedPath = resolve(root, "apps/web/dist");
  if (configuredPath !== expectedPath) {
    throw new Error("Worker assets must resolve to apps/web/dist");
  }
  await requireFile(
    resolve(expectedPath, "index.html"),
    "Worker static assets are missing; run npm run build",
  );
  return "apps/web/dist/index.html";
}

function verifyMilestoneBindings(configs) {
  const hasFutureBinding = configs.some(({ config }) => {
    const environments =
      config.env !== null &&
      typeof config.env === "object" &&
      !Array.isArray(config.env)
        ? Object.values(config.env).filter(
            (environment) =>
              environment !== null &&
              typeof environment === "object" &&
              !Array.isArray(environment),
          )
        : [];
    return [config, ...environments].some((scope) =>
      ["r2_buckets", "ai"].some((key) =>
        Object.prototype.hasOwnProperty.call(scope, key),
      ),
    );
  });
  if (hasFutureBinding) {
    throw new Error("R2 and Workers AI bindings belong to Milestone 2");
  }
  return "R2 and Workers AI absent";
}

async function executeExpiryTestProcess(root) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      resolve(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "test/room-durable-object.test.ts",
      "--config",
      "vitest.config.ts",
      "--reporter=json",
    ],
    {
      cwd: resolve(root, "apps/worker"),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return stdout;
}

function subprocessExitDetail(error) {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (typeof error.code === "number" || typeof error.code === "string")
  ) {
    return ` (exit ${String(error.code)})`;
  }
  return "";
}

async function verifyRoomExpiryCoverage(root, runProcess) {
  let output;
  try {
    output = await runProcess(root);
  } catch (error) {
    throw new Error(
      `Room expiry integration coverage failed${subprocessExitDetail(error)}`,
      { cause: error },
    );
  }

  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    throw new Error("Room expiry integration report was not valid JSON", {
      cause: error,
    });
  }

  if (
    report === null ||
    typeof report !== "object" ||
    !Array.isArray(report.testResults)
  ) {
    throw new Error("Room expiry integration report was malformed");
  }

  const assertionResults = [];
  for (const testResult of report.testResults) {
    if (
      testResult === null ||
      typeof testResult !== "object" ||
      !Array.isArray(testResult.assertionResults)
    ) {
      throw new Error("Room expiry integration report was malformed");
    }
    for (const assertion of testResult.assertionResults) {
      if (
        assertion === null ||
        typeof assertion !== "object" ||
        typeof assertion.fullName !== "string" ||
        typeof assertion.status !== "string"
      ) {
        throw new Error("Room expiry integration report was malformed");
      }
      assertionResults.push(assertion);
    }
  }

  for (const fullName of requiredExpiryTests) {
    const matches = assertionResults.filter(
      (assertion) => assertion.fullName === fullName,
    );
    if (matches.length === 0) {
      throw new Error(`Missing required expiry test: ${fullName}`);
    }
    if (matches.length > 1) {
      throw new Error(`Duplicate required expiry test: ${fullName}`);
    }
    if (matches[0].status !== "passed") {
      throw new Error(
        `Required expiry test did not pass: ${fullName} (${matches[0].status})`,
      );
    }
  }
  if (report.success !== true) {
    throw new Error("Room expiry integration report did not succeed");
  }

  return `${requiredExpiryTests.length} required RoomDurableObject expiry tests passed`;
}

async function runCheck(results, check, operation) {
  try {
    results.push({ check, status: "PASS", detail: await operation() });
  } catch (error) {
    results.push({ check, status: "FAIL", detail: messageFrom(error) });
  }
}

export function createPreflight({
  readTextFile = readFile,
  runExpiryTestProcess = executeExpiryTestProcess,
} = {}) {
  return async function runPreflight(root, nodeVersion) {
    const results = [];
    let configSnapshot;
    let configSnapshotError;

    try {
      configSnapshot = await readConfigs(root, readTextFile);
    } catch (error) {
      configSnapshotError = error;
    }

    const requireConfigSnapshot = () => {
      if (configSnapshotError !== undefined) {
        throw configSnapshotError;
      }
      return configSnapshot;
    };

    await runCheck(results, "Node.js", async () => {
      const major = parseNodeMajor(nodeVersion);
      if (major < 22) {
        throw new Error(
          `Node.js 22 or newer is required; received ${nodeVersion}`,
        );
      }
      return `${nodeVersion} (major ${major})`;
    });
    await runCheck(results, "Lockfile", async () => {
      await requireFile(
        resolve(root, "package-lock.json"),
        "package-lock.json is required",
      );
      return "package-lock.json";
    });
    await runCheck(results, "Wrangler parity", () =>
      verifyWranglerParity(requireConfigSnapshot()),
    );
    await runCheck(results, "Canonical origin", () =>
      verifyCanonicalOrigin(requireConfigSnapshot()),
    );
    await runCheck(results, "Static assets", () =>
      verifyStaticAssets(root, requireConfigSnapshot()),
    );
    await runCheck(results, "Milestone bindings", () =>
      verifyMilestoneBindings(requireConfigSnapshot()),
    );
    await runCheck(results, "Project documents", async () => {
      await verifyProjectDocs(root);
      return "canonical context verified";
    });
    await runCheck(results, "Room expiry", () =>
      verifyRoomExpiryCoverage(root, runExpiryTestProcess),
    );

    if (results.some((result) => result.status === "FAIL")) {
      throw new PreflightError(results);
    }
    return results;
  };
}

export const runPreflight = createPreflight();

function printResults(results) {
  console.table(results, ["check", "status", "detail"]);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  try {
    printResults(await runPreflight(process.cwd(), process.version));
  } catch (error) {
    if (error instanceof PreflightError) {
      printResults(error.results);
      console.error("Release preflight failed");
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
