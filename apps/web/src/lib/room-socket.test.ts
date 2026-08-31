import type { ClientProjection, ServerMessage } from "@cipher-party/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoomSocket, type RoomSocketDependencies } from "./room-socket";
import type { SeatCredentials } from "./seat-store";

const credentials: SeatCredentials = {
  code: "ABC123",
  playerId: "player-1",
  seatToken: "durable-seat-token",
  hostToken: "durable-host-token",
};

const permissions = {
  configure: false,
  moderate: false,
  submitClue: false,
  challengeClue: false,
  nominate: false,
  confirmReveal: false,
  endTurn: false,
  resolveChallenge: false,
  pause: false,
  resume: false,
};

function projection(revision: number): ClientProjection {
  return {
    protocolVersion: 1,
    revision,
    code: credentials.code,
    inviteUrl: `https://play.example/room/${credentials.code}`,
    roomPhase: "lobby",
    locked: false,
    viewRole: "unassigned",
    viewer: {
      playerId: credentials.playerId,
      teamId: null,
      role: "unassigned",
      isHost: true,
    },
    permissions,
    seats: [
      {
        playerId: credentials.playerId,
        displayName: "Player",
        teamId: null,
        role: "unassigned",
        connected: true,
      },
    ],
    publicHistory: [],
    board: null,
  };
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {}

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(message: ServerMessage | unknown): void {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("socket is not open");
    }
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code: 1000, wasClean: true }));
  }

  failClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code: 1006, wasClean: false }));
  }
}

function harness(options: { hostToken?: boolean } = {}) {
  const sockets: FakeWebSocket[] = [];
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];
  let ticket = 0;
  const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
    fetchCalls.push({ input, ...(init === undefined ? {} : { init }) });
    ticket += 1;
    return Response.json({
      ticket: `ticket-${ticket}`.padEnd(43, "x"),
      expiresAt: Date.now() + 60_000,
    });
  });
  const dependencies: RoomSocketDependencies = {
    fetch: fetchImpl,
    createWebSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    location: { protocol: "https:", host: "play.example" },
    randomUUID: () => "018f6c2e-6f44-7ef0-8000-000000000001",
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (handle) => window.clearTimeout(handle),
  };
  const credentialsWithoutHost: SeatCredentials = {
    code: credentials.code,
    playerId: credentials.playerId,
    seatToken: credentials.seatToken,
  };
  return {
    client: new RoomSocket(dependencies),
    sockets,
    fetchCalls,
    credentials:
      options.hostToken === false ? credentialsWithoutHost : credentials,
  };
}

function stateOf(client: RoomSocket) {
  let latest: Parameters<Parameters<RoomSocket["subscribe"]>[0]>[0] | null =
    null;
  const unsubscribe = client.subscribe((state) => {
    latest = state;
  });
  return { get: () => latest!, unsubscribe };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RoomSocket connection and strict projections", () => {
  it.each([true, false])(
    "requests a ticket with durable credentials in headers, never the WebSocket URL (host=%s)",
    async (withHostToken) => {
      const test = harness({ hostToken: withHostToken });

      await test.client.connect(test.credentials);

      expect(test.fetchCalls).toHaveLength(1);
      const call = test.fetchCalls[0]!;
      expect(String(call.input)).toBe("/api/rooms/ABC123/tickets");
      const headers = new Headers(call.init?.headers);
      expect(headers.get("authorization")).toBe(
        `Bearer ${credentials.seatToken}`,
      );
      expect(headers.get("x-cipher-host-token")).toBe(
        withHostToken ? credentials.hostToken : null,
      );
      expect(test.sockets[0]!.url).toBe(
        "wss://play.example/api/rooms/ABC123/connect?ticket=ticket-1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      );
      expect(test.sockets[0]!.url).not.toContain(credentials.seatToken);
      expect(test.sockets[0]!.url).not.toContain(credentials.hostToken);
      expect(test.sockets[0]!.url).not.toContain(credentials.playerId);
      test.client.close();
    },
  );

  it("updates from strict nondecreasing projections and ignores malformed or regressing frames", async () => {
    const test = harness();
    const observed = stateOf(test.client);
    await test.client.connect(credentials);
    const socket = test.sockets[0]!;
    socket.open();
    socket.receive({
      type: "projection",
      projection: { ...projection(9), key: { secret: "hazard" } },
    });
    expect(observed.get()).toMatchObject({
      connection: "open",
      projection: null,
    });

    socket.receive({ type: "projection", projection: projection(5) });
    expect(observed.get()).toMatchObject({
      connection: "open",
      projection: { revision: 5 },
    });
    socket.receive({ type: "projection", projection: projection(4) });
    expect(observed.get().projection?.revision).toBe(5);
    socket.receive({ type: "projection", projection: projection(5) });
    expect(observed.get().projection?.revision).toBe(5);
    test.client.close();
  });

  it("rejects a malformed ticket response before constructing a WebSocket", async () => {
    const test = harness();
    const malformedFetch: typeof fetch = vi.fn(async () =>
      Response.json({ ticket: credentials.seatToken }),
    );
    const dependencies: RoomSocketDependencies = {
      fetch: malformedFetch,
      createWebSocket: () => {
        throw new Error("must not construct a socket");
      },
      location: { protocol: "https:", host: "play.example" },
      randomUUID: () => crypto.randomUUID(),
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (handle) => window.clearTimeout(handle),
    };
    const client = new RoomSocket(dependencies);

    await expect(client.connect(credentials)).rejects.toThrow(/malformed/u);
    expect(test.sockets).toEqual([]);
  });
});

describe("RoomSocket authoritative command tracking", () => {
  it("uses UUID/current revision and clears in-flight only for both supported frame orders", async () => {
    const test = harness();
    await test.client.connect(credentials);
    const socket = test.sockets[0]!;
    socket.open();
    socket.receive({ type: "projection", projection: projection(5) });

    const firstId = test.client.send({ type: "lock_room", locked: true });
    expect(firstId).toBe("018f6c2e-6f44-7ef0-8000-000000000001");
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      protocolVersion: 1,
      commandId: firstId,
      expectedRevision: 5,
      command: { type: "lock_room", locked: true },
    });
    expect(() =>
      test.client.send({ type: "lock_room", locked: false }),
    ).toThrow(/in flight/u);
    socket.receive({
      type: "command_result",
      commandId: firstId,
      result: { ok: true, revision: 6 },
    });
    expect(() =>
      test.client.send({ type: "lock_room", locked: false }),
    ).toThrow(/in flight/u);
    socket.receive({ type: "projection", projection: projection(6) });

    const secondId = test.client.send({ type: "lock_room", locked: false });
    socket.receive({ type: "projection", projection: projection(7) });
    expect(() => test.client.send({ type: "lock_room", locked: true })).toThrow(
      /in flight/u,
    );
    socket.receive({
      type: "command_result",
      commandId: secondId,
      result: { ok: true, revision: 7 },
    });
    expect(() =>
      test.client.send({ type: "lock_room", locked: true }),
    ).not.toThrow();
    test.client.close();
  });

  it("waits for a fresh projection after stale_revision before allowing another command", async () => {
    const test = harness();
    const observed = stateOf(test.client);
    await test.client.connect(credentials);
    const socket = test.sockets[0]!;
    socket.open();
    socket.receive({ type: "projection", projection: projection(5) });
    const commandId = test.client.send({ type: "lock_room", locked: true });

    socket.receive({
      type: "command_result",
      commandId,
      result: {
        ok: false,
        revision: 5,
        code: "stale_revision",
        message: "Expected revision is stale",
      },
    });

    expect(observed.get().lastResult).toMatchObject({
      ok: false,
      code: "stale_revision",
    });
    expect(() =>
      test.client.send({ type: "lock_room", locked: false }),
    ).toThrow(/in flight/u);
    socket.receive({ type: "projection", projection: projection(5) });
    expect(() =>
      test.client.send({ type: "lock_room", locked: false }),
    ).not.toThrow();
    test.client.close();
  });

  it("retains and resends the identical in-flight envelope after a fresh reconnect projection", async () => {
    vi.useFakeTimers();
    const test = harness();
    await test.client.connect(credentials);
    const first = test.sockets[0]!;
    first.open();
    first.receive({ type: "projection", projection: projection(5) });
    test.client.send({ type: "lock_room", locked: true });
    const originalEnvelope = first.sent[0]!;
    first.failClose();

    await vi.advanceTimersByTimeAsync(500);
    const second = test.sockets[1]!;
    second.open();
    expect(second.sent).toEqual([]);
    expect(() =>
      test.client.send({ type: "lock_room", locked: false }),
    ).toThrow(/in flight/u);
    second.receive({ type: "projection", projection: projection(6) });
    expect(second.sent).toEqual([originalEnvelope]);
    expect(JSON.parse(second.sent[0]!).commandId).toBe(
      "018f6c2e-6f44-7ef0-8000-000000000001",
    );
    test.client.close();
  });
});

describe("RoomSocket reconnect lifecycle", () => {
  it("guards stale callbacks, obtains a new ticket, and backs off 500ms/1s/2s/4s/5s capped", async () => {
    vi.useFakeTimers();
    const test = harness();
    const observed = stateOf(test.client);
    await test.client.connect(credentials);
    const first = test.sockets[0]!;
    first.open();
    first.receive({ type: "projection", projection: projection(1) });
    first.failClose();
    expect(observed.get().connection).toBe("reconnecting");

    const delays = [500, 1_000, 2_000, 4_000, 5_000, 5_000];
    for (const [index, delay] of delays.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(test.sockets).toHaveLength(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(test.sockets).toHaveLength(index + 2);
      const current = test.sockets[index + 1]!;
      current.open();
      if (index === 0) {
        first.receive({ type: "projection", projection: projection(99) });
        first.open();
        expect(observed.get().projection?.revision).toBe(1);
      }
      current.failClose();
    }
    expect(test.fetchCalls).toHaveLength(7);
    expect(
      test.sockets.map((socket) =>
        new URL(socket.url).searchParams.get("ticket"),
      ),
    ).toEqual([
      "ticket-1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "ticket-2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "ticket-3xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "ticket-4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "ticket-5xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "ticket-6xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "ticket-7xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    ]);
    test.client.close();
  });

  it("manual close cancels retry timers and blocks old socket callbacks", async () => {
    vi.useFakeTimers();
    const test = harness();
    const observed = stateOf(test.client);
    await test.client.connect(credentials);
    const socket = test.sockets[0]!;
    socket.open();
    socket.receive({ type: "projection", projection: projection(1) });
    socket.failClose();

    test.client.close();
    socket.receive({ type: "projection", projection: projection(99) });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(test.sockets).toHaveLength(1);
    expect(test.fetchCalls).toHaveLength(1);
    expect(observed.get()).toMatchObject({
      connection: "closed",
      projection: { revision: 1 },
    });
  });
});
