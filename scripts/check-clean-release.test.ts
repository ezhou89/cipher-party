import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { checkCleanRelease } from "./check-clean-release.mjs";

const commit = "a".repeat(40);
function fixture() {
  const directory = join(tmpdir(), "cipher-party-release-test");
  const source = vi.fn(async () => ({ commit, dirty: false }));
  const run = vi.fn(async () => ({ stdout: "" }));
  const remove = vi.fn(async () => undefined);
  return {
    root: "/source/repository",
    source,
    run,
    remove,
    makeTemp: async () => directory,
    pnpmEntry: process.execPath,
    exists: async () => true,
    directory,
  };
}
describe("isolated committed release gate", () => {
  it("reports cleanup failure safely without hiding an earlier gate failure", async () => {
    const setup = fixture();
    setup.remove.mockImplementation(async () => {
      throw new Error("private cleanup detail");
    });
    await expect(checkCleanRelease(setup)).rejects.toThrow(
      /^Temporary release checkout cleanup failed$/u,
    );
    setup.run.mockImplementation(async (...args: unknown[]) => {
      if ((args[1] as string[]).includes("check:release"))
        throw new Error("private gate detail");
      return { stdout: "" };
    });
    await expect(checkCleanRelease(setup)).rejects.toThrow(
      /^Clean release gate failed/u,
    );
  });
  it("clones committed input only and rejects untracked source before cloning", async () => {
    const root = await mkdtemp(join(tmpdir(), "cipher-party-source-test-"));
    const execute = promisify(execFile);
    const git = (args: string[]) => execute("git", args, { cwd: root });
    try {
      await git(["init", "--quiet"]);
      await writeFile(join(root, ".gitignore"), "ignored.txt\n");
      await writeFile(join(root, "tracked.txt"), "committed fixture");
      await git(["add", ".gitignore", "tracked.txt"]);
      await git([
        "-c",
        "user.name=Release Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ]);
      await writeFile(join(root, "ignored.txt"), "ignored scratch");
      const inspected: string[] = [];
      const run = async (
        command: string,
        args: string[],
        options: { cwd: string },
      ) => {
        if (command === "git") return execute(command, args, options);
        inspected.push(args.join(" "));
        expect(await readFile(join(options.cwd, "tracked.txt"), "utf8")).toBe(
          "committed fixture",
        );
        await expect(
          readFile(join(options.cwd, "ignored.txt")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        return { stdout: "" };
      };
      await checkCleanRelease({ root, run, pnpmEntry: process.execPath });
      expect(inspected).toEqual([
        "install --frozen-lockfile",
        "run check:release",
      ]);
      await writeFile(join(root, "untracked.txt"), "untracked scratch");
      const makeTemp = vi.fn();
      await expect(
        checkCleanRelease({ root, run, makeTemp, pnpmEntry: process.execPath }),
      ).rejects.toThrow(/clean/u);
      expect(makeTemp).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("clones without hardlinks, detaches exact SHA, frozen-installs and runs only inner gate", async () => {
    const setup = fixture();
    await checkCleanRelease(setup);
    const calls = setup.run.mock.calls as unknown as Array<
      [string, string[], { cwd: string }]
    >;
    expect(calls[0]?.[1]).toEqual([
      "clone",
      "--no-hardlinks",
      "--no-checkout",
      "--",
      setup.root,
      join(setup.directory, "checkout"),
    ]);
    expect(calls[1]?.[1]).toEqual(["checkout", "--detach", commit]);
    expect(calls[2]?.[1]).toEqual(["install", "--frozen-lockfile"]);
    expect(calls[3]?.[1]).toEqual(["run", "check:release"]);
    expect(
      calls.some(
        ([, args]) =>
          args.includes("deploy") || args.includes("check:release:clean"),
      ),
    ).toBe(false);
    expect(setup.remove.mock.calls).toEqual([[setup.directory]]);
  });
  it.each(["initial dirt", "wrong revision", "later dirt", "install", "gate"])(
    "fails closed and cleans only its own directory after %s",
    async (reason) => {
      const setup = fixture();
      let reads = 0;
      setup.source.mockImplementation(async () => {
        reads++;
        return {
          commit:
            reason === "wrong revision" && reads > 1 ? "b".repeat(40) : commit,
          dirty:
            reason === "initial dirt" || (reason === "later dirt" && reads > 2),
        };
      });
      setup.run.mockImplementation(async (...args: unknown[]) => {
        const commandArgs = args[1] as string[];
        if (
          (reason === "install" && commandArgs.includes("install")) ||
          (reason === "gate" && commandArgs.includes("check:release"))
        )
          throw new Error("sensitive subprocess output");
        return { stdout: "" };
      });
      const outcome = await checkCleanRelease(setup).then(
        () => "accepted",
        (error: Error) => error.message,
      );
      expect(outcome).not.toBe("accepted");
      expect(outcome).not.toContain("sensitive subprocess output");
      expect(setup.remove.mock.calls).toEqual(
        reason === "initial dirt" ? [] : [[setup.directory]],
      );
    },
  );
  it("never removes an unsafe injected temporary path", async () => {
    const setup = fixture();
    setup.makeTemp = async () => "/";
    await expect(checkCleanRelease(setup)).rejects.toThrow(/temporary/u);
    expect(setup.remove.mock.calls.length).toBe(0);
    expect(setup.run.mock.calls.length).toBe(0);
  });
});
