import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyProjectDocs } from "./check-project-docs.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function createCanonicalFixture(
  snapshotContents: string,
  { includeActivePlan = true }: { includeActivePlan?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "cipher-party-docs-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "docs/superpowers/plans"), { recursive: true });
  await mkdir(join(root, "docs/superpowers/specs"), { recursive: true });
  await writeFile(
    root + "/AGENTS.md",
    "Read docs/PROJECT_SNAPSHOT.md before editing.\n",
  );
  await writeFile(root + "/docs/PROJECT_SNAPSHOT.md", snapshotContents);
  await writeFile(
    root + "/docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
    "# Roadmap\n",
  );
  await writeFile(
    root + "/docs/superpowers/plans/2026-09-07-creative-integration.md",
    "# Historical plan\n",
  );
  if (includeActivePlan) {
    await writeFile(
      root + "/docs/superpowers/plans/2026-09-11-audit-hardening.md",
      "# Active plan\n",
    );
  }
  await writeFile(
    root + "/docs/superpowers/specs/2026-08-30-cipher-party-design.md",
    "# Spec\n",
  );
  return root;
}

describe("verifyProjectDocs", () => {
  it("finds every canonical project context document", async () => {
    await expect(verifyProjectDocs(process.cwd())).resolves.toEqual({
      agentInstructions: true,
      snapshot: true,
      roadmap: true,
      activePlan: true,
      approvedSpec: true,
    });
  });

  it("fails when the project snapshot omits a required canonical link", async () => {
    const root = await createCanonicalFixture(
      [
        "**Active plan:** docs/superpowers/plans/2026-09-11-audit-hardening.md",
        "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
      ].join("\n"),
    );

    await expect(verifyProjectDocs(root)).rejects.toThrow(
      "Project snapshot does not link the roadmap, active plan, and approved spec",
    );
  });

  it("follows the single active plan declared by the snapshot", async () => {
    const root = await createCanonicalFixture(
      [
        "**Active plan:** docs/superpowers/plans/2026-09-11-audit-hardening.md",
        "**Historical plan:** docs/superpowers/plans/2026-09-07-creative-integration.md",
        "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
        "docs/superpowers/specs/2026-08-30-cipher-party-design.md",
      ].join("\n"),
    );

    await expect(verifyProjectDocs(root)).resolves.toEqual({
      agentInstructions: true,
      snapshot: true,
      roadmap: true,
      activePlan: true,
      approvedSpec: true,
    });
  });

  it("fails when the declared active plan target is missing", async () => {
    const root = await createCanonicalFixture(
      [
        "**Active plan:** docs/superpowers/plans/2026-09-11-audit-hardening.md",
        "**Historical plan:** docs/superpowers/plans/2026-09-07-creative-integration.md",
        "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
        "docs/superpowers/specs/2026-08-30-cipher-party-design.md",
      ].join("\n"),
      { includeActivePlan: false },
    );

    await expect(verifyProjectDocs(root)).rejects.toThrow();
  });

  it.each([
    ["an absolute path", "/docs/superpowers/plans/active.md"],
    ["path traversal", "docs/superpowers/plans/../active.md"],
    ["a noncanonical plan path", "docs/plans/active.md"],
  ])("rejects %s in the active plan declaration", async (_, activePlan) => {
    const root = await createCanonicalFixture(
      [
        `**Active plan:** ${activePlan}`,
        "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
        "docs/superpowers/specs/2026-08-30-cipher-party-design.md",
      ].join("\n"),
    );

    await expect(verifyProjectDocs(root)).rejects.toThrow(
      "Project snapshot must declare one canonical active plan",
    );
  });

  it("rejects multiple active plan declarations", async () => {
    const root = await createCanonicalFixture(
      [
        "**Active plan:** docs/superpowers/plans/2026-09-11-audit-hardening.md",
        "**Active plan:** docs/superpowers/plans/2026-09-12-next.md",
        "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
        "docs/superpowers/specs/2026-08-30-cipher-party-design.md",
      ].join("\n"),
    );

    await expect(verifyProjectDocs(root)).rejects.toThrow(
      "Project snapshot must declare one canonical active plan",
    );
  });
});
