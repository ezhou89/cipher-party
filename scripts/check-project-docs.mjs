import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const paths = {
  agentInstructions: "AGENTS.md",
  snapshot: "docs/PROJECT_SNAPSHOT.md",
  roadmap: "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
  approvedSpec: "docs/superpowers/specs/2026-08-30-cipher-party-design.md",
};

const activePlanDeclaration = /^\*\*Active plan:\*\*[ \t]*(.*)[ \t]*$/gmu;
const canonicalActivePlan =
  /^docs\/superpowers\/plans\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/u;

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
    !snapshot.includes(paths.approvedSpec)
  ) {
    throw new Error(
      "Project snapshot does not link the roadmap, active plan, and approved spec",
    );
  }

  const declarations = [...snapshot.matchAll(activePlanDeclaration)].map(
    (match) => match[1].trim(),
  );
  if (declarations.length !== 1 || !canonicalActivePlan.test(declarations[0])) {
    throw new Error(
      "Project snapshot must declare one canonical active plan under docs/superpowers/plans",
    );
  }
  await access(resolve(root, declarations[0]));
  result.activePlan = true;
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  await verifyProjectDocs(process.cwd());
  console.log("Canonical project documents verified");
}
