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
        message: "Too many attempts. Please wait a minute and try again.",
      });
    },
  );
});
