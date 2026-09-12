import type { ViewerContext } from "@cipher-party/protocol";
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "../src/auth/token";
import type { Env } from "../src/env";
import worker from "../src/index";
import { normalizeRoomCode } from "../src/http/schemas";
import {
  PersistentRoomController,
  type RoomSnapshotStore,
} from "../src/room/room-durable-object";
import {
  createLobbyState,
  type RoomSeat,
  type RoomState,
} from "../src/room/room-state";
import type { RoomDurableObject } from "../src/room/room-durable-object";
import { ROOM_IDLE_TTL_MS } from "../src/room/room-storage";

const TEST_ORIGIN = "http://127.0.0.1:5173";
const REAL_PROCESS_TIME_MS = Date.now();
const INTEGRATION_ANCHOR_BUFFER_MS = 604_800_000;
const INITIAL_TIME = new Date(
  REAL_PROCESS_TIME_MS + INTEGRATION_ANCHOR_BUFFER_MS,
);
const JOIN_TIME = new Date(INITIAL_TIME.getTime() + 60 * 60 * 1000);

interface CreateRoomResponse {
  code: string;
  inviteUrl: string;
  playerId: string;
  seatToken: string;
  hostToken: string;
}

interface JoinRoomResponse {
  code: string;
  playerId: string;
  seatToken: string;
}

interface TicketResponse {
  ticket: string;
  expiresAt: number;
}

type RoomsEnv = { ROOMS: DurableObjectNamespace<RoomDurableObject> };

function rooms(): DurableObjectNamespace<RoomDurableObject> {
  return (env as RoomsEnv).ROOMS;
}

function room(code: string): DurableObjectStub<RoomDurableObject> {
  return rooms().get(rooms().idFromName(code));
}

function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Host", "poisoned-host.invalid");
  return worker.fetch(
    new Request(`https://poisoned-request.invalid${path}`, {
      ...init,
      headers,
    }),
    env as unknown as Env,
  );
}

function jsonRequest(
  path: string,
  body: unknown,
  headers: HeadersInit = {},
): Promise<Response> {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function createRoom(
  displayName = "Host",
): Promise<{ response: Response; body: CreateRoomResponse }> {
  const response = await jsonRequest("/api/rooms", { displayName });
  return {
    response,
    body: (await response.json()) as CreateRoomResponse,
  };
}

async function joinRoom(
  code: string,
  displayName = "Guest",
  asSpectator = false,
): Promise<{ response: Response; body: JoinRoomResponse }> {
  const response = await jsonRequest(`/api/rooms/${code}/join`, {
    displayName,
    asSpectator,
  });
  return {
    response,
    body: (await response.json()) as JoinRoomResponse,
  };
}

function fixtureSeat(
  playerId: string,
  seatClass: "active" | "spectator",
): RoomSeat {
  return {
    playerId,
    displayName: playerId,
    seatClass,
    teamId: null,
    role: seatClass === "spectator" ? "spectator" : "unassigned",
    connected: false,
    seatTokenHash: `hash-${playerId}`,
  };
}

function fixtureState(
  code: string,
  overrides: Partial<RoomState> = {},
): RoomState {
  return {
    ...createLobbyState({
      code,
      inviteUrl: `${TEST_ORIGIN}/room/${code}`,
      boardSeed: `seed-${code}`,
      hostPlayerId: `host-${code}`,
      displayName: "Host",
      seatTokenHash: `seat-hash-${code}`,
      hostTokenHash: `host-hash-${code}`,
      createdAt: INITIAL_TIME.toISOString(),
    }),
    ...structuredClone(overrides),
  };
}

async function initializeFixture(
  code: string,
  overrides: Partial<RoomState> = {},
): Promise<void> {
  await expect(
    room(code).initialize(fixtureState(code, overrides)),
  ).resolves.toEqual({
    ok: true,
  });
}

async function issueTicket(
  code: string,
  seatToken: string,
  hostToken?: string,
): Promise<{ response: Response; body: TicketResponse }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${seatToken}`,
  };
  if (hostToken !== undefined) {
    headers["X-Cipher-Host-Token"] = hostToken;
  }
  const response = await request(`/api/rooms/${code}/tickets`, {
    method: "POST",
    headers,
  });
  return {
    response,
    body: (await response.json()) as TicketResponse,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("room bootstrap HTTP API", () => {
  it("creates a disconnected host seat with canonical token-safe metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);

    const { response, body } = await createRoom("  Jose\u0301  ");

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.code).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/u);
    expect(body.playerId).toBeTypeOf("string");
    expect(body.seatToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(body.hostToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(body.inviteUrl).toBe(`${TEST_ORIGIN}/room/${body.code}`);
    expect(response.headers.get("location")).toBe(body.inviteUrl);
    expect(body.inviteUrl).not.toContain(body.seatToken);
    expect(body.inviteUrl).not.toContain(body.hostToken);
    expect(response.headers.get("location")).not.toContain(body.seatToken);
    expect(response.headers.get("location")).not.toContain(body.hostToken);

    const snapshot = await room(body.code).getSnapshot();
    expect(snapshot).toMatchObject({
      code: body.code,
      inviteUrl: body.inviteUrl,
      revision: 0,
      createdAt: INITIAL_TIME.toISOString(),
      lastActivity: INITIAL_TIME.toISOString(),
      seats: [
        {
          playerId: body.playerId,
          displayName: "José",
          connected: false,
          seatClass: "active",
        },
      ],
    });
    const serializedSnapshot = JSON.stringify(snapshot);
    expect(serializedSnapshot).not.toContain(body.seatToken);
    expect(serializedSnapshot).not.toContain(body.hostToken);

    const viewer: ViewerContext = {
      playerId: body.playerId,
      teamId: null,
      role: "unassigned",
      isHost: true,
    };
    const serializedProjection = JSON.stringify(
      await room(body.code).getProjection(viewer),
    );
    expect(serializedProjection).not.toContain(body.seatToken);
    expect(serializedProjection).not.toContain(body.hostToken);
    expect(serializedProjection).not.toContain("TokenHash");
  });

  it("retries an atomically claimed code without exposing the collision", async () => {
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const codeBytes = (code: string): number[] =>
      Array.from(code, (character) => alphabet.indexOf(character));
    await initializeFixture("ABC123");
    const originalGetRandomValues = crypto.getRandomValues.bind(crypto);
    const codes = [codeBytes("ABC123"), codeBytes("DEF456")];
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      if (array.byteLength === 6) {
        const next = codes.shift();
        if (next === undefined) {
          throw new Error("unexpected extra room-code attempt");
        }
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(
          next,
        );
        return array;
      }
      return originalGetRandomValues(array);
    });

    const { response, body } = await createRoom("Collision Host");

    expect(response.status).toBe(201);
    expect(body.code).toBe("DEF456");
    await expect(room("ABC123").getSnapshot()).resolves.toMatchObject({
      seats: [{ displayName: "Host" }],
    });
    await expect(room("DEF456").getSnapshot()).resolves.toMatchObject({
      seats: [{ displayName: "Collision Host" }],
    });
  });

  it("joins duplicate display names as distinct disconnected seats and advances activity once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);
    const created = await createRoom("Same Name");
    vi.setSystemTime(JOIN_TIME);

    const joined = await joinRoom(created.body.code, "Same Name");

    expect(joined.response.status).toBe(200);
    expect(joined.response.headers.get("cache-control")).toBe("no-store");
    expect(joined.body).toMatchObject({ code: created.body.code });
    expect(joined.body.playerId).not.toBe(created.body.playerId);
    expect(joined.body.seatToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const snapshot = await room(created.body.code).getSnapshot();
    expect(snapshot).toMatchObject({
      revision: 1,
      lastActivity: JOIN_TIME.toISOString(),
    });
    expect(snapshot?.seats.map(({ displayName }) => displayName)).toEqual([
      "Same Name",
      "Same Name",
    ]);
    expect(snapshot?.seats[1]).toMatchObject({
      playerId: joined.body.playerId,
      connected: false,
      seatClass: "active",
      teamId: null,
      role: "unassigned",
    });
    expect(JSON.stringify(snapshot)).not.toContain(joined.body.seatToken);
  });

  it("normalizes Crockford aliases before locating a room", async () => {
    await initializeFixture("01ABCD");

    const joined = await joinRoom("olabcd", "Alias Guest");

    expect(joined.response.status).toBe(200);
    expect(joined.body.code).toBe("01ABCD");
    await expect(room("01ABCD").getSnapshot()).resolves.toMatchObject({
      revision: 1,
      seats: [{ displayName: "Host" }, { displayName: "Alias Guest" }],
    });
  });

  it("rejects every join while locked", async () => {
    await initializeFixture("ABCD23", { locked: true });

    for (const asSpectator of [false, true]) {
      const result = await joinRoom("ABCD23", "Late Guest", asSpectator);
      expect(result.response.status).toBe(409);
      expect(result.body).toEqual({
        error: { code: "room_locked", message: "Room is locked" },
      });
    }
    await expect(room("ABCD23").getSnapshot()).resolves.toMatchObject({
      revision: 0,
      seats: [{ displayName: "Host" }],
    });
  });

  it("rejects active joins during play but admits an explicitly requested spectator", async () => {
    await initializeFixture("P1AY23", { phase: "playing" });

    const active = await joinRoom("P1AY23", "Active Guest");
    const spectator = await joinRoom("P1AY23", "Watching Guest", true);

    expect(active.response.status).toBe(409);
    expect(active.body).toEqual({
      error: { code: "room_in_progress", message: "Room is in progress" },
    });
    expect(spectator.response.status).toBe(200);
    await expect(room("P1AY23").getSnapshot()).resolves.toMatchObject({
      revision: 1,
      seats: [
        { displayName: "Host" },
        {
          displayName: "Watching Guest",
          seatClass: "spectator",
          role: "spectator",
          teamId: null,
          connected: false,
        },
      ],
    });
  });

  it("enforces independent 16-active and 16-spectator capacities", async () => {
    const active = Array.from({ length: 16 }, (_, index) =>
      fixtureSeat(`active-${index}`, "active"),
    );
    const spectators = Array.from({ length: 15 }, (_, index) =>
      fixtureSeat(`spectator-${index}`, "spectator"),
    );
    await initializeFixture("CAPA23", { seats: [...active, ...spectators] });

    const activeOverflow = await joinRoom("CAPA23", "Active Overflow");
    expect(activeOverflow.response.status).toBe(409);
    expect(activeOverflow.body).toEqual({
      error: { code: "room_full", message: "Room is full" },
    });

    const finalSpectator = await joinRoom("CAPA23", "Final Spectator", true);
    expect(finalSpectator.response.status).toBe(200);
    const spectatorOverflow = await joinRoom(
      "CAPA23",
      "Spectator Overflow",
      true,
    );
    expect(spectatorOverflow.response.status).toBe(409);
    expect(spectatorOverflow.body).toEqual({
      error: { code: "room_full", message: "Room is full" },
    });
    const snapshot = await room("CAPA23").getSnapshot();
    expect(
      snapshot?.seats.filter((seat) => seat.seatClass === "active"),
    ).toHaveLength(16);
    expect(
      snapshot?.seats.filter((seat) => seat.seatClass === "spectator"),
    ).toHaveLength(16);
    expect(snapshot?.revision).toBe(1);
  });

  it("returns the identical unavailable response for invalid, missing, and expired rooms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);
    const created = await createRoom("Expiring Host");
    vi.setSystemTime(INITIAL_TIME.getTime() + ROOM_IDLE_TTL_MS);
    await expect(runDurableObjectAlarm(room(created.body.code))).resolves.toBe(
      true,
    );

    const invalid = await joinRoom("NOT-A-CODE", "Guest");
    const missing = await joinRoom("M1SS23", "Guest");
    const expired = await joinRoom(created.body.code, "Guest");
    const bodies = await Promise.all([
      Promise.resolve(invalid.body),
      Promise.resolve(missing.body),
      Promise.resolve(expired.body),
    ]);

    for (const response of [
      invalid.response,
      missing.response,
      expired.response,
    ]) {
      expect(response.status).toBe(404);
    }
    expect(bodies).toEqual([
      {
        error: { code: "room_unavailable", message: "Room is unavailable" },
      },
      {
        error: { code: "room_unavailable", message: "Room is unavailable" },
      },
      {
        error: { code: "room_unavailable", message: "Room is unavailable" },
      },
    ]);
  });
});

describe("room-code input normalization", () => {
  it.each([
    ["lowercase Crockford input", "abc123", "ABC123"],
    ["O/I/L aliases", "oilabc", "011ABC"],
  ])("preserves %s", (_label, input, expected) => {
    expect(normalizeRoomCode(input)).toBe(expected);
  });

  it.each([
    ["Unicode long s", "ſ12345"],
    ["Unicode dotless i", "ı12345"],
    ["an original five-code-point ligature input", "ﬀ2345"],
    ["uppercase ASCII U", "U12345"],
    ["lowercase ASCII u", "u12345"],
  ])("rejects %s before alias mapping", (_label, input) => {
    expect(normalizeRoomCode(input)).toBeNull();
  });
});

describe("strict bootstrap validation", () => {
  it.each([
    ["blank", " \t "],
    ["control characters", "Bad\u0000Name"],
    ["more than 24 grapheme clusters", "😀".repeat(25)],
  ])("rejects %s display names", async (_label, displayName) => {
    const response = await jsonRequest("/api/rooms", { displayName });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("accepts exactly 24 grapheme clusters", async () => {
    const displayName = "👨‍👩‍👧‍👦".repeat(24);
    const { response } = await createRoom(displayName);

    expect(response.status).toBe(201);
  });

  it.each([
    [
      "missing JSON content type",
      { method: "POST", body: JSON.stringify({ displayName: "Host" }) },
    ],
    [
      "wrong content type",
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ displayName: "Host" }),
      },
    ],
    [
      "malformed JSON",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ],
    [
      "extra fields",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Host", replacementState: {} }),
      },
    ],
    [
      "an absent Content-Length above the streamed byte cap",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `${JSON.stringify({ displayName: "Host" })}${" ".repeat(5_000)}`,
      },
    ],
    [
      "a lying Content-Length above the streamed byte cap",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "2",
        },
        body: `${JSON.stringify({ displayName: "Host" })}${" ".repeat(5_000)}`,
      },
    ],
  ] as const)("rejects %s", async (_label, init) => {
    const response = await request("/api/rooms", init);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("rejects extra join fields through the strict schema", async () => {
    const created = await createRoom();
    const response = await jsonRequest(`/api/rooms/${created.body.code}/join`, {
      displayName: "Guest",
      asSpectator: false,
      seatToken: created.body.seatToken,
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(
      created.body.seatToken,
    );
  });
});

describe("one-use connection ticket API", () => {
  it("requires a valid seat token and never reflects credentials in errors", async () => {
    const created = await createRoom();
    const missing = await request(`/api/rooms/${created.body.code}/tickets`, {
      method: "POST",
    });
    const invalid = await issueTicket(
      created.body.code,
      "invalid-seat-token",
      created.body.hostToken,
    );

    expect(missing.status).toBe(401);
    expect(invalid.response.status).toBe(401);
    const payloads = [await missing.json(), invalid.body];
    for (const payload of payloads) {
      const serialized = JSON.stringify(payload);
      expect(serialized).toContain("unauthorized");
      expect(serialized).not.toContain(created.body.seatToken);
      expect(serialized).not.toContain(created.body.hostToken);
      expect(serialized).not.toContain("invalid-seat-token");
    }
  });

  it("grants host authority only with the host seat and matching host token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);
    const created = await createRoom();
    const joined = await joinRoom(created.body.code, "Guest");
    const stub = room(created.body.code);

    const hostWithoutHeader = await issueTicket(
      created.body.code,
      created.body.seatToken,
    );
    expect(hostWithoutHeader.response.status).toBe(200);
    await expect(
      stub.consumeTicket({
        ticket: hostWithoutHeader.body.ticket,
        now: hostWithoutHeader.body.expiresAt - 1,
      }),
    ).resolves.toEqual({
      ok: true,
      playerId: created.body.playerId,
      hostAuthority: false,
    });

    const hostWithWrongHeader = await issueTicket(
      created.body.code,
      created.body.seatToken,
      "wrong-host-token",
    );
    await expect(
      stub.consumeTicket({
        ticket: hostWithWrongHeader.body.ticket,
        now: hostWithWrongHeader.body.expiresAt - 1,
      }),
    ).resolves.toEqual({
      ok: true,
      playerId: created.body.playerId,
      hostAuthority: false,
    });

    const nonHostWithHeader = await issueTicket(
      created.body.code,
      joined.body.seatToken,
      created.body.hostToken,
    );
    await expect(
      stub.consumeTicket({
        ticket: nonHostWithHeader.body.ticket,
        now: nonHostWithHeader.body.expiresAt - 1,
      }),
    ).resolves.toEqual({
      ok: true,
      playerId: joined.body.playerId,
      hostAuthority: false,
    });

    const authorizedHost = await issueTicket(
      created.body.code,
      created.body.seatToken,
      created.body.hostToken,
    );
    expect(authorizedHost.response.headers.get("cache-control")).toBe(
      "no-store",
    );
    await expect(
      stub.consumeTicket({
        ticket: authorizedHost.body.ticket,
        now: authorizedHost.body.expiresAt - 1,
      }),
    ).resolves.toEqual({
      ok: true,
      playerId: created.body.playerId,
      hostAuthority: true,
    });
  });

  it("accepts a lowercase Bearer scheme with legal spaces and tabs", async () => {
    const created = await createRoom();
    const response = await request(`/api/rooms/${created.body.code}/tickets`, {
      method: "POST",
      headers: {
        Authorization: `bearer\t  ${created.body.seatToken}`,
      },
    });

    expect(response.status).toBe(200);
    const ticket = (await response.json()) as TicketResponse;
    await expect(
      room(created.body.code).consumeTicket({
        ticket: ticket.ticket,
        now: ticket.expiresAt - 1,
      }),
    ).resolves.toEqual({
      ok: true,
      playerId: created.body.playerId,
      hostAuthority: false,
    });
  });

  it("persists ticket activity without a public revision and never stores the raw ticket", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);
    const created = await createRoom();
    vi.setSystemTime(JOIN_TIME);

    const first = await issueTicket(
      created.body.code,
      created.body.seatToken,
      created.body.hostToken,
    );

    expect(first.response.status).toBe(200);
    expect(first.body.expiresAt).toBe(JOIN_TIME.getTime() + 60_000);
    const firstSnapshot = await room(created.body.code).getSnapshot();
    expect(firstSnapshot).toMatchObject({
      revision: 0,
      lastActivity: JOIN_TIME.toISOString(),
      connectionTickets: [
        {
          playerId: created.body.playerId,
          hostAuthority: true,
          expiresAt: first.body.expiresAt,
        },
      ],
    });
    expect(JSON.stringify(firstSnapshot)).not.toContain(first.body.ticket);

    vi.setSystemTime(first.body.expiresAt);
    const second = await issueTicket(created.body.code, created.body.seatToken);
    const secondSnapshot = await room(created.body.code).getSnapshot();
    expect(secondSnapshot).toMatchObject({
      revision: 0,
      connectionTickets: [
        {
          playerId: created.body.playerId,
          hostAuthority: false,
          expiresAt: second.body.expiresAt,
        },
      ],
    });
    expect(JSON.stringify(secondSnapshot)).not.toContain(first.body.ticket);
    expect(JSON.stringify(secondSnapshot)).not.toContain(second.body.ticket);
  });

  it("consumes a ticket once before 60 seconds and expires it at the exact boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);
    const created = await createRoom();
    const stub = room(created.body.code);
    const usable = await issueTicket(created.body.code, created.body.seatToken);

    const firstConsumption = stub.consumeTicket({
      ticket: usable.body.ticket,
      now: usable.body.expiresAt - 1,
    });
    const overlappingConsumption = stub.consumeTicket({
      ticket: usable.body.ticket,
      now: usable.body.expiresAt - 1,
    });
    const results = await Promise.all([
      firstConsumption,
      overlappingConsumption,
    ]);
    expect(results.filter((result) => result.ok)).toEqual([
      {
        ok: true,
        playerId: created.body.playerId,
        hostAuthority: false,
      },
    ]);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "unauthorized" },
    ]);

    const expired = await issueTicket(
      created.body.code,
      created.body.seatToken,
    );
    await expect(
      stub.consumeTicket({
        ticket: expired.body.ticket,
        now: expired.body.expiresAt,
      }),
    ).resolves.toEqual({ ok: false, code: "unauthorized" });
    await expect(stub.getSnapshot()).resolves.toMatchObject({
      revision: 0,
      connectionTickets: [],
    });
  });
});

class FakeRoomStorage implements RoomSnapshotStore {
  snapshot: RoomState | undefined;
  writeImpl: ((state: RoomState) => Promise<void>) | undefined;

  async read(): Promise<RoomState | undefined> {
    return structuredClone(this.snapshot);
  }

  async write(state: RoomState): Promise<void> {
    if (this.writeImpl !== undefined) {
      await this.writeImpl(structuredClone(state));
      return;
    }
    this.snapshot = structuredClone(state);
  }

  async clear(): Promise<void> {
    this.snapshot = undefined;
  }
}

describe("trusted seat mutation persistence", () => {
  it("does not expose a successful join until its snapshot write completes", async () => {
    const storage = new FakeRoomStorage();
    const controller = new PersistentRoomController(storage, () => JOIN_TIME);
    await controller.initialize(fixtureState("ATMC23"));
    let finishWrite: (() => void) | undefined;
    storage.writeImpl = async (state) => {
      await new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      storage.snapshot = structuredClone(state);
    };

    const pending = controller.join({
      playerId: "guest",
      displayName: "Guest",
      seatTokenHash: "guest-hash",
      asSpectator: false,
    });
    await Promise.resolve();

    expect(controller.getSnapshot()).toMatchObject({ revision: 0 });
    expect(controller.getSnapshot()?.seats).toHaveLength(1);
    expect(finishWrite).toBeTypeOf("function");
    finishWrite?.();
    await expect(pending).resolves.toEqual({ ok: true, revision: 1 });
    expect(controller.getSnapshot()).toMatchObject({
      revision: 1,
      lastActivity: JOIN_TIME.toISOString(),
      seats: [{ displayName: "Host" }, { displayName: "Guest" }],
    });
  });

  it("keeps the old revision and seats when a join snapshot write fails", async () => {
    const storage = new FakeRoomStorage();
    const controller = new PersistentRoomController(storage, () => JOIN_TIME);
    await controller.initialize(fixtureState("FAIL23"));
    storage.writeImpl = async () => {
      throw new Error("simulated write failure");
    };

    await expect(
      controller.join({
        playerId: "guest",
        displayName: "Guest",
        seatTokenHash: "guest-hash",
        asSpectator: false,
      }),
    ).rejects.toThrow("simulated write failure");
    expect(controller.getSnapshot()).toMatchObject({ revision: 0 });
    expect(controller.getSnapshot()?.seats).toHaveLength(1);
  });

  it("does not expose a raw issued ticket before persistence succeeds", async () => {
    const seatToken = "seat-token";
    const hostToken = "host-token";
    const state = fixtureState("TICK23", {
      hostTokenHash: await hashToken(hostToken),
    });
    state.seats[0]!.seatTokenHash = await hashToken(seatToken);
    const storage = new FakeRoomStorage();
    const controller = new PersistentRoomController(storage, () => JOIN_TIME);
    await controller.initialize(state);
    let finishWrite: (() => void) | undefined;
    storage.writeImpl = async (next) => {
      await new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      storage.snapshot = structuredClone(next);
    };

    const pending = controller.issueTicket({
      seatToken,
      hostToken,
      now: JOIN_TIME.getTime(),
    });
    await vi.waitFor(() => {
      expect(finishWrite).toBeTypeOf("function");
    });

    expect(controller.getSnapshot()?.connectionTickets).toEqual([]);
    finishWrite?.();
    const result = await pending;
    expect(result).toMatchObject({
      ok: true,
      expiresAt: JOIN_TIME.getTime() + 60_000,
    });
    if (result.ok) {
      expect(JSON.stringify(controller.getSnapshot())).not.toContain(
        result.ticket,
      );
    }
  });

  it("rejects ticket issuance without changing cached activity or tickets when persistence fails", async () => {
    const seatToken = "rejected-issue-seat-token";
    const hostToken = "rejected-issue-host-token";
    const state = fixtureState("ISSU23", {
      hostTokenHash: await hashToken(hostToken),
    });
    state.seats[0]!.seatTokenHash = await hashToken(seatToken);
    const storage = new FakeRoomStorage();
    const controller = new PersistentRoomController(storage, () => JOIN_TIME);
    await controller.initialize(state);
    const before = controller.getSnapshot();
    storage.writeImpl = async () => {
      throw new Error("simulated issue persistence failure");
    };

    await expect(
      controller.issueTicket({
        seatToken,
        hostToken,
        now: JOIN_TIME.getTime(),
      }),
    ).rejects.toThrow("simulated issue persistence failure");
    expect(controller.getSnapshot()).toEqual(before);
    expect(storage.snapshot).toEqual(before);
    expect(controller.getSnapshot()).toMatchObject({
      revision: 0,
      lastActivity: before?.lastActivity,
      connectionTickets: [],
    });
  });

  it("returns no consume success and retains a ticket when deletion persistence fails", async () => {
    const seatToken = "consume-failure-seat-token";
    const state = fixtureState("CONS23");
    state.seats[0]!.seatTokenHash = await hashToken(seatToken);
    const storage = new FakeRoomStorage();
    const controller = new PersistentRoomController(storage, () => JOIN_TIME);
    await controller.initialize(state);
    const issued = await controller.issueTicket({
      seatToken,
      hostToken: null,
      now: JOIN_TIME.getTime(),
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      throw new Error("ticket fixture was not issued");
    }
    const before = controller.getSnapshot();
    storage.writeImpl = async () => {
      throw new Error("simulated consume persistence failure");
    };

    await expect(
      controller.consumeTicket({
        ticket: issued.ticket,
        now: issued.expiresAt - 1,
      }),
    ).rejects.toThrow("simulated consume persistence failure");
    expect(controller.getSnapshot()).toEqual(before);
    expect(storage.snapshot).toEqual(before);
    expect(controller.getSnapshot()?.connectionTickets).toHaveLength(1);

    storage.writeImpl = undefined;
    await expect(
      controller.consumeTicket({
        ticket: issued.ticket,
        now: issued.expiresAt - 1,
      }),
    ).resolves.toEqual({
      ok: true,
      playerId: state.hostPlayerId,
      hostAuthority: false,
    });
    expect(controller.getSnapshot()?.connectionTickets).toEqual([]);
  });
});

describe("outstanding ticket budgets", () => {
  it("returns recoverable throttling after eight tickets without changing existing tickets or activity", async () => {
    const created = await createRoom();
    const tickets = await Promise.all(
      Array.from({ length: 8 }, () =>
        issueTicket(created.body.code, created.body.seatToken),
      ),
    );
    const before = await room(created.body.code).getSnapshot();
    const response = await request(`/api/rooms/${created.body.code}/tickets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${created.body.seatToken}` },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(await room(created.body.code).getSnapshot()).toEqual(before);
    const first = tickets[0]!.body;
    expect(
      (
        await room(created.body.code).consumeTicket({
          ticket: first.ticket,
          now: first.expiresAt - 1,
        })
      ).ok,
    ).toBe(true);
  });
});

describe("Worker routing compatibility", () => {
  it("preserves health and static fallback behavior", async () => {
    const health = await request("/api/health");
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      ok: true,
      service: "cipher-party",
    });

    const missing = await request("/not-an-api-route");
    expect(missing.status).toBe(404);
  });
});
