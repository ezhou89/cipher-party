import type {
  ClientCommand,
  ClientProjection,
  CommandEnvelope,
  ServerMessage
} from "@cipher-party/protocol";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { RoomDurableObject } from "../src/room/room-durable-object";
import type { RoomState } from "../src/room/room-state";

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

type RunInDO = <T, R = void>(
  stub: unknown,
  callback: (instance: T, state: DurableObjectState) => R | Promise<R>
) => Promise<R>;

const runInRoomDO = runInDurableObject as unknown as RunInDO;

class TestWebSocketQueue {
  private queue: ServerMessage[] = [];
  private waiter: ((msg: ServerMessage) => void) | null = null;

  constructor(private readonly ws: WebSocket) {
    this.ws.addEventListener("message", (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      if (this.waiter) {
        const cb = this.waiter;
        this.waiter = null;
        cb(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  nextMessage(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

async function createTestRoom(hostName = "Host"): Promise<CreateRoomResponse> {
  const res = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: hostName })
  });
  return (await res.json()) as CreateRoomResponse;
}

async function joinTestRoom(
  code: string,
  displayName: string,
  asSpectator = false
): Promise<JoinRoomResponse> {
  const res = await SELF.fetch(`http://127.0.0.1:5173/api/rooms/${code}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, asSpectator })
  });
  return (await res.json()) as JoinRoomResponse;
}

async function getTestTicket(
  code: string,
  seatToken: string,
  hostToken?: string
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${seatToken}`
  };
  if (hostToken) {
    headers["X-Cipher-Host-Token"] = hostToken;
  }
  const res = await SELF.fetch(
    `http://127.0.0.1:5173/api/rooms/${code}/tickets`,
    {
      method: "POST",
      headers
    }
  );
  const data = (await res.json()) as TicketResponse;
  return data.ticket;
}

function connectWebSocket(code: string, ticket: string): Promise<Response> {
  return SELF.fetch(
    `http://127.0.0.1:5173/api/rooms/${code}/connect?ticket=${ticket}`,
    {
      headers: { Upgrade: "websocket" }
    }
  );
}

describe("Room WebSocket Gateway and Realtime Protocol", () => {
  it("upgrades with status 101 for a valid ticket and delivers initial projection", async () => {
    const room = await createTestRoom();
    const ticket = await getTestTicket(
      room.code,
      room.seatToken,
      room.hostToken
    );

    const upgradeRes = await connectWebSocket(room.code, ticket);
    expect(upgradeRes.status).toBe(101);

    const ws = upgradeRes.webSocket;
    expect(ws).toBeDefined();
    ws!.accept();
    const queue = new TestWebSocketQueue(ws!);

    const firstMsg = await queue.nextMessage();
    expect(firstMsg.type).toBe("projection");
    if (firstMsg.type === "projection") {
      expect(firstMsg.projection.code).toBe(room.code);
      expect(firstMsg.projection.viewer.playerId).toBe(room.playerId);
      expect(firstMsg.projection.viewer.isHost).toBe(true);
    }
    ws!.close();
  });

  it("returns 401 for a reused or expired ticket", async () => {
    const room = await createTestRoom();
    const ticket = await getTestTicket(room.code, room.seatToken);

    // First connect uses ticket
    const firstRes = await connectWebSocket(room.code, ticket);
    expect(firstRes.status).toBe(101);
    firstRes.webSocket!.accept();
    firstRes.webSocket!.close();

    // Reusing ticket fails with 401
    const secondRes = await connectWebSocket(room.code, ticket);
    expect(secondRes.status).toBe(401);

    // Expired ticket fails with 401
    const secondTicket = await getTestTicket(room.code, room.seatToken);
    const id = env.ROOMS.idFromName(room.code);
    const stub = env.ROOMS.get(id);

    // Expire ticket in both storage and in-memory session state
    await runInRoomDO<RoomDurableObject>(stub, async (instance, state) => {
      const snap = (await state.storage.get<RoomState>("room:snapshot"))!;
      for (const t of snap.connectionTickets) {
        t.expiresAt = Date.now() - 1000;
      }
      await state.storage.put("room:snapshot", snap);
      instance.setSessionStateForTest(snap);
    });

    const expiredRes = await connectWebSocket(room.code, secondTicket);
    expect(expiredRes.status).toBe(401);
  });

  it("handles valid commands, persists state, and broadcasts projections to all connected clients", async () => {
    const room = await createTestRoom();
    const player2 = await joinTestRoom(room.code, "Player 2");

    const hostTicket = await getTestTicket(
      room.code,
      room.seatToken,
      room.hostToken
    );
    const p2Ticket = await getTestTicket(room.code, player2.seatToken);

    const hostRes = await connectWebSocket(room.code, hostTicket);
    const hostWs = hostRes.webSocket!;
    hostWs.accept();
    const hostQueue = new TestWebSocketQueue(hostWs);
    await hostQueue.nextMessage(); // host initial projection

    const p2Res = await connectWebSocket(room.code, p2Ticket);
    const p2Ws = p2Res.webSocket!;
    p2Ws.accept();
    const p2Queue = new TestWebSocketQueue(p2Ws);

    // Host receives broadcast projection (revision 2) and p2 receives initial projection (revision 2)
    const hostP2JoinedMsg = await hostQueue.nextMessage();
    const p2InitialMsg = await p2Queue.nextMessage();
    expect(hostP2JoinedMsg.type).toBe("projection");
    expect(p2InitialMsg.type).toBe("projection");

    // Host locks room
    hostWs.send(
      JSON.stringify(
        envelope(2, { type: "lock_room", locked: true }, testUuid(100))
      )
    );

    const hostResult = await hostQueue.nextMessage();
    expect(hostResult.type).toBe("command_result");
    if (hostResult.type === "command_result") {
      expect(hostResult.result.ok).toBe(true);
    }

    // Host receives updated projection showing locked: true
    const hostLockedMsg = await hostQueue.nextMessage();
    expect(hostLockedMsg.type).toBe("projection");
    if (hostLockedMsg.type === "projection") {
      expect(hostLockedMsg.projection.locked).toBe(true);
    }

    // P2 receives updated projection showing locked: true
    const p2Update = await p2Queue.nextMessage();
    expect(p2Update.type).toBe("projection");
    if (p2Update.type === "projection") {
      expect(p2Update.projection.locked).toBe(true);
    }

    hostWs.close();
    p2Ws.close();
  });

  it("delivers different projections for red clue-giver vs red operative at the same revision", async () => {
    const room = await createTestRoom();
    const p2 = await joinTestRoom(room.code, "Red Op");
    const p3 = await joinTestRoom(room.code, "Blue Clue");
    const p4 = await joinTestRoom(room.code, "Blue Op");

    // Connect all to mark them connected
    for (const p of [
      { token: room.seatToken, host: room.hostToken },
      { token: p2.seatToken },
      { token: p3.seatToken },
      { token: p4.seatToken }
    ]) {
      const t = await getTestTicket(room.code, p.token, p.host);
      const res = await connectWebSocket(room.code, t);
      res.webSocket!.accept();
      res.webSocket!.close();
    }

    const id = env.ROOMS.idFromName(room.code);
    const stub = env.ROOMS.get(id);
    const snap = await stub.getSnapshot();

    // Assign seats & roles: Host=red clue, p2=red op, p3=blue clue, p4=blue op
    await stub.dispatch(
      { playerId: room.playerId, hostAuthority: true },
      envelope(
        snap.revision,
        { type: "assign_seat", playerId: room.playerId, teamId: "red" },
        testUuid(1)
      )
    );
    await stub.dispatch(
      { playerId: room.playerId, hostAuthority: true },
      envelope(
        snap.revision + 1,
        { type: "set_role", playerId: room.playerId, role: "clue-giver" },
        testUuid(2)
      )
    );
    await stub.dispatch(
      { playerId: room.playerId, hostAuthority: true },
      envelope(
        snap.revision + 2,
        { type: "assign_seat", playerId: p2.playerId, teamId: "red" },
        testUuid(3)
      )
    );
    await stub.dispatch(
      { playerId: room.playerId, hostAuthority: true },
      envelope(
        snap.revision + 3,
        { type: "set_role", playerId: p2.playerId, role: "operative" },
        testUuid(4)
      )
    );
    await stub.dispatch(
      { playerId: room.playerId, hostAuthority: true },
      envelope(
        snap.revision + 4,
        { type: "assign_seat", playerId: p3.playerId, teamId: "blue" },
        testUuid(5)
      )
    );
    await stub.dispatch(
      { playerId: room.playerId, hostAuthority: true },
      envelope(
        snap.revision + 5,
        { type: "set_role", playerId: p3.playerId, role: "clue-giver" },
        testUuid(6)
      )
    );
    await stub.dispatch(
      { playerId: room.playerId, hostAuthority: true },
      envelope(
        snap.revision + 6,
        { type: "assign_seat", playerId: p4.playerId, teamId: "blue" },
        testUuid(7)
      )
    );
    await stub.dispatch(
      { playerId: room.playerId, hostAuthority: true },
      envelope(
        snap.revision + 7,
        { type: "set_role", playerId: p4.playerId, role: "operative" },
        testUuid(8)
      )
    );
    await stub.dispatch(
      { playerId: room.playerId, hostAuthority: true },
      envelope(snap.revision + 8, { type: "start_board" }, testUuid(9))
    );

    // Connect Red Clue (host) and Red Op (p2)
    const hostT = await getTestTicket(
      room.code,
      room.seatToken,
      room.hostToken
    );
    const p2T = await getTestTicket(room.code, p2.seatToken);

    const hostConn = await connectWebSocket(room.code, hostT);
    const hostWs = hostConn.webSocket!;
    hostWs.accept();
    const hostQueue = new TestWebSocketQueue(hostWs);
    await hostQueue.nextMessage(); // host connected

    const p2Conn = await connectWebSocket(room.code, p2T);
    const p2Ws = p2Conn.webSocket!;
    p2Ws.accept();
    const p2Queue = new TestWebSocketQueue(p2Ws);

    const hostMsg = (await hostQueue.nextMessage()) as {
      type: "projection";
      projection: ClientProjection;
    };
    const p2Msg = (await p2Queue.nextMessage()) as {
      type: "projection";
      projection: ClientProjection;
    };

    expect(hostMsg.projection.revision).toBe(p2Msg.projection.revision);
    expect(hostMsg.projection.viewRole).toBe("clue-giver");
    expect(p2Msg.projection.viewRole).toBe("operative");

    // Clue-giver projection has the key; Operative projection has NO key!
    expect("key" in hostMsg.projection).toBe(true);
    expect("key" in p2Msg.projection).toBe(false);

    hostWs.close();
    p2Ws.close();
  });

  it("handles disconnect and reconnect preserving player presence cleanly", async () => {
    const room = await createTestRoom();
    const t1 = await getTestTicket(room.code, room.seatToken, room.hostToken);
    const res1 = await connectWebSocket(room.code, t1);
    const ws1 = res1.webSocket!;
    ws1.accept();
    const queue1 = new TestWebSocketQueue(ws1);
    await queue1.nextMessage();

    // Reconnect with new ticket before closing ws1
    const t2 = await getTestTicket(room.code, room.seatToken, room.hostToken);
    const res2 = await connectWebSocket(room.code, t2);
    const ws2 = res2.webSocket!;
    ws2.accept();
    const queue2 = new TestWebSocketQueue(ws2);
    await queue2.nextMessage();

    // Close older socket ws1
    ws1.close();

    // Verify seat is STILL connected because ws2 is active
    const id = env.ROOMS.idFromName(room.code);
    const stub = env.ROOMS.get(id);
    const snap = await stub.getSnapshot();
    const hostSeat = snap.seats.find((s) => s.playerId === room.playerId);
    expect(hostSeat?.connected).toBe(true);

    ws2.close();
  });

  it("rejects malformed message frames with invalid_message without closing other sockets", async () => {
    const room = await createTestRoom();
    const p2 = await joinTestRoom(room.code, "Player 2");

    const t1 = await getTestTicket(room.code, room.seatToken, room.hostToken);
    const t2 = await getTestTicket(room.code, p2.seatToken);

    const res1 = await connectWebSocket(room.code, t1);
    const ws1 = res1.webSocket!;
    ws1.accept();
    const queue1 = new TestWebSocketQueue(ws1);
    await queue1.nextMessage(); // ws1 initial

    const res2 = await connectWebSocket(room.code, t2);
    const ws2 = res2.webSocket!;
    ws2.accept();
    const queue2 = new TestWebSocketQueue(ws2);
    await queue1.nextMessage(); // ws1 broadcast when ws2 connects
    await queue2.nextMessage(); // ws2 initial

    // Send malformed text frame
    ws1.send("NOT VALID JSON");

    const err = await queue1.nextMessage();
    expect(err.type).toBe("error");
    if (err.type === "error") {
      expect(err.code).toBe("invalid_message");
    }

    // ws2 remains open and healthy
    ws1.send(
      JSON.stringify(
        envelope(2, { type: "lock_room", locked: true }, testUuid(200))
      )
    );
    const hostResult = await queue1.nextMessage();
    expect(hostResult.type).toBe("command_result");

    const p2Update = await queue2.nextMessage();
    expect(p2Update.type).toBe("projection");

    ws1.close();
    ws2.close();
  });
});
