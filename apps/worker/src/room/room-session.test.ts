import type { TeamId } from "@cipher-party/game-core";
import type { ClientCommand, CommandEnvelope } from "@cipher-party/protocol";
import { describe, expect, it } from "vitest";
import { RoomSession } from "./room-session";
import {
  createLobbyState,
  type RoomActor,
  type RoomSeat,
  type RoomState
} from "./room-state";

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

function guestActor(playerId = "guest-1"): RoomActor {
  return { playerId, hostAuthority: false };
}

function configuredLobby(): RoomState {
  const state = createLobbyState({
    code: "TESTCODE",
    hostPlayerId: "host-1",
    hostDisplayName: "Host",
    hostTokenHash: "h-hash",
    seatTokenHash: "s-hash-1",
    boardSeed: "test-seed-123",
    inviteUrl: "https://cipher.party/TESTCODE",
    now: new Date("2026-08-30T12:00:00Z")
  });

  const seats: RoomSeat[] = [
    {
      playerId: "host-1",
      displayName: "Host",
      seatClass: "active",
      teamId: "red",
      role: "clue-giver",
      connected: true,
      seatTokenHash: "s-hash-1"
    },
    {
      playerId: "red-op",
      displayName: "Red Operative",
      seatClass: "active",
      teamId: "red",
      role: "operative",
      connected: true,
      seatTokenHash: "s-hash-2"
    },
    {
      playerId: "blue-clue",
      displayName: "Blue Clue",
      seatClass: "active",
      teamId: "blue",
      role: "clue-giver",
      connected: true,
      seatTokenHash: "s-hash-3"
    },
    {
      playerId: "blue-op",
      displayName: "Blue Operative",
      seatClass: "active",
      teamId: "blue",
      role: "operative",
      connected: true,
      seatTokenHash: "s-hash-4"
    }
  ];

  state.seats = seats;
  return state;
}

function configuredSession(): RoomSession {
  return RoomSession.from(configuredLobby());
}

describe("RoomSession Lobby and Game Aggregate", () => {
  describe("Lobby start preconditions", () => {
    it("starts only when both teams have one clue-giver and one operative", async () => {
      const session = configuredSession();
      const result = await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        new Date("2026-08-30T12:00:00Z")
      );
      expect(result).toEqual({ ok: true, revision: 1 });
      expect(session.snapshot().phase).toBe("playing");
      expect(session.snapshot().game?.board.order).toHaveLength(25);
    });

    it("rejects start when a clue-giver is missing", async () => {
      const lobby = configuredLobby();
      // Host becomes operative, so red has 2 operatives and 0 clue-givers
      lobby.seats.find((s) => s.playerId === "host-1")!.role = "operative";
      const session = RoomSession.from(lobby);

      const result = await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        new Date("2026-08-30T12:00:00Z")
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_command");
        expect(result.message).toContain("clue-giver");
      }
      expect(session.snapshot().phase).toBe("lobby");
    });

    it("rejects start when an active seat is unassigned", async () => {
      const lobby = configuredLobby();
      lobby.seats.find((s) => s.playerId === "host-1")!.role = "unassigned";
      const session = RoomSession.from(lobby);

      const result = await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        new Date("2026-08-30T12:00:00Z")
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_command");
        expect(result.message).toContain("unassigned");
      }
    });

    it("rejects start when an operative is missing", async () => {
      const lobby = configuredLobby();
      lobby.seats = lobby.seats.filter((s) => s.playerId !== "blue-op");
      const session = RoomSession.from(lobby);

      const result = await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        new Date("2026-08-30T12:00:00Z")
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_command");
        expect(result.message).toContain("operative");
      }
    });

    it("rejects start when a team has duplicate clue-givers", async () => {
      const lobby = configuredLobby();
      lobby.seats.find((s) => s.playerId === "red-op")!.role = "clue-giver";
      const session = RoomSession.from(lobby);

      const result = await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        new Date("2026-08-30T12:00:00Z")
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_command");
      }
    });

    it("rejects start when any active seat is disconnected", async () => {
      const lobby = configuredLobby();
      lobby.seats.find((s) => s.playerId === "red-op")!.connected = false;
      const session = RoomSession.from(lobby);

      const result = await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        new Date("2026-08-30T12:00:00Z")
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_command");
        expect(result.message).toContain("disconnected");
      }
    });

    it("rejects start when teams are uneven by more than one", async () => {
      const lobby = configuredLobby();
      lobby.seats.push({
        playerId: "red-extra",
        displayName: "Red Extra",
        seatClass: "active",
        teamId: "red",
        role: "operative",
        connected: true,
        seatTokenHash: "s-hash-5"
      });
      lobby.seats.push({
        playerId: "red-extra-2",
        displayName: "Red Extra 2",
        seatClass: "active",
        teamId: "red",
        role: "operative",
        connected: true,
        seatTokenHash: "s-hash-6"
      });
      // 4 on red, 2 on blue -> diff 2 > 1
      const session = RoomSession.from(lobby);

      const result = await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        new Date("2026-08-30T12:00:00Z")
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_command");
        expect(result.message).toContain("uneven");
      }
    });

    it("rejects non-host attempt to start board", async () => {
      const session = configuredSession();
      const result = await session.dispatch(
        guestActor("red-op"),
        envelope(0, { type: "start_board" }),
        new Date("2026-08-30T12:00:00Z")
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("unauthorized");
      }
    });

    it("allows host to move a disconnected active seat to spectator and then start board", async () => {
      const lobby = configuredLobby();
      // Add a 5th seat that is disconnected
      lobby.seats.push({
        playerId: "dc-player",
        displayName: "DC",
        seatClass: "active",
        teamId: "red",
        role: "operative",
        connected: false,
        seatTokenHash: "s-hash-dc"
      });
      const session = RoomSession.from(lobby);

      // Start fails because of disconnected active seat
      const failedStart = await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }, testUuid(10)),
        new Date("2026-08-30T12:00:00Z")
      );
      expect(failedStart.ok).toBe(false);

      // Host moves disconnected seat to spectator
      const moveResult = await session.dispatch(
        hostActor(),
        envelope(
          0,
          { type: "set_role", playerId: "dc-player", role: "spectator" },
          testUuid(11)
        ),
        new Date("2026-08-30T12:00:01Z")
      );
      expect(moveResult).toEqual({ ok: true, revision: 1 });

      const movedSeat = session
        .snapshot()
        .seats.find((s) => s.playerId === "dc-player");
      expect(movedSeat?.seatClass).toBe("spectator");
      expect(movedSeat?.role).toBe("spectator");
      expect(movedSeat?.teamId).toBeNull();

      // Now start succeeds at revision 1 -> 2
      const startResult = await session.dispatch(
        hostActor(),
        envelope(1, { type: "start_board" }, testUuid(12)),
        new Date("2026-08-30T12:00:02Z")
      );
      expect(startResult).toEqual({ ok: true, revision: 2 });
      expect(session.snapshot().phase).toBe("playing");
    });

    it("rejects seat assignment after play has started", async () => {
      const session = configuredSession();
      await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        new Date("2026-08-30T12:00:00Z")
      );

      const assignResult = await session.dispatch(
        hostActor(),
        envelope(
          1,
          { type: "assign_seat", playerId: "red-op", teamId: "blue" },
          testUuid(20)
        ),
        new Date("2026-08-30T12:00:01Z")
      );
      expect(assignResult.ok).toBe(false);
      if (!assignResult.ok) {
        expect(assignResult.code).toBe("wrong_phase");
      }
    });

    it("rejects assigning an active role without a team", async () => {
      const lobby = configuredLobby();
      const session = RoomSession.from(lobby);

      // Clear team first
      await session.dispatch(
        hostActor(),
        envelope(
          0,
          { type: "assign_seat", playerId: "red-op", teamId: null },
          testUuid(21)
        ),
        new Date("2026-08-30T12:00:00Z")
      );

      // Now try to set role to operative while team is null
      const setRoleResult = await session.dispatch(
        hostActor(),
        envelope(
          1,
          { type: "set_role", playerId: "red-op", role: "operative" },
          testUuid(22)
        ),
        new Date("2026-08-30T12:00:01Z")
      );
      expect(setRoleResult.ok).toBe(false);
      if (!setRoleResult.ok) {
        expect(setRoleResult.code).toBe("invalid_command");
      }
    });
  });

  describe("Authorization and Idempotency", () => {
    it("returns stale_revision on expectedRevision mismatch without mutation", async () => {
      const session = configuredSession();
      const result = await session.dispatch(
        hostActor(),
        envelope(99, { type: "lock_room", locked: true }),
        new Date("2026-08-30T12:00:00Z")
      );

      expect(result).toEqual({
        ok: false,
        revision: 0,
        code: "stale_revision",
        message: expect.any(String)
      });
      expect(session.snapshot().locked).toBe(false);
      expect(session.snapshot().revision).toBe(0);
    });

    it("repeats same result for duplicate commandId and same payload without second mutation", async () => {
      const session = configuredSession();
      const cmdEnv = envelope(
        0,
        { type: "lock_room", locked: true },
        testUuid(30)
      );

      const firstResult = await session.dispatch(
        hostActor(),
        cmdEnv,
        new Date("2026-08-30T12:00:00Z")
      );
      expect(firstResult).toEqual({ ok: true, revision: 1 });
      expect(session.snapshot().locked).toBe(true);

      // Repeat with same commandId and same payload
      const secondResult = await session.dispatch(
        hostActor(),
        cmdEnv,
        new Date("2026-08-30T12:00:01Z")
      );
      expect(secondResult).toEqual({ ok: true, revision: 1 });
      expect(session.snapshot().revision).toBe(1);
    });

    it("returns invalid_command when reusing commandId with different payload", async () => {
      const session = configuredSession();
      const first = envelope(
        0,
        { type: "lock_room", locked: true },
        testUuid(40)
      );
      await session.dispatch(
        hostActor(),
        first,
        new Date("2026-08-30T12:00:00Z")
      );

      const second = envelope(
        1,
        { type: "lock_room", locked: false },
        testUuid(40)
      );
      const secondResult = await session.dispatch(
        hostActor(),
        second,
        new Date("2026-08-30T12:00:01Z")
      );
      expect(secondResult.ok).toBe(false);
      if (!secondResult.ok) {
        expect(secondResult.code).toBe("invalid_command");
      }
    });

    it("enforces role-based command authorization in gameplay", async () => {
      const session = configuredSession();
      await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }, testUuid(50)),
        new Date("2026-08-30T12:00:00Z")
      );
      const snapshot = session.snapshot();
      const startingTeam = snapshot.game?.activeTeam as TeamId;
      const opposingTeam: TeamId = startingTeam === "red" ? "blue" : "red";

      const activeClueGiver = snapshot.seats.find(
        (s) => s.teamId === startingTeam && s.role === "clue-giver"
      )!.playerId;
      const activeOperative = snapshot.seats.find(
        (s) => s.teamId === startingTeam && s.role === "operative"
      )!.playerId;
      const opposingClueGiver = snapshot.seats.find(
        (s) => s.teamId === opposingTeam && s.role === "clue-giver"
      )!.playerId;

      // Operative cannot submit clue
      const opClue = await session.dispatch(
        guestActor(activeOperative),
        envelope(
          1,
          { type: "submit_clue", word: "Hi", count: 1 },
          testUuid(51)
        ),
        new Date("2026-08-30T12:00:01Z")
      );
      expect(opClue.ok).toBe(false);
      if (!opClue.ok) {
        expect(opClue.code).toBe("unauthorized");
      }

      // Opposing clue giver cannot submit clue
      const oppClue = await session.dispatch(
        guestActor(opposingClueGiver),
        envelope(
          1,
          { type: "submit_clue", word: "Hi", count: 1 },
          testUuid(52)
        ),
        new Date("2026-08-30T12:00:02Z")
      );
      expect(oppClue.ok).toBe(false);
      if (!oppClue.ok) {
        expect(oppClue.code).toBe("unauthorized");
      }

      // Active clue giver CAN submit clue
      const goodClue = await session.dispatch(
        activeClueGiver === "host-1"
          ? hostActor()
          : guestActor(activeClueGiver),
        envelope(
          1,
          { type: "submit_clue", word: "Galaxy", count: 2 },
          testUuid(53)
        ),
        new Date("2026-08-30T12:00:03Z")
      );
      expect(goodClue).toEqual({ ok: true, revision: 2 });
      expect(session.snapshot().game?.phase).toBe("guess");

      // Opposing clue giver CAN challenge clue
      const challenge = await session.dispatch(
        guestActor(opposingClueGiver),
        envelope(2, { type: "challenge_clue" }, testUuid(54)),
        new Date("2026-08-30T12:00:04Z")
      );
      expect(challenge).toEqual({ ok: true, revision: 3 });
      expect(session.snapshot().game?.phase).toBe("challenged");

      // Non-host cannot resolve challenge
      const nonHostResolve = await session.dispatch(
        guestActor(opposingClueGiver),
        envelope(
          3,
          { type: "resolve_challenge", decision: "accept" },
          testUuid(55)
        ),
        new Date("2026-08-30T12:00:05Z")
      );
      expect(nonHostResolve.ok).toBe(false);

      // Host CAN resolve challenge
      const hostResolve = await session.dispatch(
        hostActor(),
        envelope(
          3,
          { type: "resolve_challenge", decision: "accept" },
          testUuid(56)
        ),
        new Date("2026-08-30T12:00:06Z")
      );
      expect(hostResolve).toEqual({ ok: true, revision: 4 });
      expect(session.snapshot().game?.phase).toBe("guess");

      // Active operative can nominate and confirm reveal
      const gameSnapshot = session.snapshot().game;
      expect(gameSnapshot).not.toBeNull();
      const cardId = gameSnapshot!.board.order[0]!;
      const nom = await session.dispatch(
        guestActor(activeOperative),
        envelope(4, { type: "nominate_card", cardId }, testUuid(57)),
        new Date("2026-08-30T12:00:07Z")
      );
      expect(nom).toEqual({ ok: true, revision: 5 });

      const reveal = await session.dispatch(
        guestActor(activeOperative),
        envelope(5, { type: "confirm_reveal", cardId }, testUuid(58)),
        new Date("2026-08-30T12:00:08Z")
      );
      expect(reveal).toEqual({ ok: true, revision: 6 });
      expect(session.snapshot().game?.board.cards[cardId]?.revealed).toBe(true);
    });

    it("caps processedCommands to 256 entries", async () => {
      const session = configuredSession();
      // Send 260 distinct commands
      for (let i = 0; i < 260; i += 1) {
        const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        await session.dispatch(
          hostActor(),
          envelope(i, { type: "lock_room", locked: i % 2 === 0 }, uuid),
          new Date(1700000000000 + i * 1000)
        );
      }

      const commands = session.snapshot().processedCommands;
      expect(commands.length).toBe(256);
      // The oldest 4 commands (0, 1, 2, 3) should have been dropped
      const firstUuid = `00000000-0000-4000-8000-${String(0).padStart(12, "0")}`;
      expect(commands.find((c) => c.commandId === firstUuid)).toBeUndefined();
      const latestUuid = `00000000-0000-4000-8000-${String(259).padStart(12, "0")}`;
      expect(commands.find((c) => c.commandId === latestUuid)).toBeDefined();
    });
  });
});
