import { describe, expect, it } from "vitest";

import { ApiError, createRoom, joinRoom, requestConnectionTicket } from "./api";

const limited: typeof fetch = async () =>
  Response.json(
    { error: { code: "rate_limited", message: "Untrusted server copy" } },
    {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    },
  );

describe("public admission errors", () => {
  it.each([401, 404, 429])(
    "preserves status and retry timing with non-JSON HTTP %s",
    async (status) => {
      await expect(
        requestConnectionTicket(
          { code: "ABC123", playerId: "player", seatToken: "a".repeat(43) },
          async () =>
            new Response("not JSON", {
              status,
              headers: { "Retry-After": "60" },
            }),
        ),
      ).rejects.toMatchObject({
        status,
        retryAfterMs: status === 429 ? 60_000 : null,
      });
    },
  );

  it.each([
    ["create", () => createRoom("Host", limited)],
    ["join", () => joinRoom("ABC123", "Guest", false, limited)],
    [
      "ticket",
      () =>
        requestConnectionTicket(
          { code: "ABC123", playerId: "player", seatToken: "a".repeat(43) },
          limited,
        ),
    ],
  ] as const)(
    "gives %s a friendly local rate-limit message",
    async (_name, action) => {
      const error = await action().catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        code: "rate_limited",
        status: 429,
        retryAfterMs: 60_000,
        message: "Too many attempts. Please wait a minute and try again.",
      });
    },
  );

  it("accepts only canonical future HTTP dates for retry timing", async () => {
    const now = Date.UTC(2026, 8, 11, 19, 0, 0);
    const action = (retryAfter: string) =>
      requestConnectionTicket(
        { code: "ABC123", playerId: "player", seatToken: "a".repeat(43) },
        async () =>
          Response.json(
            { error: { code: "rate_limited", message: "Untrusted" } },
            { status: 429, headers: { "Retry-After": retryAfter } },
          ),
        () => now,
      ).catch((value: unknown) => value);

    await expect(
      action("Fri, 11 Sep 2026 19:01:00 GMT"),
    ).resolves.toMatchObject({ retryAfterMs: 60_000 });
    for (const invalid of [
      "-1",
      "1.5",
      "1e3",
      "Infinity",
      "9007199254740992",
      "9007199254741",
      "",
      "09/11/2026",
      "Fri, 11 Sep 2026 18:59:59 GMT",
      "Fri, 32 Sep 2026 19:01:00 GMT",
      "Thu, 11 Sep 2026 19:01:00 GMT",
    ]) {
      await expect(action(invalid)).resolves.toMatchObject({
        retryAfterMs: null,
      });
    }
  });
});
