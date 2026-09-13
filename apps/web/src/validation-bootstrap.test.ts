// @vitest-environment node
import { expect, it, vi } from "vitest";

// A separate Node test environment keeps this one-time bootstrap and the Zod
// singleton isolated from the jsdom component tests and their eager schemas.
it("initializes strict protocol parsing without even probing dynamic Function", async () => {
  let attempts = 0;
  const blockedFunction = () => {
    attempts += 1;
    throw new EvalError("Dynamic evaluation is blocked");
  };
  vi.stubGlobal(
    "Function",
    new Proxy(globalThis.Function, {
      apply: blockedFunction,
      construct: blockedFunction,
    }),
  );
  try {
    await import("./validation-bootstrap");
    const { ClientCommandSchema, ServerMessageSchema } =
      await import("@cipher-party/protocol");

    expect(
      ClientCommandSchema.parse({
        type: "submit_clue",
        word: " sky ",
        count: 2,
      }),
    ).toEqual({ type: "submit_clue", word: "sky", count: 2 });
    for (const command of [
      { type: "submit_clue", word: "", count: 2 },
      { type: "submit_clue", word: "sky", count: 10 },
      { type: "submit_clue", word: "sky", count: 2, extra: true },
    ]) {
      expect(ClientCommandSchema.safeParse(command).success).toBe(false);
    }

    const message = {
      type: "command_result",
      commandId: "00000000-0000-4000-8000-000000000001",
      result: { ok: true, revision: 1 },
    };
    expect(ServerMessageSchema.parse(message)).toEqual(message);
    for (const invalid of [
      { ...message, result: { ok: true, revision: -1 } },
      { ...message, result: { ok: true, revision: 1, extra: true } },
      { ...message, extra: true },
    ]) {
      expect(ServerMessageSchema.safeParse(invalid).success).toBe(false);
    }
    expect(attempts).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
