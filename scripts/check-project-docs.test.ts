import { describe, expect, it } from "vitest";
import { verifyProjectDocs } from "./check-project-docs.mjs";

describe("verifyProjectDocs", () => {
  it("finds every canonical project context document", async () => {
    await expect(verifyProjectDocs(process.cwd())).resolves.toEqual({
      agentInstructions: true,
      snapshot: true,
      roadmap: true,
      activePlan: true,
      approvedSpec: true
    });
  });
});
