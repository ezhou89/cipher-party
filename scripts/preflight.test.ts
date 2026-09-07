import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPreflight } from "./preflight.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

interface FixtureOptions {
  includeBuild?: boolean;
  includeLockfile?: boolean;
  includeRooms?: boolean;
  productionAssetsDirectory?: string;
  canonicalOrigin?: string;
  developmentCompatibilityDate?: string;
  developmentCanonicalOrigin?: string;
  developmentRoomClass?: string;
  developmentExtra?: Record<string, unknown>;
  testMigrationClass?: string;
  testExtra?: Record<string, unknown>;
  productionExtra?: Record<string, unknown>;
}

const requiredExpiryTests = [
  "RoomDurableObject persistence reschedules expiry only after accepted revision-changing activity",
  "RoomDurableObject inactivity alarm reschedules the unchanged deadline when an alarm arrives early",
  "RoomDurableObject inactivity alarm expires at the exact deadline and is empty on an idempotent repeat",
  "RoomDurableObject inactivity alarm expires after the deadline and is empty on an idempotent repeat",
  "RoomDurableObject inactivity alarm closes every accepted socket with the room-expired close frame",
  "RoomDurableObject inactivity alarm uses the approved 24-hour inactivity duration",
  "RoomDurableObject inactivity alarm keeps the integration anchor safely ahead of real process time",
];

const futureAnchorExpiryTest =
  "RoomDurableObject inactivity alarm keeps the integration anchor safely ahead of real process time";

function expiryReport(
  assertionResults = requiredExpiryTests.map((fullName) => ({
    fullName,
    status: "passed",
  })),
) {
  return JSON.stringify({
    success: true,
    testResults: [{ assertionResults }],
  });
}

function configSource(input: {
  name: string;
  compatibilityDate: string;
  canonicalOrigin: string;
  includeRooms: boolean;
  roomClass: string;
  migrationClass: string;
  assetsDirectory?: string;
  extra?: Record<string, unknown>;
}) {
  return `${JSON.stringify(
    {
      name: input.name,
      main: "src/index.ts",
      compatibility_date: input.compatibilityDate,
      vars: { CANONICAL_ORIGIN: input.canonicalOrigin },
      durable_objects: {
        bindings: input.includeRooms
          ? [{ name: "ROOMS", class_name: input.roomClass }]
          : [],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: [input.migrationClass] }],
      ...(input.assetsDirectory === undefined
        ? {}
        : { assets: { directory: input.assetsDirectory } }),
      ...input.extra,
    },
    null,
    2,
  ).replace(/\n}/g, ",\n}")}\n`;
}

async function createPreflightFixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "cipher-party-preflight-"));
  temporaryRoots.push(root);

  await Promise.all([
    mkdir(join(root, "apps/worker"), { recursive: true }),
    mkdir(join(root, "docs/superpowers/plans"), { recursive: true }),
    mkdir(join(root, "docs/superpowers/specs"), { recursive: true }),
  ]);

  if (options.includeBuild ?? true) {
    await mkdir(join(root, "apps/web/dist"), { recursive: true });
    await writeFile(
      join(root, "apps/web/dist/index.html"),
      "<!doctype html>\n",
    );
  }

  const canonicalOrigin = options.canonicalOrigin ?? "http://127.0.0.1:5173";
  await Promise.all([
    writeFile(
      join(root, "AGENTS.md"),
      "Read docs/PROJECT_SNAPSHOT.md before editing.\n",
    ),
    writeFile(
      join(root, "docs/PROJECT_SNAPSHOT.md"),
      [
        "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
        "docs/superpowers/plans/2026-09-07-creative-integration.md",
        "docs/superpowers/specs/2026-08-30-cipher-party-design.md",
      ].join("\n"),
    ),
    writeFile(
      join(root, "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md"),
      "# Roadmap\n",
    ),
    writeFile(
      join(root, "docs/superpowers/plans/2026-09-07-creative-integration.md"),
      "# Plan\n",
    ),
    writeFile(
      join(root, "docs/superpowers/specs/2026-08-30-cipher-party-design.md"),
      "# Spec\n",
    ),
    writeFile(
      join(root, "apps/worker/wrangler.jsonc"),
      `// Production configuration\n${configSource({
        name: "cipher-party",
        compatibilityDate: "2026-08-30",
        canonicalOrigin,
        includeRooms: options.includeRooms ?? true,
        roomClass: "RoomDurableObject",
        migrationClass: "RoomDurableObject",
        assetsDirectory: options.productionAssetsDirectory ?? "../web/dist",
        extra: options.productionExtra,
      })}`,
    ),
    writeFile(
      join(root, "apps/worker/wrangler.dev.jsonc"),
      configSource({
        name: "cipher-party",
        compatibilityDate: options.developmentCompatibilityDate ?? "2026-08-30",
        canonicalOrigin: options.developmentCanonicalOrigin ?? canonicalOrigin,
        includeRooms: true,
        roomClass: options.developmentRoomClass ?? "RoomDurableObject",
        migrationClass: "RoomDurableObject",
        extra: options.developmentExtra,
      }),
    ),
    writeFile(
      join(root, "apps/worker/wrangler.test.jsonc"),
      configSource({
        name: "cipher-party-test",
        compatibilityDate: "2026-08-30",
        canonicalOrigin,
        includeRooms: true,
        roomClass: "RoomDurableObject",
        migrationClass: options.testMigrationClass ?? "RoomDurableObject",
        extra: options.testExtra,
      }),
    ),
  ]);

  if (options.includeLockfile ?? true) {
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  }

  return root;
}

function fixturePreflight(
  runExpiryTestProcess = vi
    .fn<(root: string) => Promise<string>>()
    .mockResolvedValue(expiryReport()),
) {
  return {
    run: createPreflight({ runExpiryTestProcess }),
    runExpiryTestProcess,
  };
}

describe("runPreflight", () => {
  it("passes every release invariant for a valid JSONC fixture", async () => {
    const root = await createPreflightFixture();
    const { run, runExpiryTestProcess } = fixturePreflight();

    const result = await run(root, "v22.0.0");

    expect(result).toEqual([
      expect.objectContaining({ check: "Node.js", status: "PASS" }),
      expect.objectContaining({ check: "Lockfile", status: "PASS" }),
      expect.objectContaining({ check: "Wrangler parity", status: "PASS" }),
      expect.objectContaining({ check: "Canonical origin", status: "PASS" }),
      expect.objectContaining({ check: "Static assets", status: "PASS" }),
      expect.objectContaining({ check: "Milestone bindings", status: "PASS" }),
      expect.objectContaining({ check: "Project documents", status: "PASS" }),
      expect.objectContaining({ check: "Room expiry", status: "PASS" }),
    ]);
    expect(result.at(-1)?.detail).toBe(
      "7 required RoomDurableObject expiry tests passed",
    );
    expect(runExpiryTestProcess).toHaveBeenCalledOnce();
    expect(runExpiryTestProcess).toHaveBeenCalledWith(root);
  });

  it("launches expiry Vitest without a package-manager executable on PATH", async () => {
    const root = await createPreflightFixture();
    const vitestDirectory = join(root, "node_modules/vitest");
    const expectedArguments = [
      "run",
      "test/room-durable-object.test.ts",
      "--config",
      "vitest.config.ts",
      "--reporter=json",
    ];
    await mkdir(vitestDirectory, { recursive: true });
    await writeFile(
      join(vitestDirectory, "vitest.mjs"),
      [
        'import { realpathSync } from "node:fs";',
        `const expectedArguments = ${JSON.stringify(expectedArguments)};`,
        "const actualArguments = process.argv.slice(2);",
        "if (JSON.stringify(actualArguments) !== JSON.stringify(expectedArguments)) {",
        "  throw new Error(`Unexpected arguments: ${JSON.stringify(actualArguments)}`);",
        "}",
        `if (realpathSync(process.cwd()) !== realpathSync(${JSON.stringify(join(root, "apps/worker"))})) {`,
        "  throw new Error(`Unexpected cwd: ${process.cwd()}`);",
        "}",
        `process.stdout.write(${JSON.stringify(expiryReport())});`,
      ].join("\n"),
    );

    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await createPreflight()(root, "v22.0.0");

      expect(result.at(-1)).toEqual({
        check: "Room expiry",
        status: "PASS",
        detail: "7 required RoomDurableObject expiry tests passed",
      });
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

  it("reads each Wrangler config exactly once into one run snapshot", async () => {
    const root = await createPreflightFixture();
    const readTextFile = vi.fn((path: string) => readFile(path, "utf8"));
    const run = createPreflight({
      readTextFile,
      runExpiryTestProcess: vi.fn().mockResolvedValue(expiryReport()),
    });

    await run(root, "v22.0.0");

    for (const relativePath of [
      "apps/worker/wrangler.jsonc",
      "apps/worker/wrangler.dev.jsonc",
      "apps/worker/wrangler.test.jsonc",
    ]) {
      expect(
        readTextFile.mock.calls.filter(([path]) => path.endsWith(relativePath)),
      ).toHaveLength(1);
    }
    expect(readTextFile).toHaveBeenCalledTimes(3);
  });

  it("fails a fixture whose production config is missing the ROOMS binding", async () => {
    const root = await createPreflightFixture({ includeRooms: false });
    const { run } = fixturePreflight();

    await expect(run(root, "v22.0.0")).rejects.toThrow(
      "wrangler.jsonc must bind ROOMS to RoomDurableObject",
    );
  });

  it("rejects unsupported Node versions and a missing lockfile", async () => {
    const root = await createPreflightFixture({ includeLockfile: false });
    const { run } = fixturePreflight();

    await expect(run(root, "v21.9.0")).rejects.toThrow(
      "Node.js 22 or newer is required",
    );
    await expect(run(root, "not-a-version")).rejects.toThrow(
      "Could not parse Node.js version",
    );
    await expect(run(root, "v22.0.0")).rejects.toThrow(
      "pnpm-lock.yaml is required",
    );
  });

  it.each([
    [
      "compatibility date",
      { developmentCompatibilityDate: "2026-08-31" },
      "compatibility_date must match",
    ],
    [
      "canonical origin",
      { developmentCanonicalOrigin: "https://different.example.test" },
      "CANONICAL_ORIGIN must match",
    ],
    [
      "ROOMS class",
      { developmentRoomClass: "DifferentRoom" },
      "wrangler.dev.jsonc must bind ROOMS to RoomDurableObject",
    ],
    [
      "v1 SQLite migration",
      { testMigrationClass: "DifferentRoom" },
      "wrangler.test.jsonc v1 migration must declare RoomDurableObject",
    ],
  ])(
    "rejects configuration parity drift in the %s",
    async (_label, options, expectedMessage) => {
      const root = await createPreflightFixture(options);
      const { run } = fixturePreflight();

      await expect(run(root, "v22.0.0")).rejects.toThrow(expectedMessage);
    },
  );

  it.each([
    [
      "missing with an unrelated same-count pass",
      [
        ...requiredExpiryTests
          .filter((fullName) => fullName !== futureAnchorExpiryTest)
          .map((fullName) => ({ fullName, status: "passed" })),
        {
          fullName:
            "RoomDurableObject inactivity alarm unrelated replacement behavior",
          status: "passed",
        },
      ],
      "Missing required expiry test",
    ],
    [
      "skipped",
      [
        ...requiredExpiryTests
          .filter((fullName) => fullName !== futureAnchorExpiryTest)
          .map((fullName) => ({ fullName, status: "passed" })),
        { fullName: futureAnchorExpiryTest, status: "skipped" },
      ],
      "Required expiry test did not pass",
    ],
    [
      "failed",
      [
        ...requiredExpiryTests
          .filter((fullName) => fullName !== futureAnchorExpiryTest)
          .map((fullName) => ({ fullName, status: "passed" })),
        { fullName: futureAnchorExpiryTest, status: "failed" },
      ],
      "Required expiry test did not pass",
    ],
    [
      "duplicated",
      [
        ...requiredExpiryTests
          .filter((fullName) => fullName !== futureAnchorExpiryTest)
          .map((fullName) => ({ fullName, status: "passed" })),
        { fullName: futureAnchorExpiryTest, status: "passed" },
        { fullName: futureAnchorExpiryTest, status: "passed" },
      ],
      "Duplicate required expiry test",
    ],
  ])(
    "rejects the future-anchor identity when it is %s",
    async (_label, assertionResults, expectedMessage) => {
      const root = await createPreflightFixture();
      const { run } = fixturePreflight(
        vi.fn().mockResolvedValue(expiryReport(assertionResults)),
      );

      await expect(run(root, "v22.0.0")).rejects.toThrow(expectedMessage);
    },
  );

  it.each([
    "ftp://example.test",
    "https://example.test/path",
    "https://example.test?query=yes",
    "https://example.test#fragment",
    "https://user@example.test",
    "https://example.test/",
  ])("rejects a non-origin CANONICAL_ORIGIN: %s", async (canonicalOrigin) => {
    const root = await createPreflightFixture({ canonicalOrigin });
    const { run } = fixturePreflight();

    await expect(run(root, "v22.0.0")).rejects.toThrow(
      "CANONICAL_ORIGIN must be an absolute canonical http(s) origin",
    );
  });

  it("rejects static assets outside the web build", async () => {
    const root = await createPreflightFixture({
      productionAssetsDirectory: "../../public",
    });
    const { run } = fixturePreflight();

    await expect(run(root, "v22.0.0")).rejects.toThrow(
      "Worker assets must resolve to apps/web/dist",
    );
  });

  it("rejects a missing web build", async () => {
    const root = await createPreflightFixture({ includeBuild: false });
    const { run } = fixturePreflight();

    await expect(run(root, "v22.0.0")).rejects.toThrow(
      "Worker static assets are missing; run pnpm run build",
    );
  });

  it.each([
    [
      "R2 in production",
      { productionExtra: { r2_buckets: [{ binding: "PACK_ASSETS" }] } },
    ],
    [
      "Workers AI in a production environment",
      { productionExtra: { env: { preview: { ai: { binding: "AI" } } } } },
    ],
    [
      "Workers AI in development",
      { developmentExtra: { ai: { binding: "AI" } } },
    ],
    [
      "R2 in a development environment",
      {
        developmentExtra: {
          env: { preview: { r2_buckets: [{ binding: "PACK_ASSETS" }] } },
        },
      },
    ],
    ["R2 in test", { testExtra: { r2_buckets: [{ binding: "PACK_ASSETS" }] } }],
    [
      "Workers AI in a test environment",
      { testExtra: { env: { preview: { ai: { binding: "AI" } } } } },
    ],
  ])("rejects an early %s binding", async (_label, options) => {
    const root = await createPreflightFixture(options);
    const { run } = fixturePreflight();

    await expect(run(root, "v22.0.0")).rejects.toThrow(
      "R2 and Workers AI bindings belong to Milestone 2",
    );
  });

  it("fails when canonical documents fail their existing verifier", async () => {
    const root = await createPreflightFixture();
    await rm(
      join(root, "docs/superpowers/specs/2026-08-30-cipher-party-design.md"),
    );
    const { run } = fixturePreflight();

    await expect(run(root, "v22.0.0")).rejects.toThrow("Project documents");
  });

  it.each([
    [
      "missing",
      [
        ...requiredExpiryTests.slice(1).map((fullName) => ({
          fullName,
          status: "passed",
        })),
        {
          fullName:
            "RoomDurableObject inactivity alarm unrelated replacement behavior",
          status: "passed",
        },
      ],
      "Missing required expiry test",
    ],
    [
      "skipped",
      [
        ...requiredExpiryTests.map((fullName, index) => ({
          fullName,
          status: index === 1 ? "skipped" : "passed",
        })),
        {
          fullName:
            "RoomDurableObject inactivity alarm unrelated replacement behavior",
          status: "passed",
        },
      ],
      "Required expiry test did not pass",
    ],
    [
      "failed",
      requiredExpiryTests.map((fullName, index) => ({
        fullName,
        status: index === 2 ? "failed" : "passed",
      })),
      "Required expiry test did not pass",
    ],
    [
      "duplicated",
      [
        ...requiredExpiryTests.map((fullName) => ({
          fullName,
          status: "passed",
        })),
        { fullName: requiredExpiryTests[0], status: "passed" },
      ],
      "Duplicate required expiry test",
    ],
  ])(
    "rejects a %s required expiry-test identity",
    async (_label, assertionResults, expectedMessage) => {
      const root = await createPreflightFixture();
      const { run } = fixturePreflight(
        vi.fn().mockResolvedValue(expiryReport(assertionResults)),
      );

      await expect(run(root, "v22.0.0")).rejects.toThrow(expectedMessage);
    },
  );

  it("rejects malformed fresh Vitest JSON", async () => {
    const root = await createPreflightFixture();
    const { run } = fixturePreflight(
      vi.fn().mockResolvedValue("not a Vitest JSON report"),
    );

    await expect(run(root, "v22.0.0")).rejects.toThrow(
      "Room expiry integration report was not valid JSON",
    );
  });

  it("rejects a structurally malformed Vitest report", async () => {
    const root = await createPreflightFixture();
    const { run } = fixturePreflight(
      vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ success: true, testResults: [{}] }),
        ),
    );

    await expect(run(root, "v22.0.0")).rejects.toThrow(
      "Room expiry integration report was malformed",
    );
  });

  it("reports a raw expiry subprocess failure without leaking its output", async () => {
    const root = await createPreflightFixture();
    const subprocessError = Object.assign(
      new Error("SECRET CHILD OUTPUT SHOULD NOT APPEAR"),
      { code: 17 },
    );
    const { run } = fixturePreflight(
      vi.fn().mockRejectedValue(subprocessError),
    );

    await expect(run(root, "v22.0.0")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(
          "Room expiry integration coverage failed (exit 17)",
        ) &&
        !error.message.includes("SECRET CHILD OUTPUT SHOULD NOT APPEAR"),
    );
  });
});
