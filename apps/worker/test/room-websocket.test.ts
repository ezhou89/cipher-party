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
import type { RoomDurableObject } from "../src/room/room-durable-object";
import type { RoomSocketAttachment } from "../src/room/room-websocket";
import { createLobbyState, type RoomState } from "../src/room/room-state";
import { ROOM_IDLE_TTL_MS } from "../src/room/room-storage";

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

let commandSequence = 0;

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
    createdAt: "2026-08-30T08:00:00.000Z",
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
  it("consumes a valid one-use ticket, persists presence, and sends a role-safe first frame", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:00:00.000Z"));
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
      lastActivity: "2026-08-30T10:00:00.000Z",
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
    vi.setSystemTime(new Date("2026-08-30T10:00:00.000Z"));
    const room = await createRoom();
    const { ticket } = await issueHttpTicket(room);
    vi.setSystemTime(new Date("2026-08-30T10:01:00.001Z"));

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
      revision: 2,
      seats: [{ playerId: room.playerId, connected: false }],
      connectionTickets: [],
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
      projection: { revision: 2, viewRole: "clue-giver" },
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
      projection: { revision: 3, viewRole: "operative" },
    });
    expect(clueAtThree).toMatchObject({
      type: "projection",
      projection: { revision: 3, viewRole: "clue-giver" },
    });
    expect(JSON.stringify(clueAtThree)).toContain('"key"');
    expect(JSON.stringify(operativeAtThree)).not.toContain('"key"');
    expect(JSON.stringify(operativeAtThree)).not.toContain('"hazard"');

    const commandId = clue.send(
      { type: "submit_clue", word: "ember", count: 2 },
      3,
    );
    const result = await clue.next();
    expect(result).toEqual({
      type: "command_result",
      commandId,
      result: { ok: true, revision: 4 },
    });
    await expect(roomStub(code).getSnapshot()).resolves.toMatchObject({
      revision: 4,
      game: { clue: { word: "ember", count: 2 } },
    });
    const [clueProjection, operativeProjection] = await Promise.all([
      clue.next(),
      operative.next(),
    ]);
    expect(clueProjection).toMatchObject({
      type: "projection",
      projection: { revision: 4, viewRole: "clue-giver" },
    });
    expect(operativeProjection).toMatchObject({
      type: "projection",
      projection: { revision: 4, viewRole: "operative" },
    });
    expect(JSON.stringify(operativeProjection)).not.toContain('"key"');

    const staleId = clue.send(
      { type: "submit_clue", word: "again", count: 1 },
      3,
    );
    await expect(clue.next()).resolves.toEqual({
      type: "command_result",
      commandId: staleId,
      result: {
        ok: false,
        revision: 4,
        code: "stale_revision",
        message: "Expected revision is stale",
      },
    });
    await expect(clue.next()).resolves.toMatchObject({
      type: "projection",
      projection: { revision: 4 },
    });
    await expect(operative.next()).resolves.toMatchObject({
      type: "projection",
      projection: { revision: 4 },
    });

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
        revision: 4,
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
        revision: 5,
        viewer: { playerId: "red-operative" },
        board: { phase: "clue", activeTeam: "red" },
      },
    });
    expect(clueProjection).toMatchObject({
      type: "projection",
      projection: {
        revision: 5,
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
    const connectedAt = new Date("2026-08-30T10:00:00.000Z");
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
