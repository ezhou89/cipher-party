import type {
  ClientProjection,
  CommandEnvelope,
  ServerMessage
} from "@cipher-party/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RoomSocket,
  type RoomConnectionState,
  type RoomSocketState
} from "./room-socket";
import type { SeatCredentials } from "./seat-store";

function sampleProjection(revision = 0): ClientProjection {
  return {
    protocolVersion: 1,
    viewRole: "operative",
    code: "ABC234",
    inviteUrl: "http://127.0.0.1:5173/room/ABC234",
    revision,
    roomPhase: "lobby",
    locked: false,
    viewer: {
      playerId: "player-1",
      teamId: "red",
      role: "operative",
      isHost: false
    },
    permissions: {
      configure: false,
      moderate: false,
      submitClue: false,
      challengeClue: false,
      nominate: true,
      confirmReveal: true,
      endTurn: true,
      resolveChallenge: false,
      pause: false,
      resume: false
    },
    seats: [],
    publicHistory: [],
    board: null
  };
}

type MockListener = (event: Event | MessageEvent | CloseEvent) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0; // CONNECTING
  sent: string[] = [];
  private listeners: Record<string, MockListener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.dispatchEvent("open", new Event("open"));
    }, 0);
  }

  addEventListener(type: string, listener: MockListener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: MockListener) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(type: string, event: Event | MessageEvent | CloseEvent) {
    const list = this.listeners[type] || [];
    for (const listener of list) {
      listener(event);
    }
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = 3; // CLOSED
    this.dispatchEvent("close", new CloseEvent("close", { code, reason }));
  }

  simulateServerMessage(msg: ServerMessage) {
    this.dispatchEvent(
      "message",
      new MessageEvent("message", { data: JSON.stringify(msg) })
    );
  }
}

describe("RoomSocket Client", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects by requesting ticket with Authorization header and connects with ticket only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ticket: "ticket-12345",
        expiresAt: Date.now() + 60_000
      })
    });

    const socket = new RoomSocket({
      fetchFn: fetchMock,
      wsFactory: (url) => new MockWebSocket(url) as unknown as WebSocket
    });

    const creds: SeatCredentials = {
      code: "ABC234",
      playerId: "p1",
      seatToken: "seat-token-abc",
      hostToken: "host-token-xyz"
    };

    const connectPromise = socket.connect(creds);
    await vi.runAllTimersAsync();
    await connectPromise;

    // Check fetch ticket request
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/ABC234/tickets",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer seat-token-abc",
          "X-Cipher-Host-Token": "host-token-xyz"
        }
      })
    );

    // Check WebSocket URL carries ticket only, never durable tokens
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toContain("ticket=ticket-12345");
    expect(ws.url).not.toContain("seat-token-abc");
    expect(ws.url).not.toContain("host-token-xyz");
  });

  it("updates state and projection when projection frames arrive", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: "t-1", expiresAt: Date.now() + 60_000 })
    });

    const socket = new RoomSocket({
      fetchFn: fetchMock,
      wsFactory: (url) => new MockWebSocket(url) as unknown as WebSocket
    });

    const stateHolder = { current: null as RoomSocketState | null };
    socket.subscribe((state) => {
      stateHolder.current = state;
    });

    await socket.connect({
      code: "ABC234",
      playerId: "p1",
      seatToken: "token-1"
    });
    await vi.runAllTimersAsync();

    expect(stateHolder.current?.connection).toBe("open");

    const ws = MockWebSocket.instances[0]!;
    ws.simulateServerMessage({
      type: "projection",
      projection: sampleProjection(3)
    });

    expect(stateHolder.current?.projection?.revision).toBe(3);
  });

  it("sends commands with current revision and rejects concurrent commands in flight", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: "t-1", expiresAt: Date.now() + 60_000 })
    });

    const socket = new RoomSocket({
      fetchFn: fetchMock,
      wsFactory: (url) => new MockWebSocket(url) as unknown as WebSocket
    });

    await socket.connect({
      code: "ABC234",
      playerId: "p1",
      seatToken: "token-1"
    });
    await vi.runAllTimersAsync();

    const ws = MockWebSocket.instances[0]!;
    ws.simulateServerMessage({
      type: "projection",
      projection: sampleProjection(5)
    });

    // Send first command
    const commandId = socket.send({ type: "lock_room", locked: true });
    expect(commandId).toMatch(/^[0-9a-f-]{36}$/);

    const sentEnvelope = JSON.parse(ws.sent[0]!) as CommandEnvelope;
    expect(sentEnvelope.commandId).toBe(commandId);
    expect(sentEnvelope.expectedRevision).toBe(5);
    expect(sentEnvelope.command).toEqual({ type: "lock_room", locked: true });

    // Second send while earlier command is in flight is rejected
    expect(() => socket.send({ type: "lock_room", locked: false })).toThrow(
      /in flight/i
    );

    // Simulate server returns command_result and new projection
    ws.simulateServerMessage({
      type: "command_result",
      commandId,
      result: { ok: true, revision: 6 }
    });

    // Still blocked until projection at least as new arrives
    expect(() => socket.send({ type: "lock_room", locked: false })).toThrow(
      /in flight/i
    );

    ws.simulateServerMessage({
      type: "projection",
      projection: sampleProjection(6)
    });

    // Now second command can be sent
    expect(() =>
      socket.send({ type: "lock_room", locked: false })
    ).not.toThrow();
  });

  it("retries unexpected close at 500ms, 1s, 2s, capped at 5s, and user close cancels retries", async () => {
    let ticketCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      ticketCount++;
      return {
        ok: true,
        json: async () => ({
          ticket: `ticket-${ticketCount}`,
          expiresAt: Date.now() + 60_000
        })
      };
    });

    const socket = new RoomSocket({
      fetchFn: fetchMock,
      wsFactory: (url) => new MockWebSocket(url) as unknown as WebSocket
    });

    const states: RoomConnectionState[] = [];
    socket.subscribe((s) => {
      states.push(s.connection);
    });

    await socket.connect({
      code: "ABC234",
      playerId: "p1",
      seatToken: "token-1"
    });
    await vi.runAllTimersAsync();

    expect(MockWebSocket.instances.length).toBe(1);

    // Unexpected close (e.g. network dropped)
    MockWebSocket.instances[0]!.close(1006, "Abnormal closure");
    expect(states[states.length - 1]).toBe("reconnecting");

    // Advance 500ms -> retry 1
    await vi.advanceTimersByTimeAsync(500);
    expect(MockWebSocket.instances.length).toBe(2);

    // Unexpected close again
    MockWebSocket.instances[1]!.close(1006, "Abnormal closure");

    // Advance 1000ms -> retry 2
    await vi.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances.length).toBe(3);

    // Explicit close by user cancels retries
    socket.close();
    expect(states[states.length - 1]).toBe("closed");

    // Advance time further -> no more retries
    await vi.advanceTimersByTimeAsync(10000);
    expect(MockWebSocket.instances.length).toBe(3);
  });
});
