import { describe, expect, it, vi } from "vitest";

import {
  runIOSProtocolFixtureValidator,
  validateIOSProtocolFixtures,
} from "./validate-ios-protocol-fixtures.mjs";

describe("iOS protocol fixture validator", () => {
  it("runs the protocol fixture test and returns its exit status", () => {
    const spawn = vi.fn(() => ({ error: undefined, status: 0 }));

    expect(validateIOSProtocolFixtures({ spawn, cwd: "/repo" })).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      "pnpm",
      [
        "--filter",
        "@cipher-party/protocol",
        "exec",
        "vitest",
        "run",
        "src/ios-fixtures.test.ts",
      ],
      { cwd: "/repo", encoding: "utf8", stdio: "inherit" },
    );
  });

  it("uses a failing status when the child has no exit status", () => {
    const spawn = vi.fn(() => ({ error: undefined, status: null }));

    expect(validateIOSProtocolFixtures({ spawn, cwd: "/repo" })).toBe(1);
  });

  it("reports a launch error and returns a failing status", () => {
    const spawn = vi.fn(() => ({ error: new Error("private detail") }));
    const reportError = vi.fn();

    expect(
      validateIOSProtocolFixtures({ spawn, cwd: "/repo", reportError }),
    ).toBe(1);
    expect(reportError).toHaveBeenCalledWith(
      "Unable to launch the iOS protocol fixture validator.",
    );
  });

  it("runs the validator when invoked as the CLI entrypoint", () => {
    const validate = vi.fn(() => 7);
    const setExitCode = vi.fn();

    runIOSProtocolFixtureValidator({
      argv: ["node", "/repo/validate-ios-protocol-fixtures.mjs"],
      modulePath: "/repo/validate-ios-protocol-fixtures.mjs",
      validate,
      setExitCode,
    });

    expect(validate).toHaveBeenCalledOnce();
    expect(setExitCode).toHaveBeenCalledWith(7);

    const previousExitCode = process.exitCode;
    try {
      runIOSProtocolFixtureValidator({
        argv: ["node", "/repo/validate-ios-protocol-fixtures.mjs"],
        modulePath: "/repo/validate-ios-protocol-fixtures.mjs",
        validate,
      });
      expect(process.exitCode).toBe(7);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
