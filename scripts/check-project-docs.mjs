import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const paths = {
  agentInstructions: "AGENTS.md",
  snapshot: "docs/PROJECT_SNAPSHOT.md",
  roadmap: "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
  activePlan: "docs/superpowers/plans/2026-09-07-creative-integration.md",
  approvedSpec: "docs/superpowers/specs/2026-08-30-cipher-party-design.md",
};

export async function verifyProjectDocs(root) {
  const result = {};
  for (const [name, relativePath] of Object.entries(paths)) {
    await access(resolve(root, relativePath));
    result[name] = true;
  }

  const agents = await readFile(resolve(root, paths.agentInstructions), "utf8");
  if (!agents.includes(paths.snapshot)) {
    throw new Error(
      "AGENTS.md does not require the canonical project snapshot",
    );
  }

  const snapshot = await readFile(resolve(root, paths.snapshot), "utf8");
  if (
    !snapshot.includes(paths.roadmap) ||
    !snapshot.includes(paths.activePlan) ||
    !snapshot.includes(paths.approvedSpec)
  ) {
    throw new Error(
      "Project snapshot does not link the roadmap, active plan, and approved spec",
    );
  }
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  await verifyProjectDocs(process.cwd());
  console.log("Canonical project documents verified");
}
