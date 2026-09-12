import { describe, expect, it, vi } from "vitest";
import {
  checkMessageBudget,
  hasSocketCapacity,
} from "../src/room/connection-budget";

describe("connection budgets", () => {
  it.each([
    [63, 3, true],
    [64, 3, false],
    [63, 4, false],
  ])(
    "checks %s room and %s seat attachments including closing sockets",
    (roomCount, seatCount, expected) => {
      const closing = { readyState: WebSocket.CLOSING } as WebSocket;
      const state = {
        getWebSockets: (tag?: string) =>
          Array.from(
            { length: Number(tag === undefined ? roomCount : seatCount) },
            () => closing,
          ),
      };
      expect(hasSocketCapacity(state, "player")).toBe(expected);
    },
  );

  it("allows missing local bindings but fails closed for either missing HTTPS binding", async () => {
    const room = { limit: vi.fn(async () => ({ success: true })) };
    const seat = { limit: vi.fn(async () => ({ success: true })) };
    expect(
      await checkMessageBudget(
        { CANONICAL_ORIGIN: "http://127.0.0.1:5173" },
        "ABC123",
        "player",
      ),
    ).toBe(true);
    expect(
      await checkMessageBudget(
        { CANONICAL_ORIGIN: "https://example.invalid", COMMAND_BY_ROOM: room },
        "ABC123",
        "player",
      ),
    ).toBe(false);
    expect(
      await checkMessageBudget(
        { CANONICAL_ORIGIN: "https://example.invalid", COMMAND_BY_SEAT: seat },
        "ABC123",
        "player",
      ),
    ).toBe(false);
    expect(room.limit).toHaveBeenCalledOnce();
    expect(seat.limit).toHaveBeenCalledOnce();
  });

  it("settles both counters even when one fails before the other finishes", async () => {
    let finish!: (value: { success: boolean }) => void;
    const room = {
      limit: vi.fn(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    let settled = false;
    const outcome = checkMessageBudget(
      {
        CANONICAL_ORIGIN: "https://example.invalid",
        COMMAND_BY_SEAT: {
          limit: async () => {
            throw new Error("unavailable");
          },
        },
        COMMAND_BY_ROOM: room,
      },
      "ABC123",
      "player",
    ).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(room.limit).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    finish({ success: true });
    expect(await outcome).toBe(false);
  });

  it("uses stable hashed identities shared across sockets, isolated by seat, room, origin, and purpose", async () => {
    const seat = {
      limit: vi
        .fn<(input: { key: string }) => Promise<{ success: boolean }>>()
        .mockResolvedValue({ success: true }),
    };
    const room = {
      limit: vi
        .fn<(input: { key: string }) => Promise<{ success: boolean }>>()
        .mockResolvedValue({ success: true }),
    };
    const env = {
      CANONICAL_ORIGIN: "https://example.invalid",
      COMMAND_BY_SEAT: seat,
      COMMAND_BY_ROOM: room,
    };
    await checkMessageBudget(env, "ABC123", "player-one");
    await checkMessageBudget({ ...env }, "ABC123", "player-one");
    await checkMessageBudget(env, "ABC123", "player-two");
    await checkMessageBudget(env, "DEF456", "player-one");
    await checkMessageBudget(
      { ...env, CANONICAL_ORIGIN: "https://other.invalid" },
      "ABC123",
      "player-one",
    );
    const seatKeys = seat.limit.mock.calls.map(([input]) => input.key);
    const roomKeys = room.limit.mock.calls.map(([input]) => input.key);
    expect(seatKeys[0]).toBe(seatKeys[1]);
    expect(roomKeys[0]).toBe(roomKeys[1]);
    expect(seatKeys[0]).not.toBe(seatKeys[2]);
    expect(roomKeys[0]).toBe(roomKeys[2]);
    expect(new Set(seatKeys).size).toBe(4);
    expect(new Set(roomKeys).size).toBe(3);
    for (const key of [...seatKeys, ...roomKeys]) {
      expect(key).toMatch(/^cipher-party:command:(?:seat|room):[a-f0-9]{64}$/u);
      expect(key).not.toContain("ABC123");
      expect(key).not.toContain("player-one");
    }
  });
});
