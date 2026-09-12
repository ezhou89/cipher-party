import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkStaging } from "./check-staging.mjs";
import { deployStaging } from "./deploy-staging.mjs";

const ORIGIN = "https://staging.oddlyuseful.studio";
const COMMIT = "a".repeat(40);
const VERSION = "11111111-2222-4333-8444-555555555555";
const NAMESPACE = "f2766441dfa24d10bef55dd8ee4f5599";
const temporaryRoots: string[] = [];
const ratelimits = [
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
  {
    name: "CONNECT_BY_IP",
    namespace_id: "2026091101",
    simple: { limit: 120, period: 60 },
  },
  {
    name: "CONNECT_BY_ROOM",
    namespace_id: "2026091102",
    simple: { limit: 240, period: 60 },
  },
  {
    name: "COMMAND_BY_SEAT",
    namespace_id: "2026091103",
    simple: { limit: 30, period: 10 },
  },
  {
    name: "COMMAND_BY_ROOM",
    namespace_id: "2026091104",
    simple: { limit: 120, period: 10 },
  },
];
const config = {
  name: "cipher-party-staging",
  account_id: "7514dcd2dc3f092c0420d66eb65a383e",
  main: "src/index.ts",
  compatibility_date: "2026-08-30",
  workers_dev: false,
  preview_urls: false,
  send_metrics: false,
  routes: [{ pattern: "staging.oddlyuseful.studio", custom_domain: true }],
  vars: { CANONICAL_ORIGIN: ORIGIN },
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
  ratelimits,
};
const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' wss://staging.oddlyuseful.studio; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=()",
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=31536000",
};
const files = new Map([
  [
    "index.html",
    "<!doctype html><script src='/assets/index-one.js'></script><link rel='stylesheet' href='/assets/index-one.css'>",
  ],
  ["assets/index-one.js", "import('./lazy-two.js')"],
  ["assets/lazy-two.js", "export default 'lazy'"],
  ["assets/index-one.css", "body{color:black}"],
]);

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cipher-party-staging-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "apps/worker"), { recursive: true });
  await mkdir(join(root, "apps/web/dist/assets"), { recursive: true });
  for (const directory of [
    "node_modules",
    "apps/worker/node_modules",
    "apps/web/node_modules",
  ]) {
    await symlink(resolve(directory), join(root, directory), "junction");
  }
  await writeFile(
    join(root, "apps/worker/wrangler.staging.jsonc"),
    JSON.stringify(config),
  );
  for (const [path, bytes] of files)
    await writeFile(join(root, "apps/web/dist", path), bytes);
  const deployments = [
    {
      id: "old",
      created_on: "2026-09-06T00:00:00Z",
      versions: [{ version_id: "old", percentage: 100 }],
    },
    {
      id: "active",
      created_on: "2026-09-07T00:00:00Z",
      versions: [{ version_id: VERSION, percentage: 100 }],
    },
  ];
  const version = {
    id: VERSION,
    number: 2,
    metadata: {
      created_on: "2026-09-07T00:00:00Z",
      source: "wrangler",
      has_preview: false,
    },
    annotations: {
      "workers/message": `source:${COMMIT}`,
      "workers/triggered_by": "upload",
    },
    resources: {
      script: {
        handlers: ["fetch"],
        named_handlers: [{ name: "RoomDurableObject", handlers: ["class"] }],
      },
      script_runtime: {
        compatibility_date: "2026-08-30",
        migration_tag: "v1",
        assets: {
          not_found_handling: "single-page-application",
          raw_run_worker_first: true,
        },
      },
      bindings: [
        { name: "CANONICAL_ORIGIN", type: "plain_text", text: ORIGIN },
        {
          name: "ROOMS",
          type: "durable_object_namespace",
          class_name: "RoomDurableObject",
          namespace_id: NAMESPACE,
        },
        { name: "ASSETS", type: "assets" },
        ...ratelimits.map((limit) => ({ ...limit, type: "ratelimit" })),
      ],
    },
  };
  const run = vi.fn<
    (
      command: string,
      args: string[],
      options: { cwd: string },
    ) => Promise<{ stdout: string }>
  >(async (command, args) => {
    if (command === "git")
      return { stdout: args[0] === "rev-parse" ? `${COMMIT}\n` : "" };
    if (args.includes("deployments"))
      return { stdout: JSON.stringify(deployments) };
    if (args.includes("versions")) return { stdout: JSON.stringify(version) };
    return { stdout: "" };
  });
  const respond = (input: string) => {
    const url = new URL(input);
    const headers = new Headers(securityHeaders);
    if (url.protocol === "http:") {
      headers.delete("Strict-Transport-Security");
      headers.set("Cache-Control", "no-store");
      if (url.pathname === "/") headers.set("Location", ORIGIN + "/");
      return new Response(null, {
        status: url.pathname === "/" ? 308 : 426,
        headers,
      });
    }
    if (url.pathname.startsWith("/api")) {
      headers.set("Cache-Control", "no-store");
      return Response.json(
        url.pathname === "/api/health"
          ? { ok: true, service: "cipher-party" }
          : { error: { code: "invalid_request", message: "Invalid request" } },
        { status: url.pathname === "/api/health" ? 200 : 404, headers },
      );
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    headers.set(
      "Content-Type",
      file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    if (file === "index.html")
      headers.set("Cache-Control", "no-store, no-transform");
    return new Response(files.get(file), { headers });
  };
  const fetchImpl = vi.fn<
    (input: string, init: RequestInit) => Promise<Response>
  >(async (input) => respond(input));
  return { root, run, fetchImpl, respond, version, deployments };
}

describe("read-only staging attestation", () => {
  it.each(["no-store", "no-transform", "public, no-transform"])(
    "rejects HTML cache policy %s that permits caching or transformation",
    async (cacheControl) => {
      const setup = await fixture();
      setup.fetchImpl.mockImplementation(async (url) => {
        const response = setup.respond(url);
        if (url === `${ORIGIN}/`)
          response.headers.set("Cache-Control", cacheControl);
        return response;
      });
      await expect(
        checkStaging({ ...setup, expectedCommit: COMMIT }),
      ).rejects.toThrow(/header/i);
    },
  );

  it("attests the newest 100% version and every index/JS/CSS byte without room mutations", async () => {
    const setup = await fixture();
    const result = await checkStaging({
      ...setup,
      expectedCommit: COMMIT,
      expectedVersion: VERSION,
      expectedRoomsNamespace: NAMESPACE,
    });
    expect(result).toMatchObject({
      commit: COMMIT,
      version: VERSION,
      roomsNamespace: NAMESPACE,
      files: 4,
    });
    expect(
      setup.fetchImpl.mock.calls.map(([url]) => new URL(url).pathname),
    ).toContain("/assets/lazy-two.js");
    for (const [url, init] of setup.fetchImpl.mock.calls) {
      expect(["http://staging.oddlyuseful.studio", ORIGIN]).toContain(
        new URL(url).origin,
      );
      expect(init).toMatchObject({
        method: "GET",
        redirect: "manual",
        cache: "no-store",
      });
      expect(url).not.toMatch(/\/rooms(?:\/|$)|ticket/);
    }
    const cliCalls = setup.run.mock.calls.filter(
      ([command]) => command !== "git",
    );
    expect(cliCalls.length).toBeGreaterThanOrEqual(3);
    for (const [command, args, options] of cliCalls) {
      expect(command).toBe(process.execPath);
      expect(args[0]).toMatch(/[/\\]wrangler\.js$/u);
      expect(args).toContain("--json");
      expect(args).toContain(
        join(setup.root, "apps/worker/wrangler.staging.jsonc"),
      );
      expect(args).not.toContain("deploy");
      expect(options.cwd).toBe(join(setup.root, "apps/worker"));
    }
  });

  it("requests HTML as a browser navigation without applying document headers to APIs or assets", async () => {
    const setup = await fixture();
    await checkStaging({ ...setup, expectedCommit: COMMIT });
    const htmlCalls = setup.fetchImpl.mock.calls.filter(
      ([url]) => url === `${ORIGIN}/`,
    );
    expect(htmlCalls).toHaveLength(1);
    const headers = new Headers(htmlCalls[0]?.[1].headers);
    expect(headers.get("Accept")).toBe(
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    );
    expect(headers.get("User-Agent")).toMatch(/^Mozilla\/5\.0 .+Chrome\//u);
    for (const [url, init] of setup.fetchImpl.mock.calls) {
      if (url !== `${ORIGIN}/`) {
        expect(new Headers(init.headers).get("Accept")).toBeNull();
        expect(new Headers(init.headers).get("User-Agent")).toBeNull();
      }
    }
  });

  it("rejects HTML rewritten only for browser navigation requests", async () => {
    const setup = await fixture();
    setup.fetchImpl.mockImplementation(async (url, init) => {
      const response = setup.respond(url);
      const headers = new Headers(init.headers);
      if (
        url === `${ORIGIN}/` &&
        headers.get("Accept")?.includes("text/html") &&
        headers.get("User-Agent")?.startsWith("Mozilla/5.0")
      ) {
        return new Response(
          `${files.get("index.html")}<script src="https://analytics.invalid/beacon.js"></script>`,
          { headers: response.headers },
        );
      }
      return response;
    });
    await expect(
      checkStaging({ ...setup, expectedCommit: COMMIT }),
    ).rejects.toThrow("Bundle hash mismatch for index.html");
  });

  it.each([
    "index.html",
    "assets/index-one.js",
    "assets/lazy-two.js",
    "assets/index-one.css",
  ])("rejects different live bytes for %s", async (file) => {
    const setup = await fixture();
    setup.fetchImpl.mockImplementation(async (url) => {
      const response = setup.respond(url);
      if (url === `${ORIGIN}/${file === "index.html" ? "" : file}`)
        return new Response("changed", { headers: response.headers });
      return response;
    });
    await expect(
      checkStaging({ ...setup, expectedCommit: COMMIT }),
    ).rejects.toThrow(/bundle.*mismatch/i);
  });

  it.each(Object.keys(securityHeaders))(
    "rejects a missing %s on a live asset",
    async (header) => {
      const setup = await fixture();
      setup.fetchImpl.mockImplementation(async (url) => {
        const response = setup.respond(url);
        if (url.endsWith(".js")) response.headers.delete(header);
        return response;
      });
      await expect(
        checkStaging({ ...setup, expectedCommit: COMMIT }),
      ).rejects.toThrow(/header/i);
    },
  );

  it.each([
    [
      "HTTP content",
      "http://staging.oddlyuseful.studio/",
      () => new Response("insecure"),
    ],
    [
      "HTTP API redirect",
      "http://staging.oddlyuseful.studio/api/health",
      () => Response.redirect(`${ORIGIN}/api/health`, 308),
    ],
    [
      "wrong health",
      `${ORIGIN}/api/health`,
      () => Response.json({ ok: false }),
    ],
    [
      "SPA API fallback",
      `${ORIGIN}/api/staging-attestation-missing`,
      () => new Response("app"),
    ],
  ] as const)("rejects %s", async (_name, failingUrl, response) => {
    const setup = await fixture();
    setup.fetchImpl.mockImplementation(async (url) =>
      url === failingUrl ? response() : setup.respond(url),
    );
    await expect(
      checkStaging({ ...setup, expectedCommit: COMMIT }),
    ).rejects.toThrow();
  });

  it.each([
    "commit",
    "version",
    "traffic",
    "origin",
    "namespace",
    "migration",
    "assets",
    "worker-first",
    "rate budget",
    "extra binding",
  ])("rejects incorrect deployed %s", async (field) => {
    const setup = await fixture();
    const { version, deployments } = setup;
    if (field === "commit")
      version.annotations["workers/message"] = `source:${"b".repeat(40)}`;
    if (field === "version") version.id = "other";
    if (field === "traffic") deployments[1]!.versions[0]!.percentage = 90;
    if (field === "origin")
      Object.assign(version.resources.bindings[0]!, {
        text: "https://attacker.invalid",
      });
    if (field === "namespace")
      Object.assign(version.resources.bindings[1]!, {
        namespace_id: "b".repeat(32),
      });
    if (field === "migration")
      version.resources.script_runtime.migration_tag = "v2";
    if (field === "assets") version.resources.bindings.splice(2, 1);
    if (field === "worker-first")
      version.resources.script_runtime.assets.raw_run_worker_first = false;
    if (field === "rate budget")
      Object.assign(version.resources.bindings[3]!, {
        simple: { limit: 999, period: 60 },
      });
    if (field === "extra binding")
      version.resources.bindings.push({ name: "AI", type: "ai" });
    await expect(
      checkStaging({
        ...setup,
        expectedCommit: COMMIT,
        expectedVersion: VERSION,
      }),
    ).rejects.toThrow();
  });

  it("honors explicit namespace expectations and detects changes during HTTP checks", async () => {
    const setup = await fixture();
    await expect(
      checkStaging({
        ...setup,
        expectedCommit: COMMIT,
        expectedRoomsNamespace: "b".repeat(32),
      }),
    ).rejects.toThrow(/namespace/i);
    setup.fetchImpl.mockImplementation(async (url) => {
      setup.deployments[1]!.id = "changed";
      return setup.respond(url);
    });
    await expect(
      checkStaging({ ...setup, expectedCommit: COMMIT }),
    ).rejects.toThrow(/changed/i);
  });

  it("does not include subprocess credentials or stderr in public failures", async () => {
    const setup = await fixture();
    setup.run.mockRejectedValue(
      Object.assign(new Error("Authorization: Bearer private-token"), {
        stderr: "private-token",
        code: 1,
      }),
    );
    const result = await checkStaging({
      ...setup,
      expectedCommit: COMMIT,
    }).catch((error: unknown) => error);
    expect(String(result)).toContain("failed");
    expect(String(result)).not.toContain("private-token");
  });
});

describe("deterministic staging deployment", () => {
  it("builds with local JavaScript CLIs through Node before a strict source-tagged deployment", async () => {
    const setup = await fixture();
    await deployStaging({ root: setup.root, run: setup.run });
    const calls = setup.run.mock.calls.filter(([command]) => command !== "git");
    expect(calls.length).toBe(6);
    for (const [command] of calls) expect(command).toBe(process.execPath);
    for (const [, args] of calls.slice(0, 4))
      expect(args).toEqual([
        expect.stringMatching(/typescript[/\\]bin[/\\]tsc$/u),
        "--noEmit",
      ]);
    expect(calls[4]?.[1]).toEqual([
      expect.stringMatching(/vite[/\\]bin[/\\]vite\.js$/u),
      "build",
    ]);
    expect(calls[5]?.[1]).toEqual([
      expect.stringMatching(/wrangler[/\\]bin[/\\]wrangler\.js$/u),
      "deploy",
      "--strict",
      "--config",
      join(setup.root, "apps/worker/wrangler.staging.jsonc"),
      "--message",
      `source:${COMMIT}`,
    ]);
  });

  it("allows a labeled dirty dry run but refuses a dirty live deployment", async () => {
    const setup = await fixture();
    const cleanRun = setup.run.getMockImplementation()!;
    setup.run.mockImplementation(async (command, args, options) =>
      command === "git" && args[0] === "status"
        ? { stdout: " M apps/web/src/main.tsx\n" }
        : cleanRun(command, args, options),
    );
    await expect(
      deployStaging({ root: setup.root, run: setup.run }),
    ).rejects.toThrow(/clean/i);
    expect(
      setup.run.mock.calls.some(([, args]) => args.includes("deploy")),
    ).toBe(false);
    await deployStaging({ root: setup.root, run: setup.run, dryRun: true });
    expect(setup.run.mock.calls.at(-1)?.[1]).toContain("--dry-run");
    expect(setup.run.mock.calls.at(-1)?.[1]).toContain(
      `source:${COMMIT} (dirty dry run)`,
    );
  });

  it.each([
    "name",
    "account_id",
    "routes",
    "durable_objects",
    "migrations",
    "assets",
    "ratelimits",
    "workers_dev",
    "preview_urls",
    "r2_buckets",
    "env",
  ])(
    "refuses unsafe staging config field %s before building or deploying",
    async (field) => {
      const setup = await fixture();
      await writeFile(
        join(setup.root, "apps/worker/wrangler.staging.jsonc"),
        JSON.stringify({
          ...config,
          [field]:
            field === "workers_dev" || field === "preview_urls"
              ? true
              : "wrong",
        }),
      );
      await expect(
        deployStaging({ root: setup.root, run: setup.run }),
      ).rejects.toThrow(/config/i);
      expect(setup.run).not.toHaveBeenCalled();
    },
  );

  it("never deploys after a build failure", async () => {
    const setup = await fixture();
    const cleanRun = setup.run.getMockImplementation()!;
    setup.run.mockImplementation(async (command, args, options) => {
      if (args.includes("build")) throw new Error("build failed");
      return cleanRun(command, args, options);
    });
    await expect(
      deployStaging({ root: setup.root, run: setup.run }),
    ).rejects.toThrow(/failed/i);
    expect(
      setup.run.mock.calls.some(([, args]) => args.includes("deploy")),
    ).toBe(false);
  });
});
