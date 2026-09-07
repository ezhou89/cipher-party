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

async function createCanonicalFixture(snapshotContents: string) {
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
    "# Plan\n",
  );
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
        "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
        "docs/superpowers/specs/2026-08-30-cipher-party-design.md",
      ].join("\n"),
    );

    await expect(verifyProjectDocs(root)).rejects.toThrow(
      "Project snapshot does not link the roadmap, active plan, and approved spec",
    );
  });
});
