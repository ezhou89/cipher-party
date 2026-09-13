import type {
  ClientCommand,
  CommandEnvelope,
  ViewerContext,
} from "@cipher-party/protocol";
import {
  evictDurableObject,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { parse } from "jsonc-parser";
import { hashToken } from "../src/auth/token";
import { afterEach, describe, expect, it, vi } from "vitest";

import developmentConfigSource from "../wrangler.dev.jsonc?raw";
import productionConfigSource from "../wrangler.jsonc?raw";
import testConfigSource from "../wrangler.test.jsonc?raw";
import {
  PersistentRoomController,
  type RoomSnapshotStore,
} from "../src/room/room-durable-object";
import { ROOM_IDLE_TTL_MS } from "../src/room/room-storage";
import {
  InvalidRoomSnapshotError,
  parseRoomSnapshot,
} from "../src/room/room-snapshot";
import {
  createLobbyState,
  type RoomActor,
  type RoomState,
} from "../src/room/room-state";
import type { RoomDurableObject } from "../src/room/room-durable-object";

const REAL_PROCESS_TIME_MS = Date.now();
const INTEGRATION_ANCHOR_BUFFER_MS = 604_800_000;
const INITIALIZED_AT = new Date(
  REAL_PROCESS_TIME_MS + INTEGRATION_ANCHOR_BUFFER_MS,
);
let commandSequence = 0;

type RoomsEnv = { ROOMS: DurableObjectNamespace<RoomDurableObject> };

function rooms(): DurableObjectNamespace<RoomDurableObject> {
  return (env as RoomsEnv).ROOMS;
}

function commandId(): string {
  commandSequence += 1;
  return `00000000-0000-4000-8000-${String(commandSequence).padStart(12, "0")}`;
}

function envelope(
  expectedRevision: number,
  command: ClientCommand,
  id = commandId(),
): CommandEnvelope {
  return {
    protocolVersion: 2,
    commandId: id,
    expectedRevision,
    command,
  };
}

function hostActor(): RoomActor {
  return { playerId: "host", hostAuthority: true };
}

function roomInitialization(
  code: string,
  overrides: Partial<RoomState> = {},
): RoomState {
  const state = createLobbyState({
    code,
    inviteUrl: `https://play.example/room/${code}`,
    boardSeed: `board-seed-${code}`,
    hostPlayerId: "host",
    displayName: "Host",
    seatTokenHash: "a".repeat(64),
    hostTokenHash: "b".repeat(64),
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  state.seats[0]!.connected = true;
  return { ...state, ...structuredClone(overrides) };
}

function legacySnapshot(state: RoomState): unknown {
  const legacy = structuredClone(state) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 1;
  legacy.protocolVersion = 1;
  delete legacy.teamCount;
  delete legacy.configuredTeams;
  delete legacy.initialOwners;
  const game = legacy.game as {
    board: Record<string, unknown>;
    eliminatedTeams?: unknown;
  } | null;
  if (game !== null) {
    delete game.board.teamCount;
    delete game.board.configuredTeams;
    delete game.board.rows;
    delete game.board.columns;
    delete game.eliminatedTeams;
  }
  return legacy;
}

function configuredRoom(code: string): RoomState {
  const state = roomInitialization(code, {
    connectionTickets: [
      {
        ticketHash: "c".repeat(64),
        playerId: "blue-operative",
        hostAuthority: false,
        expiresAt: 2_000_000_000_000,
      },
    ],
  });
  state.seats = [
    {
      ...state.seats[0]!,
      teamId: "red",
      role: "clue-giver",
    },
    {
      playerId: "red-operative",
      displayName: "Red Operative",
      seatClass: "active",
      teamId: "red",
      role: "operative",
      connected: true,
      seatTokenHash: "1".repeat(64),
    },
    {
      playerId: "blue-clue",
      displayName: "Blue Clue",
      seatClass: "active",
      teamId: "blue",
      role: "clue-giver",
      connected: true,
      seatTokenHash: "2".repeat(64),
    },
    {
      playerId: "blue-operative",
      displayName: "Blue Operative",
      seatClass: "active",
      teamId: "blue",
      role: "operative",
      connected: true,
      seatTokenHash: "3".repeat(64),
    },
  ];
  return state;
}

function stub(name: string): DurableObjectStub<RoomDurableObject> {
  const id = rooms().idFromName(name);
  return rooms().get(id);
}

function spectator(): ViewerContext {
  return {
    playerId: "outside-viewer",
    teamId: null,
    role: "spectator",
    isHost: false,
  };
}

class FakeRoomStorage implements RoomSnapshotStore {
  snapshot: RoomState | undefined;
  rejectWrites = false;
  writes: RoomState[] = [];

  async read(): Promise<RoomState | undefined> {
    return structuredClone(this.snapshot);
  }

  async write(state: RoomState): Promise<void> {
    if (this.rejectWrites) {
      throw new Error("simulated storage rejection");
    }
    this.snapshot = structuredClone(state);
    this.writes.push(structuredClone(state));
  }

  async clear(): Promise<void> {
    this.snapshot = undefined;
  }
}

class RawRoomStorage implements RoomSnapshotStore {
  raw: unknown;
  writes: RoomState[] = [];

  constructor(raw: unknown) {
    this.raw = structuredClone(raw);
  }

  async read(): Promise<RoomState | undefined> {
    return this.raw === undefined ? undefined : parseRoomSnapshot(this.raw);
  }

  async write(state: RoomState): Promise<void> {
    this.raw = structuredClone(state);
    this.writes.push(structuredClone(state));
  }

  async clear(): Promise<void> {
    this.raw = undefined;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Cloudflare Durable Object configuration", () => {
  it("keeps production, development, and test bindings and SQLite migration in parity", () => {
    const configs = [
      parse(productionConfigSource),
      parse(developmentConfigSource),
      parse(testConfigSource),
    ];

    for (const config of configs) {
      expect(config).toMatchObject({
        main: "src/index.ts",
        compatibility_date: "2026-08-30",
        vars: { CANONICAL_ORIGIN: "http://127.0.0.1:5173" },
        durable_objects: {
          bindings: [{ name: "ROOMS", class_name: "RoomDurableObject" }],
        },
        migrations: [
          {
            tag: "v1",
            new_sqlite_classes: ["RoomDurableObject"],
          },
        ],
      });
    }
    expect(configs[0]).toHaveProperty("assets");
    expect(configs[1]).not.toHaveProperty("assets");
    expect(configs[2]).not.toHaveProperty("assets");
  });
});

describe("PersistentRoomController failure atomicity", () => {
  it("cannot initialize over a failed snapshot load or expose a cached projection", async () => {
    const storage = new FakeRoomStorage();
    storage.read = async () => {
      throw new InvalidRoomSnapshotError();
    };
    const controller = new PersistentRoomController(storage);
    await expect(controller.load()).rejects.toThrow(InvalidRoomSnapshotError);
    expect(await controller.initialize(roomInitialization("ABC123"))).toEqual({
      ok: false,
      code: "already_initialized",
    });
    expect(controller.getSnapshot()).toBeUndefined();
    expect(controller.getProjection(spectator())).toBeUndefined();
    expect(storage.writes.length).toBe(0);
  });

  it("persists presence repair atomically, retries failed writes, and skips matching inventories", async () => {
    const storage = new FakeRoomStorage();
    const published: number[] = [];
    const controller = new PersistentRoomController(
      storage,
      () => INITIALIZED_AT,
      (state) => {
        published.push(state.revision);
      },
    );
    await controller.initialize(roomInitialization("ABC123"));
    const before = controller.getSnapshot()!;
    storage.rejectWrites = true;
    await expect(controller.reconcilePresence(() => new Set())).rejects.toThrow(
      "simulated storage rejection",
    );
    expect(controller.getSnapshot()?.seats[0]?.connected).toBe(true);
    expect(storage.snapshot?.seats[0]?.connected).toBe(true);
    expect(published).toEqual([]);
    storage.rejectWrites = false;
    expect(await controller.reconcilePresence(() => new Set())).toEqual({
      changed: true,
    });
    expect(controller.getSnapshot()?.lastActivity).toBe(before.lastActivity);
    expect(storage.snapshot?.lastActivity).toBe(before.lastActivity);
    expect(storage.snapshot?.seats[0]?.connected).toBe(false);
    expect(published).toEqual([1]);
    expect(await controller.reconcilePresence(() => new Set())).toEqual({
      changed: false,
    });
    expect(storage.writes.length).toBe(2);
    expect(await controller.reconcilePresence(() => new Set(["host"]))).toEqual(
      { changed: true },
    );
    expect(controller.getSnapshot()?.lastActivity).toBe(before.lastActivity);
    expect(storage.snapshot?.seats[0]?.connected).toBe(true);
    expect(published).toEqual([1, 2]);
  });

  it("keeps each concurrent dispatch outcome tied to its own committed mutation", async () => {
    const storage = new FakeRoomStorage();
    const controller = new PersistentRoomController(
      storage,
      () => INITIALIZED_AT,
    );
    await controller.initialize(roomInitialization("BUDG01"));
    const mutation = envelope(0, { type: "lock_room", locked: true });
    const [accepted, replay, unauthorized] = await Promise.all([
      controller.dispatchWithOutcome(hostActor(), mutation),
      controller.dispatchWithOutcome(hostActor(), mutation),
      controller.dispatchWithOutcome(
        { playerId: "host", hostAuthority: false },
        envelope(1, { type: "lock_room", locked: false }),
      ),
    ]);
    expect(accepted).toEqual({
      changed: true,
      result: { ok: true, revision: 1 },
    });
    expect(replay).toEqual({ changed: false, result: accepted.result });
    expect(unauthorized).toMatchObject({
      changed: false,
      result: { ok: false, code: "unauthorized" },
    });
    storage.rejectWrites = true;
    expect(
      await controller.dispatchWithOutcome(
        hostActor(),
        envelope(1, { type: "lock_room", locked: false }),
      ),
    ).toMatchObject({
      changed: false,
      result: { ok: false, code: "storage_failed" },
    });
    expect(controller.getSnapshot()?.locked).toBe(true);
  });

  it("caps room tickets without rejecting older excess snapshots and recovers after expiry", async () => {
    const storage = new FakeRoomStorage();
    const now = INITIALIZED_AT.getTime();
    const state = roomInitialization("BUDG02");
    state.seats[0]!.seatTokenHash = await hashToken("known-seat");
    state.connectionTickets = Array.from({ length: 257 }, (_, index) => ({
      ticketHash: `legacy-hash-${index}`,
      playerId: "legacy-player",
      hostAuthority: false,
      expiresAt: now + 60_000,
    }));
    storage.snapshot = state;
    const controller = new PersistentRoomController(
      storage,
      () => INITIALIZED_AT,
    );
    await controller.load();
    const before = controller.getSnapshot();
    expect(
      await controller.issueTicket({
        seatToken: "known-seat",
        hostToken: null,
        now,
      }),
    ).toEqual({ ok: false, code: "rate_limited" });
    expect(controller.getSnapshot()).toEqual(before);
    expect(storage.writes).toHaveLength(0);
    expect(
      await controller.issueTicket({
        seatToken: "incorrect-seat",
        hostToken: null,
        now,
      }),
    ).toEqual({ ok: false, code: "unauthorized" });
    const issued = await controller.issueTicket({
      seatToken: "known-seat",
      hostToken: null,
      now: now + 60_000,
    });
    expect(issued.ok).toBe(true);
    expect(controller.getSnapshot()?.connectionTickets).toHaveLength(1);
  });

  it("persists initialization before exposing a trusted defensive snapshot", async () => {
    const storage = new FakeRoomStorage();
    const initializedAt = new Date(INITIALIZED_AT.getTime() + 60 * 60 * 1000);
    let finishWrite: (() => void) | undefined;
    storage.write = async (state) => {
      await new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      storage.snapshot = structuredClone(state);
    };
    const controller = new PersistentRoomController(
      storage,
      () => initializedAt,
    );
    const pending = controller.initialize(roomInitialization("INIT01"));

    expect(controller.getSnapshot()).toBeUndefined();
    await Promise.resolve();
    expect(finishWrite).toBeTypeOf("function");
    finishWrite?.();
    await expect(pending).resolves.toEqual({ ok: true });

    const exposed = controller.getSnapshot()!;
    expect(exposed.lastActivity).toBe(initializedAt.toISOString());
    exposed.locked = true;
    exposed.seats[0]!.seatTokenHash = "mutated";
    expect(controller.getSnapshot()).toMatchObject({
      locked: false,
      seats: [{ seatTokenHash: "a".repeat(64) }],
    });
  });

  it("selects one concurrent trusted initialization without replacing its secrets or seed", async () => {
    const storage = new FakeRoomStorage();
    const controller = new PersistentRoomController(
      storage,
      () => INITIALIZED_AT,
    );
    const first = roomInitialization("INIT02", {
      boardSeed: "selected-seed",
      hostTokenHash: "selected-host-hash",
    });
    const second = roomInitialization("INIT02", {
      boardSeed: "rejected-seed",
      hostTokenHash: "rejected-host-hash",
    });

    await expect(
      Promise.all([
        controller.initialize(first),
        controller.initialize(second),
      ]),
    ).resolves.toEqual([
      { ok: true },
      { ok: false, code: "already_initialized" },
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      boardSeed: "selected-seed",
      hostTokenHash: "selected-host-hash",
    });
    expect(storage.writes).toHaveLength(1);
  });

  it("returns storage_failed at the old revision without caching or publishing the accepted command", async () => {
    const storage = new FakeRoomStorage();
    const acceptedAt = new Date(INITIALIZED_AT.getTime() + 2 * 60 * 60 * 1000);
    const postPersist = vi.fn<(persisted: RoomState) => void>();
    const controller = new PersistentRoomController(
      storage,
      () => acceptedAt,
      postPersist,
    );
    postPersist.mockImplementation((persisted) => {
      expect(controller.getSnapshot()).toEqual(persisted);
    });
    await controller.initialize(roomInitialization("FAIL01"));
    postPersist.mockClear();
    storage.rejectWrites = true;
    const command = envelope(0, { type: "lock_room", locked: true });

    await expect(controller.dispatch(hostActor(), command)).resolves.toEqual({
      ok: false,
      revision: 0,
      code: "storage_failed",
      message: "Room state could not be persisted",
    });
    expect(controller.getSnapshot()).toMatchObject({
      revision: 0,
      locked: false,
      processedCommands: [],
    });
    expect(postPersist).not.toHaveBeenCalled();

    storage.rejectWrites = false;
    await expect(controller.dispatch(hostActor(), command)).resolves.toEqual({
      ok: true,
      revision: 1,
    });
    expect(controller.getSnapshot()).toMatchObject({
      revision: 1,
      locked: true,
    });
    expect(postPersist).toHaveBeenCalledTimes(1);
  });
});

describe("RoomDurableObject persistence", () => {
  it("normalizes v1 storage in memory and writes v2 only after an accepted mutation", async () => {
    const storage = new RawRoomStorage(
      legacySnapshot(roomInitialization("M1GR8T")),
    );
    const controller = new PersistentRoomController(
      storage,
      () => INITIALIZED_AT,
    );

    await controller.load();

    expect(controller.getSnapshot()).toMatchObject({
      schemaVersion: 2,
      protocolVersion: 2,
      teamCount: 2,
      configuredTeams: ["red", "blue"],
      initialOwners: null,
    });
    expect(storage.raw).toMatchObject({
      schemaVersion: 1,
      protocolVersion: 1,
    });
    expect(storage.writes).toHaveLength(0);

    await expect(
      controller.dispatch(
        hostActor(),
        envelope(0, { type: "lock_room", locked: true }),
      ),
    ).resolves.toEqual({ ok: true, revision: 1 });
    expect(storage.raw).toMatchObject({
      schemaVersion: 2,
      protocolVersion: 2,
      teamCount: 2,
      configuredTeams: ["red", "blue"],
      initialOwners: null,
      revision: 1,
      locked: true,
    });
    expect(storage.writes).toHaveLength(1);
  });

  it("is explicit and non-mutating before initialization", async () => {
    const room = stub("EMPTY1");

    await expect(room.getSnapshot()).resolves.toBeUndefined();
    await expect(room.getProjection(spectator())).resolves.toBeUndefined();
    await expect(
      room.dispatch(
        hostActor(),
        envelope(0, { type: "lock_room", locked: true }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      revision: 0,
      code: "invalid_command",
    });
    await runInDurableObject(room, async (_instance, state) => {
      expect(await state.storage.list()).toEqual(new Map());
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("persists an accepted command before a same-name stub reads state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIALIZED_AT);
    const first = stub("PERS01");
    await first.initialize(roomInitialization("PERS01"));
    await first.dispatch(
      hostActor(),
      envelope(0, { type: "lock_room", locked: true }),
    );

    const second = stub("PERS01");
    await expect(second.getSnapshot()).resolves.toMatchObject({
      revision: 1,
      locked: true,
    });
  });

  it("reloads persisted accepted state after a forced runtime eviction", async () => {
    const first = stub("EV1CT1");
    await first.initialize(roomInitialization("EV1CT1"));
    await first.dispatch(
      hostActor(),
      envelope(0, { type: "lock_room", locked: true }),
    );
    await evictDurableObject(first);

    await expect(stub("EV1CT1").getSnapshot()).resolves.toMatchObject({
      revision: 2,
      locked: true,
    });
  });

  it("atomically selects one concurrent initialization and stores one snapshot key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIALIZED_AT);
    const room = stub("RACE01");
    const selected = roomInitialization("RACE01", {
      boardSeed: "selected-seed",
      hostTokenHash: "selected-host-hash",
    });
    const rejected = roomInitialization("RACE01", {
      boardSeed: "rejected-seed",
      hostTokenHash: "rejected-host-hash",
    });

    await expect(
      Promise.all([room.initialize(selected), room.initialize(rejected)]),
    ).resolves.toEqual([
      { ok: true },
      { ok: false, code: "already_initialized" },
    ]);
    await expect(room.getSnapshot()).resolves.toMatchObject({
      boardSeed: "selected-seed",
      hostTokenHash: "selected-host-hash",
      lastActivity: INITIALIZED_AT.toISOString(),
    });
    await runInDurableObject(room, async (_instance, state) => {
      const entries = await state.storage.list();
      expect([...entries.keys()]).toEqual(["room:snapshot"]);
      expect(await state.storage.getAlarm()).toBe(
        INITIALIZED_AT.getTime() + ROOM_IDLE_TTL_MS,
      );
    });
  });

  it("reschedules expiry only after accepted revision-changing activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIALIZED_AT);
    const room = stub("SCHED1");
    await room.initialize(roomInitialization("SCHED1"));
    const acceptedAt = new Date(INITIALIZED_AT.getTime() + 2 * 60 * 60 * 1000);
    vi.setSystemTime(acceptedAt);
    const command = envelope(0, { type: "lock_room", locked: true });
    await expect(room.dispatch(hostActor(), command)).resolves.toEqual({
      ok: true,
      revision: 1,
    });
    const acceptedDeadline = acceptedAt.getTime() + ROOM_IDLE_TTL_MS;

    await runInDurableObject(room, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBe(acceptedDeadline);
    });
    vi.setSystemTime(INITIALIZED_AT.getTime() + 3 * 60 * 60 * 1000);
    await expect(
      room.dispatch(
        hostActor(),
        envelope(0, { type: "lock_room", locked: false }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "stale_revision",
      revision: 1,
    });
    await expect(room.dispatch(hostActor(), command)).resolves.toEqual({
      ok: true,
      revision: 1,
    });
    await runInDurableObject(room, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBe(acceptedDeadline);
    });
  });

  it("freshly derives defensive role-safe projections without secret or hidden ownership leakage", async () => {
    const room = stub("SAFE01");
    await room.initialize(configuredRoom("SAFE01"));
    await room.dispatch(hostActor(), envelope(0, { type: "start_board" }));

    const firstSnapshot = (await room.getSnapshot())!;
    firstSnapshot.locked = true;
    firstSnapshot.seats[0]!.seatTokenHash = "mutated-secret";
    const secondSnapshot = (await room.getSnapshot())!;
    expect(secondSnapshot.locked).toBe(false);
    expect(secondSnapshot.seats[0]!.seatTokenHash === "a".repeat(64)).toBe(
      true,
    );

    const firstProjection = (await room.getProjection(spectator()))!;
    const serialized = JSON.stringify(firstProjection);
    expect(serialized).not.toContain("secret");
    for (const hash of [
      secondSnapshot.hostTokenHash,
      ...secondSnapshot.seats.map((seat) => seat.seatTokenHash),
      ...secondSnapshot.connectionTickets.map((ticket) => ticket.ticketHash),
    ]) {
      expect(serialized.includes(hash)).toBe(false);
    }
    expect(serialized).not.toContain("seatTokenHash");
    expect(serialized).not.toContain("hostTokenHash");
    expect(serialized).not.toContain("boardSeed");
    expect(serialized).not.toContain("processedCommands");
    expect(serialized).not.toContain("connectionTickets");
    expect(serialized).not.toContain('"hazard"');
    expect(
      firstProjection.board?.cards.every((card) => !("owner" in card)),
    ).toBe(true);
    firstProjection.seats[0]!.displayName = "Mutated projection";
    expect((await room.getProjection(spectator()))!.seats[0]!.displayName).toBe(
      "Host",
    );
  });
});

describe("RoomDurableObject inactivity alarm", () => {
  it("keeps the integration anchor safely ahead of real process time", () => {
    expect(INITIALIZED_AT.getTime() - REAL_PROCESS_TIME_MS).toBe(604_800_000);
  });

  it("uses the approved 24-hour inactivity duration", () => {
    expect(ROOM_IDLE_TTL_MS).toBe(86_400_000);
  });

  it("reschedules the unchanged deadline when an alarm arrives early", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIALIZED_AT);
    const room = stub("EAR1Y1");
    await room.initialize(roomInitialization("EAR1Y1"));
    const deadline = INITIALIZED_AT.getTime() + ROOM_IDLE_TTL_MS;
    await runInDurableObject(room, async (_instance, state) => {
      const persisted = await state.storage.get<RoomState>("room:snapshot");
      await state.storage.put("room:snapshot", { ...persisted!, locked: true });
    });
    vi.setSystemTime(INITIALIZED_AT.getTime() + 60 * 60 * 1000);

    await expect(runDurableObjectAlarm(room)).resolves.toBe(true);
    await expect(room.getSnapshot()).resolves.toMatchObject({
      lastActivity: INITIALIZED_AT.toISOString(),
      locked: true,
    });
    await runInDurableObject(room, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBe(deadline);
    });
  });

  it.each([
    ["at the exact deadline", 0, "EXACT1"],
    ["after the deadline", 1, "1ATE01"],
  ])(
    "expires %s and is empty on an idempotent repeat",
    async (_label, offset, name) => {
      vi.useFakeTimers();
      vi.setSystemTime(INITIALIZED_AT);
      const room = stub(name);
      await room.initialize(roomInitialization(name));
      vi.setSystemTime(INITIALIZED_AT.getTime() + ROOM_IDLE_TTL_MS + offset);

      await expect(runDurableObjectAlarm(room)).resolves.toBe(true);
      await expect(room.getSnapshot()).resolves.toBeUndefined();
      await expect(room.getProjection(spectator())).resolves.toBeUndefined();
      await expect(runDurableObjectAlarm(room)).resolves.toBe(false);
      await runInDurableObject(room, async (instance, state) => {
        await instance.alarm();
        expect(await state.storage.list()).toEqual(new Map());
        expect(await state.storage.getAlarm()).toBeNull();
      });
    },
  );

  it("closes every accepted socket with the room-expired close frame", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIALIZED_AT);
    const room = stub("S0CK01");
    await room.initialize(roomInitialization("S0CK01"));
    vi.setSystemTime(INITIALIZED_AT.getTime() + ROOM_IDLE_TTL_MS);

    await runInDurableObject(room, async (instance, state) => {
      const pairs = [new WebSocketPair(), new WebSocketPair()];
      for (const pair of pairs) {
        state.acceptWebSocket(pair[1]);
      }
      const accepted = state.getWebSockets();
      expect(accepted).toHaveLength(2);
      const closeCalls = accepted.map((socket) => vi.spyOn(socket, "close"));

      await instance.alarm();

      for (const [index, close] of closeCalls.entries()) {
        expect(close).toHaveBeenCalledWith(1001, "Room expired");
        expect(accepted[index]!.readyState).not.toBe(WebSocket.OPEN);
      }
    });
    await expect(room.getSnapshot()).resolves.toBeUndefined();
  });
});
