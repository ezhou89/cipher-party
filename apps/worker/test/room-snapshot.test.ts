import { describe, expect, it, vi } from "vitest";
import {
  createClassicBoard,
  createClassicGame,
  type TeamId,
} from "@cipher-party/game-core";
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

function fourTeamState(): RoomState {
  const state = lobby();
  const teams = ["red", "blue", "green", "yellow"] as const;
  state.teamCount = 4;
  state.configuredTeams = [...teams];
  state.startingTeam = "red";
  state.phase = "playing";
  state.seats = teams.flatMap((teamId, teamIndex) =>
    (["clue-giver", "operative"] as const).map((role, roleIndex) => ({
      playerId:
        teamId === "red" && role === "clue-giver"
          ? "host"
          : `${teamId}-${role}`,
      displayName: `${teamId} ${role}`,
      seatClass: "active" as const,
      teamId,
      role,
      connected: true,
      seatTokenHash: (teamIndex * 2 + roleIndex).toString(16).repeat(64),
    })),
  );
  state.game = createClassicGame(
    createClassicBoard({
      cards: Array.from({ length: 36 }, (_, index) => ({
        id: `card-${String(index).padStart(2, "0")}`,
        label: `Card ${index}`,
      })),
      seed: `${state.boardSeed}/board-0`,
      startingTeam: "red",
      teamCount: 4,
    }),
  );
  return state;
}

function threeTeamState(): RoomState {
  const state = fourTeamState();
  state.teamCount = 3;
  state.configuredTeams = ["red", "blue", "green"];
  state.seats = state.seats.filter((seat) => seat.teamId !== "yellow");
  state.game = createClassicGame(
    createClassicBoard({
      cards: Array.from({ length: 30 }, (_, index) => ({
        id: `card-${String(index).padStart(2, "0")}`,
        label: `Card ${index}`,
      })),
      seed: `${state.boardSeed}/board-0`,
      startingTeam: "red",
      teamCount: 3,
    }),
  );
  return state;
}

function legacyV1State(state: RoomState): unknown {
  const legacy = structuredClone(state) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 1;
  legacy.protocolVersion = 1;
  delete legacy.teamCount;
  delete legacy.configuredTeams;
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

function eliminatedFourTeamState(
  withRevealedEliminatedTarget = false,
): RoomState {
  const state = fourTeamState();
  const game = state.game!;
  const eliminatedTeam = game.activeTeam;
  if (withRevealedEliminatedTarget) {
    Object.values(game.board.cards).find(
      (card) => card.owner === eliminatedTeam,
    )!.revealed = true;
  }
  const hazard = Object.values(game.board.cards).find(
    (card) => card.owner === "hazard",
  )!;
  hazard.revealed = true;
  for (const card of Object.values(game.board.cards)) {
    if (card.owner === eliminatedTeam && !card.revealed) {
      card.owner = "neutral";
    }
  }
  game.eliminatedTeams = [eliminatedTeam];
  game.activeTeam = game.board.configuredTeams.find(
    (teamId) => teamId !== eliminatedTeam,
  )!;
  for (const seat of state.seats) {
    if (seat.teamId === eliminatedTeam) {
      seat.seatClass = "spectator";
      seat.teamId = null;
      seat.role = "spectator";
    }
  }
  state.revision = 1;
  state.publicHistory = [
    {
      revision: 1,
      at: timestamp,
      type: "card_revealed",
      teamId: eliminatedTeam,
      cardId: hazard.id,
      owner: "hazard",
      eliminatedTeam,
    },
  ];
  return state;
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
      protocolVersion: 2,
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

describe("strict v1/v2 snapshot storage boundary", () => {
  it("parses a generated four-team v2 snapshot", () => {
    const state = fourTeamState();

    const restored = parseRoomSnapshot(state);

    expect(restored).toEqual(state);
    expect(restored).toMatchObject({
      schemaVersion: 2,
      protocolVersion: 2,
      teamCount: 4,
      configuredTeams: ["red", "blue", "green", "yellow"],
      game: {
        board: { teamCount: 4, rows: 6, columns: 6 },
        eliminatedTeams: [],
      },
    });
    expect(Object.getPrototypeOf(restored.game!.board.cards)).toBeNull();
  });

  it("parses the supported three-team geometry and distribution", () => {
    const restored = parseRoomSnapshot(threeTeamState());

    expect(restored).toMatchObject({
      teamCount: 3,
      configuredTeams: ["red", "blue", "green"],
      game: { board: { teamCount: 3, rows: 5, columns: 6 } },
    });
    expect(restored.game?.board.order).toHaveLength(30);
  });

  it("normalizes a complete valid v1 two-team snapshot to v2", async () => {
    const legacy = legacyV1State((await generatedStates())[3]!);

    const normalized = parseRoomSnapshot(legacy);

    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.protocolVersion).toBe(2);
    expect(normalized.teamCount).toBe(2);
    expect(normalized.configuredTeams).toEqual(["red", "blue"]);
    expect(normalized.game?.board).toMatchObject({
      teamCount: 2,
      configuredTeams: ["red", "blue"],
      rows: 5,
      columns: 5,
    });
    expect(normalized.game?.eliminatedTeams).toEqual([]);
    expect(Object.getPrototypeOf(normalized.game!.board.cards)).toBeNull();
  });

  it("accepts coherent multi-team hazard elimination metadata", () => {
    const state = eliminatedFourTeamState();

    expect(parseRoomSnapshot(state)).toEqual(state);

    const withoutRetainedMetadata = eliminatedFourTeamState();
    const entry = withoutRetainedMetadata.publicHistory[0]!;
    if (entry.type === "card_revealed") delete entry.eliminatedTeam;
    expect(parseRoomSnapshot(withoutRetainedMetadata)).toEqual(
      withoutRetainedMetadata,
    );
  });

  it("accepts target completion after a prior multi-team hazard", () => {
    const state = eliminatedFourTeamState();
    const game = state.game!;
    const targets = Object.values(game.board.cards).filter(
      (card) => card.owner === game.activeTeam,
    );
    for (const card of targets) {
      card.revealed = true;
    }
    state.publicHistory.push(
      ...targets.map((card, index) => ({
        revision: index + 2,
        at: timestamp,
        type: "card_revealed" as const,
        teamId: game.activeTeam,
        cardId: card.id,
        owner: game.activeTeam,
      })),
    );
    state.revision = targets.length + 1;
    game.phase = "board_complete";
    game.clue = { word: "Signal", count: targets.length };
    game.guessesRemaining = 1;
    game.winner = game.activeTeam;
    game.completionReason = "targets";
    state.phase = "complete";

    expect(parseRoomSnapshot(state)).toEqual(state);
  });

  it("preserves revealed eliminated-team ownership without retained history", () => {
    const state = eliminatedFourTeamState(true);
    state.revision = 101;
    state.publicHistory = [];
    const eliminatedTeam = state.game!.eliminatedTeams[0]!;
    const revealedTarget = Object.values(state.game!.board.cards).find(
      (card) => card.owner === eliminatedTeam && card.revealed,
    )!;

    expect(parseRoomSnapshot(state)).toEqual(state);

    revealedTarget.owner = "neutral";
    expect(() => parseRoomSnapshot(state)).toThrow(InvalidRoomSnapshotError);
  });

  it.each([
    [
      "root configured-team order",
      (state: RoomState) => {
        state.configuredTeams = ["red", "blue", "yellow", "green"];
      },
    ],
    [
      "board dimensions",
      (state: RoomState) => {
        state.game!.board.rows = 5;
      },
    ],
    [
      "board team metadata",
      (state: RoomState) => {
        state.game!.board.configuredTeams = ["red", "blue", "green"];
      },
    ],
    [
      "ownership distribution",
      (state: RoomState) => {
        const neutral = Object.values(state.game!.board.cards).find(
          (card) => card.owner === "neutral",
        )!;
        neutral.owner = "red";
      },
    ],
    [
      "unconfigured seat assignment",
      (state: RoomState) => {
        state.teamCount = 3;
        state.configuredTeams = ["red", "blue", "green"];
      },
    ],
    [
      "missing configured-team operative",
      (state: RoomState) => {
        state.seats.find(
          (seat) => seat.teamId === "green" && seat.role === "operative",
        )!.role = "clue-giver";
      },
    ],
    [
      "room starting-team mirror",
      (state: RoomState) => {
        state.startingTeam = "blue";
      },
    ],
    [
      "zero history revision",
      (state: RoomState) => {
        state.publicHistory = [
          { revision: 0, at: timestamp, type: "room_paused" },
        ];
      },
    ],
    [
      "duplicate history revision",
      (state: RoomState) => {
        state.revision = 2;
        state.publicHistory = [
          { revision: 1, at: timestamp, type: "room_paused" },
          { revision: 1, at: timestamp, type: "room_resumed" },
        ];
      },
    ],
  ] as Array<[string, (state: RoomState) => void]>)(
    "rejects invalid four-team %s",
    (_name, mutate) => {
      const state = fourTeamState();
      mutate(state);

      expect(() => parseRoomSnapshot(state)).toThrow(InvalidRoomSnapshotError);
    },
  );

  it.each([
    [
      "active team",
      (state: RoomState, eliminatedTeam: TeamId) => {
        state.game!.activeTeam = eliminatedTeam;
      },
    ],
    [
      "duplicate elimination",
      (state: RoomState, eliminatedTeam: TeamId) => {
        state.game!.eliminatedTeams.push(eliminatedTeam);
      },
    ],
    [
      "active eliminated-team seats",
      (state: RoomState, eliminatedTeam: TeamId) => {
        const clueGiver = state.seats.find((seat) => seat.playerId === "host")!;
        clueGiver.seatClass = "active";
        clueGiver.teamId = eliminatedTeam;
        clueGiver.role = "clue-giver";
        const operative = state.seats.find(
          (seat) => seat.playerId === `${eliminatedTeam}-operative`,
        )!;
        operative.seatClass = "active";
        operative.teamId = eliminatedTeam;
        operative.role = "operative";
      },
    ],
    [
      "history elimination team",
      (state: RoomState) => {
        const entry = state.publicHistory[0]!;
        if (entry.type === "card_revealed") entry.eliminatedTeam = "blue";
      },
    ],
    [
      "history owner metadata",
      (state: RoomState) => {
        const entry = state.publicHistory[0]!;
        if (entry.type === "card_revealed") entry.owner = "neutral";
      },
    ],
    [
      "history elimination without state elimination",
      (state: RoomState) => {
        state.game!.eliminatedTeams = [];
      },
    ],
  ] as Array<[string, (state: RoomState, eliminatedTeam: TeamId) => void]>)(
    "rejects incoherent multi-team hazard %s",
    (_name, mutate) => {
      const state = eliminatedFourTeamState();
      mutate(state, state.game!.eliminatedTeams[0]!);

      expect(() => parseRoomSnapshot(state)).toThrow(InvalidRoomSnapshotError);
    },
  );

  it.each(["targets", "hazard"] as const)(
    "accepts genuine %s completion with its retained clue and rejects synthetic null-clue completion",
    async (reason) => {
      const states = await generatedStates(reason);
      const complete = states.at(-1)!;
      expect(complete.game?.phase).toBe("board_complete");
      expect(complete.game?.completionReason).toBe(reason);
      expect(complete.game?.clue !== null).toBe(true);
      expect(
        JSON.stringify(parseRoomSnapshot(complete)) ===
          JSON.stringify(complete),
      ).toBe(true);
      const synthetic = structuredClone(complete);
      synthetic.game!.clue = null;
      expect(() => parseRoomSnapshot(synthetic)).toThrow(
        InvalidRoomSnapshotError,
      );
      const unconfiguredWinner = structuredClone(complete);
      unconfiguredWinner.game!.winner = "green";
      expect(() => parseRoomSnapshot(unconfiguredWinner)).toThrow(
        InvalidRoomSnapshotError,
      );
    },
  );

  it("distinguishes typed unsupported versions from invalid shapes with no raw validation details", () => {
    expect(() => parseRoomSnapshot({ ...lobby(), schemaVersion: 3 })).toThrow(
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
    ["schema upgrade", (state) => Object.assign(state, { schemaVersion: 3 })],
    [
      "protocol upgrade",
      (state) => Object.assign(state, { protocolVersion: 3 }),
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
