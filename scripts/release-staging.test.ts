import { describe, expect, it, vi } from "vitest";
import { pnpmCommand, runRelease, releaseCommand } from "./release-staging.mjs";

const commit = "a".repeat(40);
const state = () => ({ commit, dirty: false });
describe("source-bound release", () => {
  it("uses long, bounded shell-free subprocess execution and discards subprocess output on failure", async () => {
    const run = vi.fn(async () => {
      throw new Error("sensitive output");
    });
    await expect(
      releaseCommand(
        run,
        process.execPath,
        ["/tools/pnpm.cjs", "run", "check:release"],
        "/repo",
        "Release gate",
      ),
    ).rejects.toThrow(/^Release gate failed/u);
    expect(run.mock.calls[0]).toMatchObject([
      process.execPath,
      ["/tools/pnpm.cjs", "run", "check:release"],
      { cwd: "/repo", timeout: 1_800_000 },
    ]);
  });
  it("gates clean exact source before passing its SHA to deploy", async () => {
    const events: string[] = [];
    const source = vi.fn(async () => {
      events.push("source");
      return state();
    });
    const gate = vi.fn(async () => {
      events.push("gate");
    });
    const deploy = vi.fn(async (input) => {
      events.push("deploy");
      return input;
    });
    await runRelease({ source, gate, deploy });
    expect(events).toEqual(["source", "gate", "source", "deploy"]);
    expect(deploy.mock.calls[0]?.[0]).toMatchObject({
      expectedCommit: commit,
      dryRun: false,
    });
  });
  it.each(["gate", "initial dirt", "later dirt", "later revision"])(
    "never deploys after %s",
    async (reason) => {
      let reads = 0;
      const source = async () => {
        reads++;
        return {
          commit:
            reason === "later revision" && reads > 1 ? "b".repeat(40) : commit,
          dirty:
            reason === "initial dirt" || (reason === "later dirt" && reads > 1),
        };
      };
      const gate = async () => {
        if (reason === "gate") throw new Error("sensitive subprocess detail");
      };
      const deploy = vi.fn();
      const result = await runRelease({ source, gate, deploy }).then(
        () => "accepted",
        (error: Error) => error.message,
      );
      expect(result).not.toBe("accepted");
      expect(result).not.toContain("sensitive subprocess detail");
      expect(deploy.mock.calls.length).toBe(0);
    },
  );
  it("keeps explicit dry-run non-uploading and independent of a live release pass", async () => {
    const gate = vi.fn();
    const deploy = vi.fn();
    await runRelease({ dryRun: true, gate, deploy });
    expect(gate.mock.calls.length).toBe(0);
    expect(deploy.mock.calls[0]?.[0]).toMatchObject({ dryRun: true });
  });
  it("validates npm_execpath and distinguishes Node-launched JS from absolute native entries", async () => {
    const exists = async () => true;
    expect(await pnpmCommand({ entry: "/tools/pnpm.cjs", exists })).toEqual({
      command: process.execPath,
      args: ["/tools/pnpm.cjs"],
    });
    expect(await pnpmCommand({ entry: "/tools/pnpm", exists })).toEqual({
      command: "/tools/pnpm",
      args: [],
    });
    for (const entry of [undefined, "pnpm", "./pnpm.cjs"])
      await expect(pnpmCommand({ entry, exists })).rejects.toThrow(/via pnpm/u);
    await expect(
      pnpmCommand({ entry: "/missing/pnpm", exists: async () => false }),
    ).rejects.toThrow(/via pnpm/u);
  });
});
