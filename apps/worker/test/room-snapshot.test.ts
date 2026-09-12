import { describe, expect, it, vi } from "vitest";
import type { ClientCommand, CommandEnvelope } from "@cipher-party/protocol";
import { RoomSession } from "../src/room/room-session";
import { RoomStorage } from "../src/room/room-storage";
import {
  InvalidRoomSnapshotError,
  UnsupportedRoomSnapshotError,
  parseRoomSnapshot,
} from "../src/room/room-snapshot";
import { createLobbyState, type RoomState } from "../src/room/room-state";

const timestamp = "2026-09-12T00:00:00.000Z";
function lobby(): RoomState {
  return createLobbyState({
    code: "ABC123",
    inviteUrl: "https://example.invalid/room/ABC123",
    boardSeed: "snapshot-fixture",
    hostPlayerId: "host",
    displayName: "Host",
    seatTokenHash: "a".repeat(64),
    hostTokenHash: "b".repeat(64),
    createdAt: timestamp,
  });
}

async function generatedStates(
  completion: "hazard" | "targets" = "hazard",
): Promise<RoomState[]> {
  const initial = lobby();
  initial.seats[0]!.connected = true;
  for (const [index, playerId] of [
    "red-operative",
    "blue-clue",
    "blue-operative",
  ].entries()) {
    initial.seats.push({
      playerId,
      displayName: playerId,
      seatClass: "active",
      teamId: null,
      role: "unassigned",
      connected: true,
      seatTokenHash: String(index + 1).repeat(64),
    });
  }
  const session = RoomSession.from(initial);
  let sequence = 0;
  async function command(command: ClientCommand, playerId = "host") {
    const envelope: CommandEnvelope = {
      protocolVersion: 1,
      commandId: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      expectedRevision: session.snapshot().revision,
      command,
    };
    const result = await session.dispatch(
      { playerId, hostAuthority: playerId === "host" },
      envelope,
      new Date(timestamp),
    );
    if (!result.ok) throw new Error("Fixture command failed");
  }
  for (const [index, seat] of initial.seats.entries()) {
    await command({
      type: "assign_seat",
      playerId: seat.playerId,
      teamId: index < 2 ? "red" : "blue",
    });
    await command({
      type: "set_role",
      playerId: seat.playerId,
      role: index % 2 === 0 ? "clue-giver" : "operative",
    });
  }
  const states = [lobby(), session.snapshot()];
  await command({ type: "start_board" });
  states.push(session.snapshot());
  const team = session.snapshot().game!.activeTeam;
  const targets = Object.values(session.snapshot().game!.board.cards).filter(
    (card) => card.owner === team,
  );
  await command(
    {
      type: "submit_clue",
      word: "Signal",
      count: completion === "targets" ? targets.length : 1,
    },
    team === "red" ? "host" : "blue-clue",
  );
  states.push(session.snapshot());
  await command({ type: "pause_room" });
  states.push(session.snapshot());
  await command({ type: "resume_room" });
  await command(
    { type: "challenge_clue" },
    team === "red" ? "blue-clue" : "host",
  );
  states.push(session.snapshot());
  await command({ type: "resolve_challenge", decision: "accept" });
  const hazard = Object.values(session.snapshot().game!.board.cards).find(
    (card) => card.owner === "hazard",
  )!;
  const operative = team === "red" ? "red-operative" : "blue-operative";
  for (const card of completion === "targets" ? targets : [hazard]) {
    await command({ type: "nominate_card", cardId: card.id }, operative);
    states.push(session.snapshot());
    await command({ type: "confirm_reveal", cardId: card.id }, operative);
  }
  states.push(session.snapshot());
  return states;
}

function boundary(value: unknown) {
  const backing = {
    get: vi.fn(async () => structuredClone(value)),
    transaction: vi.fn(),
    deleteAll: vi.fn(),
  };
  return {
    backing,
    storage: new RoomStorage(backing as unknown as DurableObjectStorage),
  };
}

describe("strict v1 snapshot storage boundary", () => {
  it("distinguishes typed unsupported versions from invalid shapes with no raw validation details", () => {
    expect(() => parseRoomSnapshot({ ...lobby(), schemaVersion: 2 })).toThrow(
      UnsupportedRoomSnapshotError,
    );
    expect(() =>
      parseRoomSnapshot({ schemaVersion: 1, protocolVersion: 1 }),
    ).toThrow(InvalidRoomSnapshotError);
  });

  it("rejects a revealed hazard even when corrupt game state claims the clue phase", async () => {
    const state = (await generatedStates())[2]!;
    Object.values(state.game!.board.cards).find(
      (card) => card.owner === "hazard",
    )!.revealed = true;
    expect(() => parseRoomSnapshot(state)).toThrow(InvalidRoomSnapshotError);
  });

  it("rejects credential-bearing or non-HTTP invite URLs without normalizing them", () => {
    for (const inviteUrl of [
      "javascript:alert(1)",
      "https://user:password@example.invalid/room/ABC123",
      "https://example.invalid/room/ABC123?token=invalid",
    ]) {
      expect(() => parseRoomSnapshot({ ...lobby(), inviteUrl })).toThrow(
        InvalidRoomSnapshotError,
      );
    }
  });

  it("round trips generated lobby, clue, guess, paused, challenged, nomination and complete states", async () => {
    for (const state of [
      ...(await generatedStates()),
      ...(await generatedStates("targets")),
    ]) {
      const { storage } = boundary(state);
      const restored = await storage.read();
      expect(JSON.stringify(restored) === JSON.stringify(state)).toBe(true);
      if (restored?.game)
        expect(Object.getPrototypeOf(restored.game.board.cards)).toBeNull();
    }
  });

  it("distinguishes absence and retains valid old excess tickets", async () => {
    expect(await boundary(undefined).storage.read()).toBeUndefined();
    const state = lobby();
    state.connectionTickets = Array.from({ length: 257 }, (_, index) => ({
      ticketHash: index.toString(16).padStart(64, "0"),
      playerId: "host",
      hostAuthority: true,
      expiresAt: Date.parse(timestamp) + 60_000,
    }));
    expect(
      JSON.stringify(await boundary(state).storage.read()) ===
        JSON.stringify(state),
    ).toBe(true);
  });

  const mutations: Array<[string, (state: RoomState) => void]> = [
    ["schema upgrade", (state) => Object.assign(state, { schemaVersion: 2 })],
    [
      "protocol upgrade",
      (state) => Object.assign(state, { protocolVersion: 2 }),
    ],
    [
      "unknown root key",
      (state) => Object.assign(state, { rawReceipt: "invalid" }),
    ],
    [
      "invalid generated code",
      (state) => {
        state.code = "ABCI23";
      },
    ],
    [
      "relative invite",
      (state) => {
        state.inviteUrl = "/room/ABC123";
      },
    ],
    [
      "invalid timestamp",
      (state) => {
        state.lastActivity = "2026-02-30T00:00:00.000Z";
      },
    ],
    [
      "noncanonical timestamp",
      (state) => {
        state.createdAt = "2026-09-12";
      },
    ],
    [
      "negative revision",
      (state) => {
        state.revision = -1;
      },
    ],
    [
      "raw host credential",
      (state) => {
        state.hostTokenHash = "invalid";
      },
    ],
    [
      "duplicate seat",
      (state) => {
        state.seats.push(state.seats[0]!);
      },
    ],
    [
      "missing host",
      (state) => {
        state.hostPlayerId = "missing";
      },
    ],
    [
      "inconsistent spectator",
      (state) => {
        state.seats[0]!.seatClass = "spectator";
      },
    ],
    [
      "unknown seat key",
      (state) => Object.assign(state.seats[0]!, { token: "invalid" }),
    ],
    [
      "ticket missing seat",
      (state) => {
        state.connectionTickets = [
          {
            ticketHash: "c".repeat(64),
            playerId: "missing",
            hostAuthority: false,
            expiresAt: 123,
          },
        ];
      },
    ],
    [
      "ticket foreign host authority",
      (state) => {
        state.connectionTickets = [
          {
            ticketHash: "c".repeat(64),
            playerId: "red-operative",
            hostAuthority: true,
            expiresAt: 123,
          },
        ];
      },
    ],
    [
      "ticket nonfinite expiry",
      (state) => {
        state.connectionTickets = [
          {
            ticketHash: "c".repeat(64),
            playerId: "host",
            hostAuthority: true,
            expiresAt: Infinity,
          },
        ];
      },
    ],
    [
      "processed invalid digest",
      (state) => {
        state.processedCommands[0]!.payloadDigest = "invalid";
      },
    ],
    [
      "processed future result",
      (state) => {
        state.processedCommands[0]!.result.revision = state.revision + 1;
      },
    ],
    [
      "duplicate command ID",
      (state) => {
        state.processedCommands.push(state.processedCommands[0]!);
      },
    ],
    [
      "unknown result key",
      (state) =>
        Object.assign(state.processedCommands[0]!.result, { hidden: true }),
    ],
    [
      "history invalid timestamp",
      (state) => {
        state.publicHistory[0]!.at = "bad";
      },
    ],
    [
      "history future revision",
      (state) => {
        state.publicHistory[0]!.revision = state.revision + 1;
      },
    ],
    [
      "history hidden unknown key",
      (state) => Object.assign(state.publicHistory[0]!, { key: {} }),
    ],
    [
      "room game phase mismatch",
      (state) => {
        state.phase = "lobby";
      },
    ],
    [
      "missing game",
      (state) => {
        state.game = null;
      },
    ],
    [
      "invalid game phase",
      (state) => Object.assign(state.game!, { phase: "unknown" }),
    ],
    [
      "invalid paused resume",
      (state) => {
        state.game!.resumePhase = "clue";
      },
    ],
    [
      "unexpected winner",
      (state) => {
        state.game!.winner = "red";
      },
    ],
    [
      "negative guesses",
      (state) => {
        state.game!.guessesRemaining = -1;
      },
    ],
    [
      "unknown game key",
      (state) => Object.assign(state.game!, { deadline: 123 }),
    ],
    [
      "duplicate board order",
      (state) => {
        state.game!.board.order[0] = state.game!.board.order[1]!;
      },
    ],
    [
      "missing board card",
      (state) => {
        delete state.game!.board.cards[state.game!.board.order[0]!];
      },
    ],
    [
      "card key identity",
      (state) => {
        state.game!.board.cards[state.game!.board.order[0]!]!.id = "missing";
      },
    ],
    [
      "empty card label",
      (state) => {
        state.game!.board.cards[state.game!.board.order[0]!]!.label = "";
      },
    ],
    [
      "invalid owner",
      (state) =>
        Object.assign(state.game!.board.cards[state.game!.board.order[0]!]!, {
          owner: "green",
        }),
    ],
    [
      "invalid reveal",
      (state) =>
        Object.assign(state.game!.board.cards[state.game!.board.order[0]!]!, {
          revealed: 1,
        }),
    ],
    [
      "nomination missing seat",
      (state) => {
        state.game!.nomination = {
          playerId: "missing",
          cardId: state.game!.board.order[0]!,
        };
      },
    ],
    [
      "nomination missing card",
      (state) => {
        state.game!.nomination = {
          playerId: "red-operative",
          cardId: "missing",
        };
      },
    ],
  ];
  it.each(mutations)(
    "rejects %s without writing, clearing, or exposing validation values",
    async (_name, mutate) => {
      const state = (await generatedStates())[3]!;
      mutate(state);
      const { storage, backing } = boundary(state);
      const disposition = await storage.read().then(
        () => "accepted",
        (error: unknown) =>
          error instanceof Error ? error.message : "unknown failure",
      );
      expect(disposition).toMatch(
        /^Room snapshot (?:is invalid|version is unsupported)$/u,
      );
      expect(backing.transaction).not.toHaveBeenCalled();
      expect(backing.deleteAll).not.toHaveBeenCalled();
    },
  );
});
