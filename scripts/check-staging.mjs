import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { URL, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import {
  defaultRun,
  localCli,
  projectRoot,
  readStagingConfig,
  roomsNamespace,
  runChecked,
  sourceState,
} from "./staging-common.mjs";

const requiredHeaders = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' wss://staging.oddlyuseful.studio; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=()",
  "X-Robots-Tag": "noindex, nofollow",
};

// A default Node request missed the browser-only HTML rewrite in live smoke.
// Use the diagnosed desktop navigation shape; assets and APIs keep plain GETs.
const htmlNavigationHeaders = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36",
};

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function checkHeaders(response, url, cacheControl) {
  for (const [header, expected] of Object.entries(requiredHeaders)) {
    requireValue(
      response.headers.get(header) === expected,
      `Required header ${header} missing or incorrect at ${url}`,
    );
  }
  requireValue(
    response.headers.get("Strict-Transport-Security") ===
      (url.startsWith("https:") ? "max-age=31536000" : null),
    `Required HTTPS-only HSTS header incorrect at ${url}`,
  );
  if (cacheControl !== undefined)
    requireValue(
      response.headers.get("Cache-Control") === cacheControl,
      `Required ${cacheControl} header incorrect at ${url}`,
    );
}

function activeDeployment(deployments) {
  requireValue(
    Array.isArray(deployments) && deployments.length > 0,
    "No active staging deployment found",
  );
  requireValue(
    deployments.every(
      (entry) =>
        typeof entry.id === "string" &&
        Number.isFinite(Date.parse(entry.created_on)),
    ),
    "Invalid deployment metadata",
  );
  const latest = [...deployments].sort(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on),
  )[0];
  requireValue(
    Array.isArray(latest.versions) &&
      latest.versions.length === 1 &&
      latest.versions[0].percentage === 100,
    "Staging traffic must serve one version at 100%",
  );
  requireValue(
    /^[a-f0-9-]{36}$/u.test(latest.versions[0].version_id),
    "Invalid active staging version ID",
  );
  return { id: latest.id, version: latest.versions[0].version_id };
}

function checkVersion(version, active, config, commit, expectedNamespace) {
  requireValue(
    version.id === active.version,
    "Active staging version mismatch",
  );
  requireValue(
    version.annotations?.["workers/message"] === `source:${commit}`,
    "Deployed source commit mismatch",
  );
  const runtime = version.resources?.script_runtime;
  requireValue(
    runtime?.compatibility_date === config.compatibility_date &&
      runtime?.migration_tag === "v1",
    "Deployed compatibility date or SQLite migration mismatch",
  );
  requireValue(
    runtime.assets?.not_found_handling === "single-page-application" &&
      runtime.assets?.raw_run_worker_first === true,
    "Deployed SPA assets must run the Worker first for every request",
  );
  const bindings = version.resources?.bindings;
  requireValue(
    Array.isArray(bindings) && bindings.length === 8,
    "Deployed bindings must contain only staging origin, ROOMS, ASSETS and five admission limiters",
  );
  const binding = (name, type) => {
    const found = bindings.filter((entry) => entry.name === name);
    requireValue(
      found.length === 1 && found[0].type === type,
      `Missing or incorrect deployed ${name} binding`,
    );
    return found[0];
  };
  requireValue(
    binding("CANONICAL_ORIGIN", "plain_text").text ===
      config.vars.CANONICAL_ORIGIN,
    "Deployed canonical origin mismatch",
  );
  const rooms = binding("ROOMS", "durable_object_namespace");
  requireValue(
    rooms.class_name === "RoomDurableObject" &&
      rooms.namespace_id === expectedNamespace &&
      !rooms.script_name,
    "Deployed ROOMS class or namespace mismatch",
  );
  binding("ASSETS", "assets");
  for (const expected of config.ratelimits) {
    const actual = binding(expected.name, "ratelimit");
    requireValue(
      String(actual.namespace_id) === expected.namespace_id &&
        isDeepStrictEqual(actual.simple, expected.simple),
      `Deployed ${expected.name} namespace or rate budget mismatch`,
    );
  }
}

async function builtFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      result.push(
        ...(await builtFiles(resolve(directory, entry.name), `${path}/`)),
      );
    else if (
      entry.isFile() &&
      (path === "index.html" || /\.(js|css)$/u.test(path))
    )
      result.push(path);
  }
  return result.sort();
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function checkStaging({
  root = projectRoot,
  run = defaultRun,
  fetchImpl = globalThis.fetch,
  expectedCommit,
  expectedVersion,
  expectedRoomsNamespace = roomsNamespace,
} = {}) {
  const { config, path } = await readStagingConfig(root);
  const commit = expectedCommit ?? (await sourceState(root, run)).commit;
  requireValue(
    /^[a-f0-9]{40}$/u.test(commit),
    "Expected commit must be a full 40-character Git SHA",
  );
  requireValue(
    /^[a-f0-9]{32}$/u.test(expectedRoomsNamespace),
    "Expected ROOMS namespace must be a 32-character ID",
  );
  if (expectedVersion !== undefined)
    requireValue(
      /^[a-f0-9-]{36}$/u.test(expectedVersion),
      "Expected version must be a Worker version UUID",
    );
  const worker = resolve(root, "apps/worker");
  const cli = localCli("wrangler", "bin/wrangler.js", worker);
  async function metadata(args) {
    const { stdout } = await runChecked(
      run,
      process.execPath,
      [cli, ...args, "--config", path, "--json"],
      worker,
      "Authenticated staging metadata check",
    );
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(
        "Authenticated staging metadata check failed: invalid JSON",
      );
    }
  }
  const active = activeDeployment(await metadata(["deployments", "list"]));
  if (expectedVersion !== undefined)
    requireValue(
      active.version === expectedVersion,
      "Expected active version mismatch",
    );
  checkVersion(
    await metadata(["versions", "view", active.version]),
    active,
    config,
    commit,
    expectedRoomsNamespace,
  );

  const origin = config.vars.CANONICAL_ORIGIN;
  async function probe(url, headers) {
    try {
      return await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: globalThis.AbortSignal.timeout(15_000),
        ...(headers === undefined ? {} : { headers }),
      });
    } catch {
      throw new Error(
        `HTTP probe failed at ${url} (15-second timeout or network error)`,
      );
    }
  }
  const httpOrigin = origin.replace("https:", "http:");
  const redirectUrl = `${httpOrigin}/`;
  const redirect = await probe(redirectUrl);
  requireValue(
    redirect.status === 308 &&
      redirect.headers.get("Location") === `${origin}/`,
    "HTTP app must redirect 308 to same-host HTTPS without serving content",
  );
  requireValue(
    (await redirect.arrayBuffer()).byteLength === 0,
    "HTTP app redirect must not serve content",
  );
  checkHeaders(redirect, redirectUrl, "no-store");
  const insecureApiUrl = `${httpOrigin}/api/health`;
  const insecureApi = await probe(insecureApiUrl);
  requireValue(
    insecureApi.status === 426 && !insecureApi.headers.has("Location"),
    "HTTP API must reject with 426 without redirecting credentials",
  );
  checkHeaders(insecureApi, insecureApiUrl, "no-store");
  const healthUrl = `${origin}/api/health`;
  const health = await probe(healthUrl);
  requireValue(
    health.status === 200 &&
      health.headers.get("Content-Type")?.includes("application/json"),
    "Incorrect HTTPS health response",
  );
  checkHeaders(health, healthUrl, "no-store");
  let healthBody;
  try {
    healthBody = await health.json();
  } catch {
    throw new Error("Invalid HTTPS health JSON");
  }
  requireValue(
    isDeepStrictEqual(healthBody, { ok: true, service: "cipher-party" }),
    "Incorrect HTTPS health response body",
  );
  const missingUrl = `${origin}/api/staging-attestation-missing`;
  const missing = await probe(missingUrl);
  requireValue(
    missing.status === 404 &&
      missing.headers.get("Content-Type")?.includes("application/json"),
    "Unmatched API must return JSON 404, not the SPA",
  );
  checkHeaders(missing, missingUrl, "no-store");

  const dist = resolve(root, "apps/web/dist");
  const files = await builtFiles(dist);
  requireValue(
    files.includes("index.html") &&
      files.some((file) => file.endsWith(".js")) &&
      files.some((file) => file.endsWith(".css")),
    "Missing built index/JS/CSS; run pnpm run build",
  );
  await Promise.all(
    files.map(async (file) => {
      const url = new URL(file === "index.html" ? "/" : `/${file}`, origin)
        .href;
      const response = await probe(
        url,
        file === "index.html" ? htmlNavigationHeaders : undefined,
      );
      requireValue(
        response.status === 200,
        `Bundle response status mismatch for ${file}`,
      );
      checkHeaders(
        response,
        url,
        file === "index.html" ? "no-store, no-transform" : undefined,
      );
      const mediaType = response.headers
        .get("Content-Type")
        ?.split(";", 1)[0]
        ?.trim();
      requireValue(
        file === "index.html"
          ? mediaType === "text/html"
          : file.endsWith(".css")
            ? mediaType === "text/css"
            : ["text/javascript", "application/javascript"].includes(mediaType),
        `Bundle content type mismatch for ${file}`,
      );
      const [local, live] = await Promise.all([
        readFile(resolve(dist, file)),
        response.arrayBuffer(),
      ]);
      requireValue(
        hash(local) === hash(new Uint8Array(live)),
        `Bundle hash mismatch for ${file}`,
      );
    }),
  );
  const after = activeDeployment(await metadata(["deployments", "list"]));
  requireValue(
    isDeepStrictEqual(active, after),
    "Active deployment changed during attestation; rerun the check",
  );
  return {
    commit,
    version: active.version,
    roomsNamespace: expectedRoomsNamespace,
    files: files.length,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { values } = parseArgs({
      options: {
        "expected-commit": { type: "string" },
        "expected-version": { type: "string" },
        "expected-rooms-namespace": { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(
        "Usage: pnpm run check:staging [--expected-commit SHA] [--expected-version UUID] [--expected-rooms-namespace ID]\nRead-only: default source is HEAD; default ROOMS namespace is the recorded staging namespace. Build locally first.",
      );
    } else {
      const result = await checkStaging({
        expectedCommit: values["expected-commit"],
        expectedVersion: values["expected-version"],
        expectedRoomsNamespace: values["expected-rooms-namespace"],
      });
      console.log(
        `PASS staging: source ${result.commit}; version ${result.version} at 100%; ROOMS ${result.roomsNamespace}; ${result.files} index/JS/CSS files match SHA-256; transport, health, headers and bindings verified`,
      );
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Staging attestation failed",
    );
    process.exitCode = 1;
  }
}
