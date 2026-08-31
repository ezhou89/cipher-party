import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  productionExtra?: Record<string, unknown>;
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
        "docs/superpowers/plans/2026-08-30-connected-classic.md",
        "docs/superpowers/specs/2026-08-30-cipher-party-design.md",
      ].join("\n"),
    ),
    writeFile(
      join(root, "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md"),
      "# Roadmap\n",
    ),
    writeFile(
      join(root, "docs/superpowers/plans/2026-08-30-connected-classic.md"),
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
      }),
    ),
  ]);

  if (options.includeLockfile ?? true) {
    await writeFile(join(root, "package-lock.json"), "{}\n");
  }

  return root;
}

function fixturePreflight(
  verifyRoomExpiryCoverage = vi
    .fn<(root: string) => Promise<string>>()
    .mockResolvedValue("room alarm integration coverage passed"),
) {
  return {
    run: createPreflight({ verifyRoomExpiryCoverage }),
    verifyRoomExpiryCoverage,
  };
}

describe("runPreflight", () => {
  it("passes every release invariant for a valid JSONC fixture", async () => {
    const root = await createPreflightFixture();
    const { run, verifyRoomExpiryCoverage } = fixturePreflight();

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
    expect(verifyRoomExpiryCoverage).toHaveBeenCalledOnce();
    expect(verifyRoomExpiryCoverage).toHaveBeenCalledWith(root);
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
      "package-lock.json is required",
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
      "Worker static assets are missing; run npm run build",
    );
  });

  it.each([
    ["R2", { productionExtra: { r2_buckets: [{ binding: "PACK_ASSETS" }] } }],
    ["Workers AI", { developmentExtra: { ai: { binding: "AI" } } }],
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

  it("fails when the real room-expiry coverage command fails", async () => {
    const root = await createPreflightFixture();
    const { run } = fixturePreflight(
      vi.fn().mockRejectedValue(new Error("expiry integration failed")),
    );

    await expect(run(root, "v22.0.0")).rejects.toThrow(
      "expiry integration failed",
    );
  });
});
