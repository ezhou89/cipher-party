import type { ClientCommand, CommandEnvelope } from "@cipher-party/protocol";
import { env, runInDurableObject } from "cloudflare:test";
import { parse as parseJsonc } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import devConfigText from "../wrangler.dev.jsonc?raw";
import prodConfigText from "../wrangler.jsonc?raw";
import testConfigText from "../wrangler.test.jsonc?raw";
import type {
  RoomDurableObject,
  RoomInitializationInput
} from "../src/room/room-durable-object";
import type { RoomActor } from "../src/room/room-state";
import { ROOM_IDLE_TTL_MS, type IRoomStorage } from "../src/room/room-storage";

function testUuid(index: number): string {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function envelope(
  expectedRevision: number,
  command: ClientCommand,
  commandId = testUuid(1)
): CommandEnvelope {
  return {
    protocolVersion: 1,
    commandId,
    expectedRevision,
    command
  };
}

function hostActor(playerId = "host-1"): RoomActor {
  return { playerId, hostAuthority: true };
}

function roomInitialization(code: string): RoomInitializationInput {
  return {
    code,
    hostPlayerId: "host-1",
    hostDisplayName: "Host",
    inviteUrl: `https://cipher.party/${code}`,
    seatTokenHash: "seat-hash-1",
    hostTokenHash: "host-hash-1",
    boardSeed: "seed-12345"
  };
}

type RunInDO = <T, R = void>(
  stub: unknown,
  callback: (instance: T, state: DurableObjectState) => R | Promise<R>
) => Promise<R>;

const runInRoomDO = runInDurableObject as unknown as RunInDO;

describe("RoomDurableObject Persistence and Invariants", () => {
  it("persists an accepted command before a new stub reads state", async () => {
    const id = env.ROOMS.idFromName("ABC234");
    const first = env.ROOMS.get(id);
    const initResult = await first.initialize(roomInitialization("ABC234"));
    expect(initResult).toEqual({ ok: true });

    const dispatchResult = await first.dispatch(
      hostActor(),
      envelope(0, { type: "lock_room", locked: true }, testUuid(1))
    );
    expect(dispatchResult).toEqual({ ok: true, revision: 1 });

    const second = env.ROOMS.get(id);
    const snapshot = await second.getSnapshot();
    expect(snapshot.revision).toBe(1);
    expect(snapshot.locked).toBe(true);
  });

  it("handles concurrent initialize calls with one winner without replacing state", async () => {
    const id = env.ROOMS.idFromName("CONCUR1");
    const stub = env.ROOMS.get(id);
    const [res1, res2] = await Promise.all([
      stub.initialize(roomInitialization("CONCUR1")),
      stub.initialize({
        ...roomInitialization("CONCUR1"),
        boardSeed: "malicious-replacement-seed"
      })
    ]);

    const okResults = [res1, res2].filter((r) => r.ok);
    const errResults = [res1, res2].filter((r) => !r.ok);
    expect(okResults).toHaveLength(1);
    expect(errResults).toHaveLength(1);
    expect(errResults[0]).toEqual({ ok: false, code: "already_initialized" });

    const snapshot = await stub.getSnapshot();
    expect(snapshot.boardSeed).toBe("seed-12345");
  });

  it("reschedules expiry on activity and clears on alarm expiration", async () => {
    const id = env.ROOMS.idFromName("ALARM1");
    const stub = env.ROOMS.get(id);
    await stub.initialize(roomInitialization("ALARM1"));

    await runInRoomDO<RoomDurableObject>(stub, async (instance, state) => {
      const alarmTime = await state.storage.getAlarm();
      expect(alarmTime).not.toBeNull();
      const snapshot = await instance.getSnapshot();
      const expectedAlarm =
        Date.parse(snapshot.lastActivity) + ROOM_IDLE_TTL_MS;
      expect(alarmTime).toBe(expectedAlarm);
    });

    // Early alarm trigger: alarm() runs while deadline is in the future
    await runInRoomDO<RoomDurableObject>(stub, async (instance) => {
      await instance.alarm();
      const snapshot = await instance.getSnapshot();
      expect(snapshot).toBeDefined();
      expect(snapshot.code).toBe("ALARM1");
    });

    // Dispatch command: updates lastActivity and reschedules alarm
    await stub.dispatch(
      hostActor(),
      envelope(0, { type: "lock_room", locked: true }, testUuid(2))
    );

    await runInRoomDO<RoomDurableObject>(stub, async (instance, state) => {
      const alarmTime = await state.storage.getAlarm();
      const snapshot = await instance.getSnapshot();
      expect(alarmTime).toBe(
        Date.parse(snapshot.lastActivity) + ROOM_IDLE_TTL_MS
      );

      // Simulate expiration by setting lastActivity to 25 hours ago
      snapshot.lastActivity = new Date(
        Date.now() - (ROOM_IDLE_TTL_MS + 10000)
      ).toISOString();
      await state.storage.put("room:snapshot", snapshot);

      await instance.alarm();
      const cleared = await state.storage.get("room:snapshot");
      expect(cleared).toBeUndefined();
      await expect(instance.getSnapshot()).rejects.toThrow();
    });
  });

  it("maintains configuration parity across wrangler configs", () => {
    const prod = parseJsonc(prodConfigText);
    const dev = parseJsonc(devConfigText);
    const test = parseJsonc(testConfigText);

    expect(prod.compatibility_date).toBe(dev.compatibility_date);
    expect(prod.compatibility_date).toBe(test.compatibility_date);

    expect(prod.durable_objects).toEqual(dev.durable_objects);
    expect(prod.durable_objects).toEqual(test.durable_objects);

    expect(prod.migrations).toEqual(dev.migrations);
    expect(prod.migrations).toEqual(test.migrations);
  });

  it("fails cleanly and preserves in-memory state when storage write fails", async () => {
    const id = env.ROOMS.idFromName("FAILSTORE1");
    const stub = env.ROOMS.get(id);
    await stub.initialize(roomInitialization("FAILSTORE1"));

    await runInRoomDO<RoomDurableObject>(stub, async (instance) => {
      const failingStorage: IRoomStorage = {
        read: async () => instance.getSnapshot(),
        write: async () => {
          throw new Error("Disk full or network partition");
        },
        clear: async () => {}
      };

      instance.setStorageAdapterForTest(failingStorage);

      const before = await instance.getSnapshot();
      expect(before.revision).toBe(0);

      const result = await instance.dispatch(
        hostActor(),
        envelope(0, { type: "lock_room", locked: true }, testUuid(99))
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("storage_failed");
      }

      const after = await instance.getSnapshot();
      expect(after.revision).toBe(0);
      expect(after.locked).toBe(false);
    });
  });
});
