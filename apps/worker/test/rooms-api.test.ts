import type { ClientCommand, CommandEnvelope } from "@cipher-party/protocol";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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

interface CreateRoomResponseData {
  code: string;
  inviteUrl: string;
  playerId: string;
  seatToken: string;
  hostToken: string;
}

interface JoinRoomResponseData {
  code: string;
  playerId: string;
  seatToken: string;
}

interface TicketResponseData {
  ticket: string;
  expiresAt: number;
}

interface ErrorResponseData {
  error: {
    code: string;
    message: string;
  };
}

describe("Room, Token, and Ticket HTTP APIs", () => {
  it("creates a room with six-character code, returns tokens, and does not leak tokens into inviteUrl or snapshot", async () => {
    const res = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Host Player" })
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Location")).toBeNull();

    const data = (await res.json()) as CreateRoomResponseData;
    expect(data.code).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    expect(data.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.seatToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.hostToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.inviteUrl).toBe(`http://127.0.0.1:5173/room/${data.code}`);
    expect(data.inviteUrl).not.toContain(data.seatToken);
    expect(data.inviteUrl).not.toContain(data.hostToken);

    // Inspect Durable Object snapshot to confirm tokens are never persisted in plaintext
    const id = env.ROOMS.idFromName(data.code);
    const stub = env.ROOMS.get(id);
    const snapshot = await stub.getSnapshot();
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(data.seatToken);
    expect(serialized).not.toContain(data.hostToken);
  });

  it("joins an unlocked room and allows duplicate display names", async () => {
    const createRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Alex" })
    });
    const { code, playerId: hostId } =
      (await createRes.json()) as CreateRoomResponseData;

    const joinRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Alex", asSpectator: false })
      }
    );

    expect(joinRes.status).toBe(200);
    expect(joinRes.headers.get("Cache-Control")).toBe("no-store");
    const joinData = (await joinRes.json()) as JoinRoomResponseData;
    expect(joinData.code).toBe(code);
    expect(joinData.playerId).not.toBe(hostId);
    expect(joinData.seatToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects join on a locked room with 409 room_locked", async () => {
    const createRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Host" })
    });
    const { code, playerId: hostId } =
      (await createRes.json()) as CreateRoomResponseData;

    const id = env.ROOMS.idFromName(code);
    const stub = env.ROOMS.get(id);
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(0, { type: "lock_room", locked: true }, testUuid(10))
    );

    const joinRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Player 2" })
      }
    );

    expect(joinRes.status).toBe(409);
    const data = (await joinRes.json()) as ErrorResponseData;
    expect(data.error.code).toBe("room_locked");
  });

  it("rejects active join after play starts with 409 room_in_progress, but allows spectator join", async () => {
    const createRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Host" })
    });
    const { code, playerId: hostId } =
      (await createRes.json()) as CreateRoomResponseData;

    const id = env.ROOMS.idFromName(code);
    const stub = env.ROOMS.get(id);

    // Join 3 players to reach minimum 4 players, and connect each seat via ticket
    for (let i = 1; i <= 3; i++) {
      const joinRes = await SELF.fetch(
        `http://127.0.0.1:5173/api/rooms/${code}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: `Player ${i}` })
        }
      );
      const joinData = (await joinRes.json()) as JoinRoomResponseData;
      const ticketRes = await SELF.fetch(
        `http://127.0.0.1:5173/api/rooms/${code}/tickets`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${joinData.seatToken}` }
        }
      );
      const { ticket } = (await ticketRes.json()) as TicketResponseData;
      await stub.consumeTicket(ticket, Date.now());
    }

    const snapshot = await stub.getSnapshot();

    // Assign seats and roles for start_board
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(
        snapshot.revision,
        {
          type: "assign_seat",
          playerId: snapshot.seats[0]!.playerId,
          teamId: "red"
        },
        testUuid(20)
      )
    );
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(
        snapshot.revision + 1,
        {
          type: "set_role",
          playerId: snapshot.seats[0]!.playerId,
          role: "clue-giver"
        },
        testUuid(21)
      )
    );
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(
        snapshot.revision + 2,
        {
          type: "assign_seat",
          playerId: snapshot.seats[1]!.playerId,
          teamId: "red"
        },
        testUuid(22)
      )
    );
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(
        snapshot.revision + 3,
        {
          type: "set_role",
          playerId: snapshot.seats[1]!.playerId,
          role: "operative"
        },
        testUuid(23)
      )
    );
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(
        snapshot.revision + 4,
        {
          type: "assign_seat",
          playerId: snapshot.seats[2]!.playerId,
          teamId: "blue"
        },
        testUuid(24)
      )
    );
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(
        snapshot.revision + 5,
        {
          type: "set_role",
          playerId: snapshot.seats[2]!.playerId,
          role: "clue-giver"
        },
        testUuid(25)
      )
    );
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(
        snapshot.revision + 6,
        {
          type: "assign_seat",
          playerId: snapshot.seats[3]!.playerId,
          teamId: "blue"
        },
        testUuid(26)
      )
    );
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(
        snapshot.revision + 7,
        {
          type: "set_role",
          playerId: snapshot.seats[3]!.playerId,
          role: "operative"
        },
        testUuid(27)
      )
    );
    await stub.dispatch(
      { playerId: hostId, hostAuthority: true },
      envelope(snapshot.revision + 8, { type: "start_board" }, testUuid(28))
    );

    // Active join after play starts -> 409 room_in_progress
    const activeJoinRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Late Player", asSpectator: false })
      }
    );
    expect(activeJoinRes.status).toBe(409);
    const activeData = (await activeJoinRes.json()) as ErrorResponseData;
    expect(activeData.error.code).toBe("room_in_progress");

    // Spectator join after play starts -> 200 OK
    const spectatorJoinRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "Spectator Player",
          asSpectator: true
        })
      }
    );
    expect(spectatorJoinRes.status).toBe(200);
  });

  it("enforces seat capacity (16 active, 16 spectators)", async () => {
    const createRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Host" })
    });
    const { code } = (await createRes.json()) as CreateRoomResponseData;

    // Host is seat 1. Join 15 more active seats (total 16 active).
    for (let i = 2; i <= 16; i++) {
      const joinRes = await SELF.fetch(
        `http://127.0.0.1:5173/api/rooms/${code}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: `Player ${i}`,
            asSpectator: false
          })
        }
      );
      expect(joinRes.status).toBe(200);
    }

    // 17th active seat returns 409 room_full
    const overCapacityActive = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Active 17", asSpectator: false })
      }
    );
    expect(overCapacityActive.status).toBe(409);
    const errData = (await overCapacityActive.json()) as ErrorResponseData;
    expect(errData.error.code).toBe("room_full");

    // Spectators still allowed up to 16
    const spectatorRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Spectator 1", asSpectator: true })
      }
    );
    expect(spectatorRes.status).toBe(200);
  });

  it("rejects invalid display names and malformed requests with 400", async () => {
    // Blank name
    const blankRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "   " })
    });
    expect(blankRes.status).toBe(400);

    // Control characters
    const ctrlRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Player\u0000One" })
    });
    expect(ctrlRes.status).toBe(400);

    // Too long (over 24 grapheme clusters)
    const longName = "A".repeat(25);
    const longRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: longName })
    });
    expect(longRes.status).toBe(400);

    // Non-JSON content type
    const nonJsonRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain text"
    });
    expect(nonJsonRes.status).toBe(400);

    // Body exceeds 4 KiB
    const hugeName = "A".repeat(5000);
    const hugeRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: hugeName })
    });
    expect(hugeRes.status).toBe(400);
  });

  it("returns uniform 404 for unknown or expired room without leaking status", async () => {
    const res = await SELF.fetch(
      "http://127.0.0.1:5173/api/rooms/NONEX1/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Player" })
      }
    );

    expect(res.status).toBe(404);
    const data = (await res.json()) as ErrorResponseData;
    expect(data.error.code).toBe("room_unavailable");
  });

  it("issues single-use 60-second tickets with bearer token auth, host token validation, and single consumption", async () => {
    const createRes = await SELF.fetch("http://127.0.0.1:5173/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Host" })
    });
    const {
      code,
      playerId: hostId,
      seatToken,
      hostToken
    } = (await createRes.json()) as CreateRoomResponseData;

    // Missing bearer token -> 401
    const unauthRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/tickets`,
      {
        method: "POST"
      }
    );
    expect(unauthRes.status).toBe(401);

    // Wrong bearer token -> 401
    const badTokenRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/tickets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer invalid-seat-token-that-does-not-exist`
        }
      }
    );
    expect(badTokenRes.status).toBe(401);

    // Invalid host token when host token is sent -> 401
    const badHostTokenRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/tickets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${seatToken}`,
          "X-Cipher-Host-Token": "invalid-host-token-that-does-not-match"
        }
      }
    );
    expect(badHostTokenRes.status).toBe(401);

    // Valid ticket with host authority
    const ticketRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/tickets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${seatToken}`,
          "X-Cipher-Host-Token": hostToken
        }
      }
    );
    expect(ticketRes.status).toBe(200);
    expect(ticketRes.headers.get("Cache-Control")).toBe("no-store");
    const ticketData = (await ticketRes.json()) as TicketResponseData;
    expect(ticketData.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const now = Date.now();
    expect(ticketData.expiresAt).toBeGreaterThan(now);
    expect(ticketData.expiresAt).toBeLessThanOrEqual(now + 60_000);

    // Consume ticket via DO: first consumption succeeds with host authority
    const id = env.ROOMS.idFromName(code);
    const stub = env.ROOMS.get(id);
    const consumeRes = await stub.consumeTicket(ticketData.ticket, now);
    expect(consumeRes).toEqual({
      ok: true,
      playerId: hostId,
      hostAuthority: true
    });

    // Second consumption of same ticket fails (single use)
    const secondConsume = await stub.consumeTicket(ticketData.ticket, now);
    expect(secondConsume).toEqual({
      ok: false,
      code: "invalid_ticket"
    });

    // Expired ticket fails
    const secondTicketRes = await SELF.fetch(
      `http://127.0.0.1:5173/api/rooms/${code}/tickets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${seatToken}`,
          "X-Cipher-Host-Token": hostToken
        }
      }
    );
    const secondTicketData =
      (await secondTicketRes.json()) as TicketResponseData;
    const expiredConsume = await stub.consumeTicket(
      secondTicketData.ticket,
      now + 61_000
    );
    expect(expiredConsume).toEqual({
      ok: false,
      code: "invalid_ticket"
    });
  });
});
