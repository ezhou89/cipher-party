import type {
  ClientCommand,
  CommandEnvelope,
  ServerMessage,
} from "@cipher-party/protocol";
import {
  evictDurableObject,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "../src/auth/token";
import type { Env } from "../src/env";
import worker from "../src/index";
import {
  PersistentRoomController,
  type RoomDurableObject,
} from "../src/room/room-durable-object";
import type { RoomSocketAttachment } from "../src/room/room-websocket";
import { createLobbyState, type RoomState } from "../src/room/room-state";
import { ROOM_IDLE_TTL_MS, RoomStorage } from "../src/room/room-storage";
import { RoomSession } from "../src/room/room-session";

interface CreateRoomResponse {
  code: string;
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
}

type RoomsEnv = { ROOMS: DurableObjectNamespace<RoomDurableObject> };

const REAL_PROCESS_TIME_MS = Date.now();
const INTEGRATION_ANCHOR_BUFFER_MS = 604_800_000;
const INITIAL_TIME = new Date(
  REAL_PROCESS_TIME_MS + INTEGRATION_ANCHOR_BUFFER_MS,
);
let commandSequence = 0;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class SocketProbe {
  readonly socket: WebSocket;
  readonly frames: ServerMessage[] = [];
  readonly #waiting: Array<(frame: ServerMessage) => void> = [];

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as ServerMessage;
      const waiter = this.#waiting.shift();
      if (waiter === undefined) {
        this.frames.push(frame);
      } else {
        waiter(frame);
      }
    });
    socket.accept();
  }

  next(): Promise<ServerMessage> {
    const frame = this.frames.shift();
    if (frame !== undefined) {
      return Promise.resolve(frame);
    }
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  send(command: ClientCommand, expectedRevision: number): string {
    const message = envelope(expectedRevision, command);
    this.socket.send(JSON.stringify(message));
    return message.commandId;
  }

  close(): void {
    this.socket.close(1000, "test complete");
  }
}

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(
    new Request(`https://request.invalid${path}`, init),
    env as unknown as Env,
  );
}

async function createRoom(displayName = "Host"): Promise<CreateRoomResponse> {
  const response = await request("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as CreateRoomResponse;
}

async function joinRoom(
  code: string,
  displayName = "Guest",
): Promise<JoinRoomResponse> {
  const response = await request(`/api/rooms/${code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName, asSpectator: false }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as JoinRoomResponse;
}

async function issueHttpTicket(
  room: Pick<CreateRoomResponse, "code" | "seatToken"> & {
    hostToken?: string;
  },
): Promise<TicketResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${room.seatToken}`,
  };
  if (room.hostToken !== undefined) {
    headers["X-Cipher-Host-Token"] = room.hostToken;
  }
  const response = await request(`/api/rooms/${room.code}/tickets`, {
    method: "POST",
    headers,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as TicketResponse;
}

function connectResponse(code: string, ticket: string): Promise<Response> {
  return request(`/api/rooms/${code}/connect?ticket=${ticket}`, {
    headers: { Upgrade: "websocket" },
  });
}

async function connect(code: string, ticket: string): Promise<SocketProbe> {
  const response = await connectResponse(code, ticket);
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  return new SocketProbe(response.webSocket!);
}

function rooms(): DurableObjectNamespace<RoomDurableObject> {
  return (env as RoomsEnv).ROOMS;
}

function roomStub(code: string): DurableObjectStub<RoomDurableObject> {
  return rooms().get(rooms().idFromName(code));
}

function envelope(
  expectedRevision: number,
  command: ClientCommand,
): CommandEnvelope {
  commandSequence += 1;
  return {
    protocolVersion: 1,
    commandId: `00000000-0000-4000-8000-${String(commandSequence).padStart(12, "0")}`,
    expectedRevision,
    command,
  };
}

async function configuredRoom(code: string): Promise<{
  state: RoomState;
  seatTokens: Record<
    "host" | "redOperative" | "blueClue" | "blueOperative",
    string
  >;
  hostToken: string;
}> {
  const seatTokens = {
    host: "A".repeat(43),
    redOperative: "B".repeat(43),
    blueClue: "C".repeat(43),
    blueOperative: "D".repeat(43),
  };
  const hostToken = "E".repeat(43);
  const [
    hostHash,
    redOperativeHash,
    blueClueHash,
    blueOperativeHash,
    hostTokenHash,
  ] = await Promise.all([
    hashToken(seatTokens.host),
    hashToken(seatTokens.redOperative),
    hashToken(seatTokens.blueClue),
    hashToken(seatTokens.blueOperative),
    hashToken(hostToken),
  ]);
  const state = createLobbyState({
    code,
    inviteUrl: `https://cipher.example/room/${code}`,
    boardSeed: `seed-${code}`,
    hostPlayerId: "host",
    displayName: "Red Clue",
    seatTokenHash: hostHash,
    hostTokenHash,
    createdAt: new Date(REAL_PROCESS_TIME_MS).toISOString(),
  });
  state.startingTeam = "red";
  state.seats = [
    {
      ...state.seats[0]!,
      teamId: "red",
      role: "clue-giver",
      connected: true,
    },
    {
      playerId: "red-operative",
      displayName: "Red Operative",
      seatClass: "active",
      teamId: "red",
      role: "operative",
      connected: true,
      seatTokenHash: redOperativeHash,
    },
    {
      playerId: "blue-clue",
      displayName: "Blue Clue",
      seatClass: "active",
      teamId: "blue",
      role: "clue-giver",
      connected: true,
      seatTokenHash: blueClueHash,
    },
    {
      playerId: "blue-operative",
      displayName: "Blue Operative",
      seatClass: "active",
      teamId: "blue",
      role: "operative",
      connected: true,
      seatTokenHash: blueOperativeHash,
    },
  ];
  await roomStub(code).initialize(state);
  await expect(
    roomStub(code).dispatch(
      { playerId: "host", hostAuthority: true },
      envelope(0, { type: "start_board" }),
    ),
  ).resolves.toEqual({ ok: true, revision: 1 });
  return { state, seatTokens, hostToken };
}

async function issueRpcTicket(
  code: string,
  seatToken: string,
  hostToken: string | null = null,
): Promise<string> {
  const result = await roomStub(code).issueTicket({
    seatToken,
    hostToken,
    now: Date.now(),
  });
  if (!result.ok) {
    throw new Error(`ticket issue failed: ${result.code}`);
  }
  return result.ticket;
}

async function serverSocket(
  code: string,
  playerId: string,
): Promise<WebSocket> {
  return runInDurableObject(roomStub(code), (_instance, state) => {
    const socket = state
      .getWebSockets(playerId)
      .find((candidate) => candidate.readyState === WebSocket.OPEN);
    if (socket === undefined) {
      throw new Error(`missing server socket for ${playerId}`);
    }
    return socket;
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("room WebSocket admission", () => {
  it("fails closed on corrupt persisted state without replacing it or returning an admission projection", async () => {
    const created = await createRoom();
    const ticket = (await issueHttpTicket(created)).ticket;
    const before = await roomStub(created.code).getSnapshot();
    const corrupt = { ...before!, schemaVersion: 2 };
    await runInDurableObject(
      roomStub(created.code),
      async (_instance, state) => {
        await state.storage.put("room:snapshot", corrupt);
      },
    );
    await evictDurableObject(roomStub(created.code));
    const response = await connectResponse(created.code, ticket);
    if (response.webSocket) {
      response.webSocket.accept();
      response.webSocket.close();
    }
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(await roomStub(created.code).initialize(before!)).toEqual({
      ok: false,
      code: "already_initialized",
    });
    expect(await roomStub(created.code).getSnapshot()).toBeUndefined();
    await runInDurableObject(
      roomStub(created.code),
      async (_instance, state) => {
        expect(
          JSON.stringify(await state.storage.get("room:snapshot")) ===
            JSON.stringify(corrupt),
        ).toBe(true);
      },
    );
  });

  it("repairs a failed last-socket disconnect on the next room event without extending activity", async () => {
    const created = await createRoom();
    const probe = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await probe.next();
    const before = (await roomStub(created.code).getSnapshot())!;
    const server = await serverSocket(created.code, created.playerId);
    const write = vi
      .spyOn(RoomStorage.prototype, "write")
      .mockRejectedValue(new Error("injected write failure"));
    await runInDurableObject(roomStub(created.code), async (instance) => {
      server.close(1000, "closed");
      await instance.webSocketClose(server).catch(() => undefined);
    });
    expect(
      (await roomStub(created.code).getSnapshot())?.seats[0]?.connected,
    ).toBe(true);
    write.mockRestore();
    await connectResponse(created.code, "x".repeat(43));
    const after = (await roomStub(created.code).getSnapshot())!;
    expect(after.seats[0]?.connected).toBe(false);
    expect(after.lastActivity).toBe(before.lastActivity);
    expect(after.revision).toBe(before.revision + 1);
    const stableWrite = vi.spyOn(RoomStorage.prototype, "write");
    await connectResponse(created.code, "x".repeat(43));
    expect(stableWrite).not.toHaveBeenCalled();
    probe.close();
  });

  it("reconciles stale persisted presence at object load using only OPEN attachments", async () => {
    const created = await createRoom();
    const before = (await roomStub(created.code).getSnapshot())!;
    before.seats[0]!.connected = true;
    await runInDurableObject(
      roomStub(created.code),
      async (_instance, state) => {
        await state.storage.put("room:snapshot", before);
      },
    );
    await evictDurableObject(roomStub(created.code));
    const after = (await roomStub(created.code).getSnapshot())!;
    expect(after.seats[0]?.connected).toBe(false);
    expect(after.lastActivity).toBe(before.lastActivity);
    expect(after.revision).toBe(before.revision + 1);
  });

  it("counts malformed and replayed frames across same-seat sockets and hibernation without changing attachments", async () => {
    const room = await createRoom();
    const first = await connect(
      room.code,
      (await issueHttpTicket(room)).ticket,
    );
    await first.next();
    const second = await connect(
      room.code,
      (await issueHttpTicket(room)).ticket,
    );
    await Promise.all([first.next(), second.next()]);
    const seatLimit = {
      limit: vi
        .fn<(input: { key: string }) => Promise<{ success: boolean }>>()
        .mockResolvedValue({ success: true }),
    };
    const roomLimit = {
      limit: vi
        .fn<(input: { key: string }) => Promise<{ success: boolean }>>()
        .mockResolvedValue({ success: true }),
    };
    const command = JSON.stringify(
      envelope(2, { type: "lock_room", locked: true }),
    );
    const frames = [
      "{",
      "{}",
      new Uint8Array([1]).buffer,
      "x".repeat(16_385),
      command,
      command,
    ];
    await runInDurableObject(roomStub(room.code), async (instance, state) => {
      const runtime = instance as unknown as { env: Env };
      const previous = runtime.env;
      runtime.env = {
        ...previous,
        CANONICAL_ORIGIN: "https://budget.invalid",
        COMMAND_BY_SEAT: seatLimit,
        COMMAND_BY_ROOM: roomLimit,
      };
      try {
        const sockets = state.getWebSockets(room.playerId);
        for (const [index, frame] of frames.entries())
          await instance.webSocketMessage(sockets[index % 2]!, frame);
        for (const socket of sockets)
          expect(
            Object.keys(
              socket.deserializeAttachment() as RoomSocketAttachment,
            ).sort(),
          ).toEqual(["connectionId", "hostAuthority", "playerId"]);
      } finally {
        runtime.env = previous;
      }
    });
    expect(seatLimit.limit).toHaveBeenCalledTimes(6);
    expect(roomLimit.limit).toHaveBeenCalledTimes(6);
    await evictDurableObject(roomStub(room.code));
    await runInDurableObject(roomStub(room.code), async (instance, state) => {
      const runtime = instance as unknown as { env: Env };
      const previous = runtime.env;
      runtime.env = {
        ...previous,
        CANONICAL_ORIGIN: "https://budget.invalid",
        COMMAND_BY_SEAT: seatLimit,
        COMMAND_BY_ROOM: roomLimit,
      };
      try {
        await instance.webSocketMessage(
          state.getWebSockets(room.playerId)[0]!,
          command,
        );
      } finally {
        runtime.env = previous;
      }
    });
    expect(seatLimit.limit).toHaveBeenCalledTimes(7);
    expect(
      new Set(seatLimit.limit.mock.calls.map(([input]) => input.key)).size,
    ).toBe(1);
    expect(
      new Set(roomLimit.limit.mock.calls.map(([input]) => input.key)).size,
    ).toBe(1);
    first.close();
    second.close();
  });

  it("allows the 64th attached room socket and rejects the next before accept", async () => {
    const room = await createRoom();
    const legacyClients: WebSocket[] = [];
    await runInDurableObject(roomStub(room.code), (_instance, state) => {
      for (let index = 0; index < 63; index += 1) {
        const pair = new WebSocketPair();
        state.acceptWebSocket(pair[1], [`legacy-${index}`]);
        pair[1].serializeAttachment({
          connectionId: crypto.randomUUID(),
          playerId: `legacy-${index}`,
          hostAuthority: false,
        });
        pair[0].accept();
        legacyClients.push(pair[0]);
      }
    });
    const last = await connect(room.code, (await issueHttpTicket(room)).ticket);
    await last.next();
    const deniedTicket = (await issueHttpTicket(room)).ticket;
    await runInDurableObject(roomStub(room.code), async (instance, state) => {
      const accept = vi.spyOn(state, "acceptWebSocket");
      const response = await instance.fetch(
        new Request(
          `https://room.internal/api/rooms/${room.code}/connect?ticket=${deniedTicket}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(accept).not.toHaveBeenCalled();
      expect(state.getWebSockets()).toHaveLength(64);
      expect(
        (
          await instance.consumeTicket({
            ticket: deniedTicket,
            now: Date.now(),
          })
        ).ok,
      ).toBe(false);
    });
    last.close();
    await runInDurableObject(roomStub(room.code), () => {
      for (const client of legacyClients) client.close();
    });
  });

  it.each(["seat", "room", "missing", "failure"] as const)(
    "stops frames before dispatch when the message budget denies %s",
    async (dimension) => {
      const room = await createRoom();
      const probe = await connect(
        room.code,
        (await issueHttpTicket(room)).ticket,
      );
      await probe.next();
      const dispatch = vi.spyOn(RoomSession.prototype, "dispatch");
      const seat = {
        limit: vi.fn(async () => ({ success: dimension !== "seat" })),
      };
      const roomLimit = {
        limit: vi.fn(async () => ({ success: dimension !== "room" })),
      };
      if (dimension === "failure")
        seat.limit.mockRejectedValue(new Error("platform failed"));
      await runInDurableObject(roomStub(room.code), async (instance, state) => {
        const runtime = instance as unknown as { env: Env };
        const previous = runtime.env;
        runtime.env = {
          ...previous,
          CANONICAL_ORIGIN: "https://budget.invalid",
          COMMAND_BY_ROOM: roomLimit,
          ...(dimension === "missing" ? {} : { COMMAND_BY_SEAT: seat }),
        };
        try {
          const socket = state.getWebSockets()[0]!;
          const close = vi.spyOn(socket, "close");
          await instance.webSocketMessage(
            socket,
            JSON.stringify(envelope(1, { type: "lock_room", locked: true })),
          );
          expect(dispatch).not.toHaveBeenCalled();
          expect(close).toHaveBeenCalledWith(1013, "Room connection is busy");
          expect(roomLimit.limit).toHaveBeenCalledOnce();
          if (dimension !== "missing")
            expect(seat.limit).toHaveBeenCalledOnce();
        } finally {
          runtime.env = previous;
        }
      });
      probe.close();
    },
  );

  it("admits four concurrent seat sockets and rejects the fifth without evicting them", async () => {
    const room = await createRoom();
    const tickets = await Promise.all(
      Array.from({ length: 5 }, () => issueHttpTicket(room)),
    );
    const responses = await Promise.all(
      tickets.map(({ ticket }) => connectResponse(room.code, ticket)),
    );
    expect(responses.filter(({ status }) => status === 101)).toHaveLength(4);
    expect(responses.filter(({ status }) => status === 429)).toHaveLength(1);
    const inventory = await runInDurableObject(
      roomStub(room.code),
      (_instance, state) => state.getWebSockets().length,
    );
    expect(inventory).toBe(4);
    for (const response of responses) {
      if (response.webSocket !== null) {
        const probe = new SocketProbe(response.webSocket);
        await probe.next();
        probe.close();
      }
    }
  });

  it("sends stale, unauthorized, and duplicate resync only to the sender while mutations reach all sockets", async () => {
    const created = await createRoom();
    const joined = await joinRoom(created.code);
    const host = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await host.next();
    const guest = await connect(
      created.code,
      (await issueHttpTicket(joined)).ticket,
    );
    await Promise.all([guest.next(), host.next()]);
    const otherSend = vi.spyOn(
      await serverSocket(created.code, joined.playerId),
      "send",
    );
    const accepted = envelope(3, { type: "lock_room", locked: true });
    host.socket.send(JSON.stringify(accepted));
    await host.next();
    await host.next();
    await guest.next();
    expect(otherSend).toHaveBeenCalledTimes(1);
    otherSend.mockClear();
    for (const command of [
      accepted,
      envelope(0, { type: "lock_room", locked: false }),
    ]) {
      host.socket.send(JSON.stringify(command));
      expect((await host.next()).type).toBe("command_result");
      expect((await host.next()).type).toBe("projection");
      expect(otherSend).not.toHaveBeenCalled();
    }
    const hostSend = vi.spyOn(
      await serverSocket(created.code, created.playerId),
      "send",
    );
    guest.socket.send(
      JSON.stringify(envelope(4, { type: "lock_room", locked: false })),
    );
    expect(await guest.next()).toMatchObject({
      type: "command_result",
      result: { ok: false, code: "unauthorized", revision: 4 },
    });
    expect(await guest.next()).toMatchObject({
      type: "projection",
      projection: { revision: 4, locked: true },
    });
    expect(hostSend).not.toHaveBeenCalled();
    host.close();
    guest.close();
  });

  it("consumes a valid one-use ticket, persists presence, and sends a role-safe first frame", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);
    const room = await createRoom();
    const { ticket } = await issueHttpTicket(room);

    const socket = await connect(room.code, ticket);
    const message = await socket.next();

    expect(message).toMatchObject({
      type: "projection",
      projection: {
        revision: 1,
        viewRole: "unassigned",
        viewer: { playerId: room.playerId, isHost: true },
      },
    });
    expect(JSON.stringify(message)).not.toContain(room.seatToken);
    expect(JSON.stringify(message)).not.toContain(room.hostToken);
    expect(JSON.stringify(message)).not.toContain('"key"');
    await expect(roomStub(room.code).getSnapshot()).resolves.toMatchObject({
      revision: 1,
      lastActivity: INITIAL_TIME.toISOString(),
      seats: [{ playerId: room.playerId, connected: true }],
      connectionTickets: [],
    });
    await runInDurableObject(roomStub(room.code), (_instance, state) => {
      const attachment = state.getWebSockets()[0]!.deserializeAttachment() as
        RoomSocketAttachment | undefined;
      expect(Object.keys(attachment ?? {}).sort()).toEqual([
        "connectionId",
        "hostAuthority",
        "playerId",
      ]);
      expect(attachment).toMatchObject({
        playerId: room.playerId,
        hostAuthority: true,
      });
      expect(JSON.stringify(attachment)).not.toContain(room.seatToken);
      expect(JSON.stringify(attachment)).not.toContain(room.hostToken);
      expect(JSON.stringify(attachment)).not.toContain("team");
      expect(JSON.stringify(attachment)).not.toContain("role");
    });

    expect((await connectResponse(room.code, ticket)).status).toBe(401);
    socket.close();
  });

  it("returns the same opaque response for unavailable, malformed, expired, and non-upgrade admission", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);
    const room = await createRoom();
    const { ticket } = await issueHttpTicket(room);
    vi.setSystemTime(INITIAL_TIME.getTime() + 60_001);

    const responses = await Promise.all([
      connectResponse(room.code, ticket),
      request(`/api/rooms/${room.code}/connect`, {
        headers: { Upgrade: "websocket" },
      }),
      connectResponse(room.code, "not-a-ticket"),
      connectResponse("ZZZZZZ", "A".repeat(43)),
      request(`/api/rooms/${room.code}/connect?ticket=${"A".repeat(43)}`),
      request(
        `/api/rooms/${room.code}/connect?ticket=${"A".repeat(43)}&extra=1`,
        { headers: { Upgrade: "websocket" } },
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401, 401, 401, 401,
    ]);
    expect(
      await Promise.all(responses.map((response) => response.text())),
    ).toEqual(Array.from({ length: 6 }, () => "Unauthorized"));
  });

  it("selects only one winner when the same one-use ticket is presented concurrently", async () => {
    const room = await createRoom();
    const { ticket } = await issueHttpTicket(room);

    const responses = await Promise.all([
      connectResponse(room.code, ticket),
      connectResponse(room.code, ticket),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([101, 401]);
    const accepted = responses.find(({ status }) => status === 101)!;
    const socket = new SocketProbe(accepted.webSocket!);
    await expect(socket.next()).resolves.toMatchObject({
      type: "projection",
      projection: { revision: 1 },
    });
    await expect(roomStub(room.code).getSnapshot()).resolves.toMatchObject({
      revision: 1,
      connectionTickets: [],
    });
    socket.close();
  });

  it("closes and rolls presence offline when admission fails after ticket consumption", async () => {
    const room = await createRoom();
    const { ticket } = await issueHttpTicket(room);

    await runInDurableObject(roomStub(room.code), async (instance, state) => {
      vi.spyOn(state, "acceptWebSocket").mockImplementation(() => {
        throw new Error("simulated admission failure");
      });
      const response = await instance.fetch(
        new Request(
          `https://room.internal/api/rooms/${room.code}/connect?ticket=${ticket}`,
          { headers: { Upgrade: "websocket" } },
        ),
      );

      expect(response.status).toBe(401);
      expect(state.getWebSockets()).toHaveLength(0);
    });
    await expect(roomStub(room.code).getSnapshot()).resolves.toMatchObject({
      revision: 0,
      seats: [{ playerId: room.playerId, connected: false }],
      connectionTickets: [],
    });
  });

  it("keeps a delayed replacement online when the older socket closes before acceptance", async () => {
    const room = await createRoom();
    const first = await connect(
      room.code,
      (await issueHttpTicket(room)).ticket,
    );
    await first.next();
    const replacementTicket = (await issueHttpTicket(room)).ticket;
    const disconnectStarted = deferred<void>();
    let closingStarted = false;
    const originalDisconnect =
      PersistentRoomController.prototype.reconcilePresence;
    vi.spyOn(
      PersistentRoomController.prototype,
      "reconcilePresence",
    ).mockImplementation(function (this: PersistentRoomController, ...args) {
      if (closingStarted) disconnectStarted.resolve();
      return originalDisconnect.apply(this, args);
    });
    const race = await runInDurableObject(
      roomStub(room.code),
      async (instance, state) => {
        const oldServerSocket = state.getWebSockets(room.playerId)[0]!;
        const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
        let delayed = false;
        vi.spyOn(crypto.subtle, "digest").mockImplementation(
          async (algorithm, data) => {
            if (!delayed) {
              delayed = true;
              closingStarted = true;
              oldServerSocket.close(1000, "replaced during admission");
              void instance.webSocketClose(oldServerSocket);
              await disconnectStarted.promise;
            }
            return originalDigest(algorithm, data);
          },
        );
        const response = await instance.fetch(
          new Request(
            `https://room.internal/api/rooms/${room.code}/connect?ticket=${replacementTicket}`,
            { headers: { Upgrade: "websocket" } },
          ),
        );
        const replacement = new SocketProbe(response.webSocket!);
        const initial = await replacement.next();
        if (initial.type !== "projection") {
          throw new Error("expected replacement projection");
        }
        const snapshot = await instance.getSnapshot();
        const commandId = replacement.send(
          { type: "lock_room", locked: true },
          initial.projection.revision,
        );
        const commandResult = await replacement.next();
        replacement.close();
        return {
          status: response.status,
          initial,
          snapshot,
          commandId,
          commandResult,
        };
      },
    );

    expect(race.status).toBe(101);
    const initial = race.initial;
    expect(initial).toMatchObject({
      type: "projection",
      projection: {
        viewer: { playerId: room.playerId, isHost: true },
        seats: expect.arrayContaining([
          expect.objectContaining({
            playerId: room.playerId,
            connected: true,
          }),
        ]),
      },
    });
    if (initial.type !== "projection") {
      throw new Error("expected replacement projection");
    }
    expect(race.snapshot).toMatchObject({
      revision: initial.projection.revision,
      seats: [{ playerId: room.playerId, connected: true }],
    });
    expect(race.commandResult).toEqual({
      type: "command_result",
      commandId: race.commandId,
      result: { ok: true, revision: initial.projection.revision + 1 },
    });
  });
});

describe("role-safe WebSocket command flow", () => {
  it("persists before command_result and broadcasts separately derived role projections", async () => {
    const code = "R0AE01";
    const { seatTokens, hostToken } = await configuredRoom(code);
    const clue = await connect(
      code,
      await issueRpcTicket(code, seatTokens.host, hostToken),
    );
    expect(await clue.next()).toMatchObject({
      type: "projection",
      projection: { revision: 3, viewRole: "clue-giver" },
    });
    const operative = await connect(
      code,
      await issueRpcTicket(code, seatTokens.redOperative),
    );
    const [operativeAtThree, clueAtThree] = await Promise.all([
      operative.next(),
      clue.next(),
    ]);
    expect(operativeAtThree).toMatchObject({
      type: "projection",
      projection: { revision: 4, viewRole: "operative" },
    });
    expect(clueAtThree).toMatchObject({
      type: "projection",
      projection: { revision: 4, viewRole: "clue-giver" },
    });
    expect(JSON.stringify(clueAtThree)).toContain('"key"');
    expect(JSON.stringify(operativeAtThree)).not.toContain('"key"');
    expect(JSON.stringify(operativeAtThree)).not.toContain('"hazard"');

    const commandId = clue.send(
      { type: "submit_clue", word: "ember", count: 2 },
      4,
    );
    const result = await clue.next();
    expect(result).toEqual({
      type: "command_result",
      commandId,
      result: { ok: true, revision: 5 },
    });
    await expect(roomStub(code).getSnapshot()).resolves.toMatchObject({
      revision: 5,
      game: { clue: { word: "ember", count: 2 } },
    });
    const [clueProjection, operativeProjection] = await Promise.all([
      clue.next(),
      operative.next(),
    ]);
    expect(clueProjection).toMatchObject({
      type: "projection",
      projection: { revision: 5, viewRole: "clue-giver" },
    });
    expect(operativeProjection).toMatchObject({
      type: "projection",
      projection: { revision: 5, viewRole: "operative" },
    });
    expect(JSON.stringify(operativeProjection)).not.toContain('"key"');

    const operativeSend = vi.spyOn(
      await serverSocket(code, "red-operative"),
      "send",
    );
    const staleId = clue.send(
      { type: "submit_clue", word: "again", count: 1 },
      4,
    );
    await expect(clue.next()).resolves.toEqual({
      type: "command_result",
      commandId: staleId,
      result: {
        ok: false,
        revision: 5,
        code: "stale_revision",
        message: "Expected revision is stale",
      },
    });
    await expect(clue.next()).resolves.toMatchObject({
      type: "projection",
      projection: { revision: 5 },
    });
    expect(operativeSend).not.toHaveBeenCalled();

    clue.close();
    operative.close();
  });

  it("isolates invalid JSON, schema, binary, and oversized frames from healthy sockets", async () => {
    const created = await createRoom();
    const joined = await joinRoom(created.code);
    const host = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await host.next();
    const guest = await connect(
      created.code,
      (await issueHttpTicket(joined)).ticket,
    );
    await Promise.all([guest.next(), host.next()]);
    const healthyServerSocket = await serverSocket(
      created.code,
      created.playerId,
    );
    const healthySend = vi.spyOn(healthyServerSocket, "send");

    const invalidFrames: Array<string | ArrayBuffer> = [
      "{",
      JSON.stringify({ type: "replace_state", state: {} }),
      new Uint8Array([1, 2, 3]).buffer,
      "💥".repeat(4_097),
    ];
    for (const invalid of invalidFrames) {
      guest.socket.send(invalid);
      await expect(guest.next()).resolves.toEqual({
        type: "error",
        code: "invalid_message",
        message: "Message did not match protocol",
      });
    }
    expect(healthySend).not.toHaveBeenCalled();

    const commandId = host.send({ type: "lock_room", locked: true }, 3);
    await expect(host.next()).resolves.toEqual({
      type: "command_result",
      commandId,
      result: { ok: true, revision: 4 },
    });
    await expect(guest.next()).resolves.toMatchObject({
      type: "projection",
      projection: { revision: 4, locked: true },
    });
    host.close();
    guest.close();
  });

  it("keeps an accepted command and healthy broadcasts when one socket send throws", async () => {
    const created = await createRoom();
    const joined = await joinRoom(created.code);
    const host = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await host.next();
    const guest = await connect(
      created.code,
      (await issueHttpTicket(joined)).ticket,
    );
    await Promise.all([guest.next(), host.next()]);
    const failingSocket = await serverSocket(created.code, joined.playerId);
    vi.spyOn(failingSocket, "send").mockImplementation(() => {
      throw new Error("simulated isolated send failure");
    });

    const commandId = host.send({ type: "lock_room", locked: true }, 3);

    await expect(host.next()).resolves.toEqual({
      type: "command_result",
      commandId,
      result: { ok: true, revision: 4 },
    });
    await expect(host.next()).resolves.toMatchObject({
      type: "projection",
      projection: { revision: 4, locked: true },
    });
    await expect(roomStub(created.code).getSnapshot()).resolves.toMatchObject({
      revision: 4,
      locked: true,
    });
    host.close();
    guest.close();
  });

  it("keeps an accepted command when only the sender command_result send throws", async () => {
    const created = await createRoom();
    const joined = await joinRoom(created.code);
    const host = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await host.next();
    const guest = await connect(
      created.code,
      (await issueHttpTicket(joined)).ticket,
    );
    await Promise.all([guest.next(), host.next()]);
    const senderSocket = await serverSocket(created.code, created.playerId);
    const senderSend = vi.spyOn(senderSocket, "send");
    senderSend.mockImplementationOnce(() => {
      throw new Error("simulated command_result send failure");
    });

    host.send({ type: "lock_room", locked: true }, 3);

    await expect(guest.next()).resolves.toMatchObject({
      type: "projection",
      projection: { revision: 4, locked: true },
    });
    await expect(roomStub(created.code).getSnapshot()).resolves.toMatchObject({
      revision: 4,
      locked: true,
    });
    expect(senderSend).toHaveBeenCalledWith(
      expect.stringContaining('"type":"command_result"'),
    );
    host.close();
    guest.close();
  });

  it("broadcasts a persisted join but not public-revision-neutral ticket changes", async () => {
    const created = await createRoom();
    const host = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await host.next();
    const accepted = await serverSocket(created.code, created.playerId);
    const send = vi.spyOn(accepted, "send");

    await issueHttpTicket(created);
    expect(send).not.toHaveBeenCalled();

    const joined = await joinRoom(created.code, "Late Guest");
    const frame = await host.next();
    expect(frame).toMatchObject({
      type: "projection",
      projection: { revision: 2 },
    });
    if (frame.type !== "projection") {
      throw new Error("expected projection");
    }
    expect(frame.projection.seats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: joined.playerId,
          displayName: "Late Guest",
          connected: false,
        }),
      ]),
    );
    await expect(roomStub(created.code).getSnapshot()).resolves.toMatchObject({
      revision: 2,
      seats: expect.arrayContaining([
        expect.objectContaining({ playerId: joined.playerId }),
      ]),
    });
    host.close();
  });
});

describe("WebSocket reconnect, close, and hibernation", () => {
  it("reconnects the same player to a complete gameplay snapshot and converges presence revisions", async () => {
    const code = "REC0N1";
    const { seatTokens, hostToken } = await configuredRoom(code);
    const clue = await connect(
      code,
      await issueRpcTicket(code, seatTokens.host, hostToken),
    );
    await clue.next();
    const operative = await connect(
      code,
      await issueRpcTicket(code, seatTokens.redOperative),
    );
    await Promise.all([operative.next(), clue.next()]);
    operative.close();
    await expect(clue.next()).resolves.toMatchObject({
      type: "projection",
      projection: {
        revision: 5,
        seats: expect.arrayContaining([
          expect.objectContaining({
            playerId: "red-operative",
            connected: false,
          }),
        ]),
      },
    });

    const reconnected = await connect(
      code,
      await issueRpcTicket(code, seatTokens.redOperative),
    );
    const [operativeProjection, clueProjection] = await Promise.all([
      reconnected.next(),
      clue.next(),
    ]);
    expect(operativeProjection).toMatchObject({
      type: "projection",
      projection: {
        revision: 6,
        viewer: { playerId: "red-operative" },
        board: { phase: "clue", activeTeam: "red" },
      },
    });
    expect(clueProjection).toMatchObject({
      type: "projection",
      projection: {
        revision: 6,
        seats: expect.arrayContaining([
          expect.objectContaining({
            playerId: "red-operative",
            connected: true,
          }),
        ]),
      },
    });
    clue.close();
    reconnected.close();
  });

  it("keeps the newest overlapping connection online when the older socket closes", async () => {
    const created = await createRoom();
    const first = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await first.next();
    const second = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await Promise.all([second.next(), first.next()]);
    await expect(roomStub(created.code).getSnapshot()).resolves.toMatchObject({
      revision: 2,
      seats: [{ playerId: created.playerId, connected: true }],
    });

    first.close();
    await vi.waitFor(async () => {
      expect(await roomStub(created.code).getSnapshot()).toMatchObject({
        revision: 2,
        seats: [{ connected: true }],
      });
    });
    const lastActivity = (await roomStub(created.code).getSnapshot())!
      .lastActivity;
    second.close();
    await vi.waitFor(async () => {
      expect(await roomStub(created.code).getSnapshot()).toMatchObject({
        revision: 3,
        lastActivity,
        seats: [{ connected: false }],
      });
    });
  });

  it("preserves identity and state across hibernation and resumes from the attachment", async () => {
    const created = await createRoom();
    const host = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await host.next();

    await evictDurableObject(roomStub(created.code));
    const commandId = host.send({ type: "lock_room", locked: true }, 1);

    await expect(host.next()).resolves.toEqual({
      type: "command_result",
      commandId,
      result: { ok: true, revision: 2 },
    });
    await expect(host.next()).resolves.toMatchObject({
      type: "projection",
      projection: {
        revision: 2,
        locked: true,
        viewer: { playerId: created.playerId, isHost: true },
      },
    });
    host.close();
  });

  it("does not extend activity on close and treats expiry-triggered closes as no-ops", async () => {
    vi.useFakeTimers();
    const connectedAt = INITIAL_TIME;
    vi.setSystemTime(connectedAt);
    const created = await createRoom();
    const host = await connect(
      created.code,
      (await issueHttpTicket(created)).ticket,
    );
    await host.next();
    const activity = (await roomStub(created.code).getSnapshot())!.lastActivity;

    host.close();
    await vi.waitFor(async () => {
      expect(await roomStub(created.code).getSnapshot()).toMatchObject({
        revision: 2,
        lastActivity: activity,
        seats: [{ connected: false }],
      });
    });

    vi.setSystemTime(Date.parse(activity) + ROOM_IDLE_TTL_MS);
    await expect(runDurableObjectAlarm(roomStub(created.code))).resolves.toBe(
      true,
    );
    await expect(roomStub(created.code).getSnapshot()).resolves.toBeUndefined();
    await runInDurableObject(roomStub(created.code), async (instance) => {
      const pair = new WebSocketPair();
      pair[1].serializeAttachment({
        connectionId: crypto.randomUUID(),
        playerId: created.playerId,
        hostAuthority: true,
      });
      await instance.webSocketClose(pair[1]);
    });
    await expect(roomStub(created.code).getSnapshot()).resolves.toBeUndefined();
  });
});
