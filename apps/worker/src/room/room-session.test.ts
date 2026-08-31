import type {
  PlayerId,
  SeatRole,
  TeamId,
  TextCard,
} from "@cipher-party/game-core";
import type {
  ClientCommand,
  CommandEnvelope,
  CommandErrorCode,
  CommandResult,
  PublicHistoryEntry,
  ViewerContext,
} from "@cipher-party/protocol";
import { describe, expect, it } from "vitest";

import { RoomSession } from "./room-session";
import {
  createLobbyState,
  type RoomActor,
  type RoomSeat,
  type RoomState,
} from "./room-state";
import { neutralWords } from "../fixtures/neutral-words";

const CREATED_AT = "2026-08-30T10:00:00.000Z";
const COMMAND_AT = new Date("2026-08-30T12:00:00.000Z");
let commandSequence = 0;

function commandId(): string {
  commandSequence += 1;
  return `00000000-0000-4000-8000-${String(commandSequence).padStart(12, "0")}`;
}

function envelope(
  expectedRevision: number,
  command: ClientCommand,
  id = commandId(),
): CommandEnvelope {
  return {
    protocolVersion: 1,
    commandId: id,
    expectedRevision,
    command,
  };
}

function seat(input: {
  playerId: PlayerId;
  displayName?: string;
  teamId?: TeamId | null;
  role?: SeatRole;
  connected?: boolean;
  seatClass?: "active" | "spectator";
  seatTokenHash?: string;
}): RoomSeat {
  const seatClass = input.seatClass ?? "active";
  return {
    playerId: input.playerId,
    displayName: input.displayName ?? input.playerId,
    seatClass,
    teamId: input.teamId ?? null,
    role:
      input.role ?? (seatClass === "spectator" ? "spectator" : "unassigned"),
    connected: input.connected ?? true,
    seatTokenHash: input.seatTokenHash ?? `seat-hash-${input.playerId}`,
  };
}

function lobbyState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    ...createLobbyState({
      code: "ABC123",
      inviteUrl: "https://play.example/room/ABC123",
      boardSeed: "room-seed",
      hostPlayerId: "host",
      displayName: "Host",
      seatTokenHash: "host-seat-hash",
      hostTokenHash: "host-authority-hash",
      createdAt: CREATED_AT,
    }),
    ...overrides,
  };
}

function configuredState(overrides: Partial<RoomState> = {}): RoomState {
  return lobbyState({
    seats: [
      seat({ playerId: "host", teamId: "red", role: "clue-giver" }),
      seat({ playerId: "red-operative", teamId: "red", role: "operative" }),
      seat({ playerId: "blue-clue", teamId: "blue", role: "clue-giver" }),
      seat({
        playerId: "blue-operative",
        teamId: "blue",
        role: "operative",
      }),
    ],
    ...overrides,
  });
}

function hostActor(): RoomActor {
  return { playerId: "host", hostAuthority: true };
}

function actor(playerId: PlayerId): RoomActor {
  return { playerId, hostAuthority: false };
}

function expectError(
  result: CommandResult,
  code: CommandErrorCode,
  revision: number,
): void {
  expect(result).toMatchObject({ ok: false, code, revision });
}

async function startedSession(
  state: RoomState = configuredState(),
  cardPool: readonly TextCard[] = neutralWords,
): Promise<RoomSession> {
  const session = RoomSession.from(state, { cardPool });
  expect(
    await session.dispatch(
      hostActor(),
      envelope(state.revision, { type: "start_board" }),
      COMMAND_AT,
    ),
  ).toEqual({ ok: true, revision: state.revision + 1 });
  return session;
}

function actorsForGame(session: RoomSession): {
  activeClue: RoomActor;
  opposingClue: RoomActor;
  activeOperative: RoomActor;
  opposingOperative: RoomActor;
} {
  const snapshot = session.snapshot();
  const activeTeam = snapshot.game!.activeTeam;
  const opposingTeam = activeTeam === "red" ? "blue" : "red";
  return {
    activeClue: actor(
      snapshot.seats.find(
        (candidate) =>
          candidate.teamId === activeTeam && candidate.role === "clue-giver",
      )!.playerId,
    ),
    opposingClue: actor(
      snapshot.seats.find(
        (candidate) =>
          candidate.teamId === opposingTeam && candidate.role === "clue-giver",
      )!.playerId,
    ),
    activeOperative: actor(
      snapshot.seats.find(
        (candidate) =>
          candidate.teamId === activeTeam && candidate.role === "operative",
      )!.playerId,
    ),
    opposingOperative: actor(
      snapshot.seats.find(
        (candidate) =>
          candidate.teamId === opposingTeam && candidate.role === "operative",
      )!.playerId,
    ),
  };
}

async function guessingSession(): Promise<RoomSession> {
  const session = await startedSession();
  const { activeClue } = actorsForGame(session);
  const revision = session.snapshot().revision;
  expect(
    await session.dispatch(
      activeClue,
      envelope(revision, { type: "submit_clue", word: "Orbit", count: 1 }),
      COMMAND_AT,
    ),
  ).toEqual({ ok: true, revision: revision + 1 });
  return session;
}

describe("createLobbyState and neutral fixture", () => {
  it("creates the exact disconnected host lobby shape and stable starter", () => {
    const state = lobbyState();

    expect(state).toEqual({
      schemaVersion: 1,
      protocolVersion: 1,
      code: "ABC123",
      inviteUrl: "https://play.example/room/ABC123",
      revision: 0,
      phase: "lobby",
      locked: false,
      createdAt: CREATED_AT,
      lastActivity: CREATED_AT,
      boardSeed: "room-seed",
      startingTeam: "blue",
      hostPlayerId: "host",
      hostTokenHash: "host-authority-hash",
      seats: [
        {
          playerId: "host",
          displayName: "Host",
          seatClass: "active",
          teamId: null,
          role: "unassigned",
          connected: false,
          seatTokenHash: "host-seat-hash",
        },
      ],
      game: null,
      publicHistory: [],
      connectionTickets: [],
      processedCommands: [],
    });
    expect(lobbyState().startingTeam).toBe("blue");
    expect(
      createLobbyState({
        code: "ABC123",
        inviteUrl: "https://play.example/room/ABC123",
        boardSeed: "seed-a",
        hostPlayerId: "host",
        displayName: "Host",
        seatTokenHash: "host-seat-hash",
        hostTokenHash: "host-authority-hash",
        createdAt: CREATED_AT,
      }).startingTeam,
    ).toBe("red");
  });

  it("exports the exact 50 original neutral words and stable IDs", () => {
    expect(neutralWords).toEqual(
      [
        "Lantern",
        "Orbit",
        "Harbor",
        "Velvet",
        "Compass",
        "Meadow",
        "Quartz",
        "Bridge",
        "Anchor",
        "Blossom",
        "Cabin",
        "Canyon",
        "Cedar",
        "Comet",
        "Copper",
        "Coral",
        "Crown",
        "Desert",
        "Echo",
        "Ember",
        "Feather",
        "Forest",
        "Fountain",
        "Glacier",
        "Hammer",
        "Horizon",
        "Island",
        "Ivory",
        "Journal",
        "Kite",
        "Lagoon",
        "Marble",
        "Meteor",
        "Mountain",
        "Needle",
        "Ocean",
        "Orchard",
        "Palace",
        "Pebble",
        "Pine",
        "Prism",
        "River",
        "Saddle",
        "Shadow",
        "Signal",
        "Summit",
        "Temple",
        "Thunder",
        "Willow",
        "Window",
      ].map((label, index) => ({
        id: `neutral-${String(index + 1).padStart(3, "0")}`,
        label,
      })),
    );
  });
});

describe("RoomSession lobby start rules", () => {
  it("starts only when both teams have one clue-giver and one operative", async () => {
    const session = RoomSession.from(configuredState());
    const result = await session.dispatch(
      hostActor(),
      envelope(0, { type: "start_board" }),
      COMMAND_AT,
    );

    expect(result).toEqual({ ok: true, revision: 1 });
    expect(session.snapshot().phase).toBe("playing");
    expect(session.snapshot().game?.board.order).toHaveLength(25);
    expect(session.snapshot().game?.board.startingTeam).toBe(
      session.snapshot().startingTeam,
    );
  });

  const invalidConfigurations: Array<{
    name: string;
    seats: RoomSeat[];
  }> = [
    {
      name: "a missing clue-giver",
      seats: configuredState().seats.map((candidate) =>
        candidate.playerId === "blue-clue"
          ? { ...candidate, role: "operative" }
          : candidate,
      ),
    },
    {
      name: "duplicate clue-givers",
      seats: configuredState().seats.map((candidate) =>
        candidate.playerId === "red-operative"
          ? { ...candidate, role: "clue-giver" }
          : candidate,
      ),
    },
    {
      name: "a missing operative",
      seats: configuredState().seats.filter(
        (candidate) => candidate.playerId !== "blue-operative",
      ),
    },
    {
      name: "a disconnected active seat",
      seats: configuredState().seats.map((candidate) =>
        candidate.playerId === "blue-operative"
          ? { ...candidate, connected: false }
          : candidate,
      ),
    },
    {
      name: "an unassigned active seat",
      seats: [
        ...configuredState().seats,
        seat({ playerId: "waiting", teamId: "red", role: "unassigned" }),
      ],
    },
    {
      name: "teams differing by more than one seat",
      seats: [
        ...configuredState().seats,
        seat({ playerId: "red-extra-1", teamId: "red", role: "operative" }),
        seat({ playerId: "red-extra-2", teamId: "red", role: "operative" }),
      ],
    },
  ];

  for (const example of invalidConfigurations) {
    it(`rejects start with ${example.name}`, async () => {
      const session = RoomSession.from(
        configuredState({ seats: example.seats }),
      );
      const before = session.snapshot();
      const result = await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        COMMAND_AT,
      );

      expectError(result, "invalid_command", 0);
      expect(session.snapshot()).toEqual(before);
    });
  }

  it("rejects a pool with fewer than 25 unique IDs", async () => {
    const session = RoomSession.from(configuredState(), {
      cardPool: neutralWords.slice(0, 24),
    });
    expectError(
      await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        COMMAND_AT,
      ),
      "invalid_command",
      0,
    );
  });

  it("rejects duplicate IDs anywhere in an injected pool", async () => {
    const duplicatePool = neutralWords.map((card) => ({ ...card }));
    duplicatePool[49] = { ...duplicatePool[0]! };
    const session = RoomSession.from(configuredState(), {
      cardPool: duplicatePool,
    });

    expectError(
      await session.dispatch(
        hostActor(),
        envelope(0, { type: "start_board" }),
        COMMAND_AT,
      ),
      "invalid_command",
      0,
    );
  });

  it("rejects non-host start before evaluating lobby validity", async () => {
    const session = RoomSession.from(
      configuredState({ seats: configuredState().seats.slice(0, 1) }),
    );
    expectError(
      await session.dispatch(
        actor("host"),
        envelope(0, { type: "start_board" }),
        COMMAND_AT,
      ),
      "unauthorized",
      0,
    );
  });

  it("rejects team assignment after play starts", async () => {
    const session = await startedSession();
    const revision = session.snapshot().revision;
    expectError(
      await session.dispatch(
        hostActor(),
        envelope(revision, {
          type: "assign_seat",
          playerId: "blue-operative",
          teamId: "red",
        }),
        COMMAND_AT,
      ),
      "wrong_phase",
      revision,
    );
  });

  it("rejects an active role without a team", async () => {
    const state = configuredState({
      seats: [
        ...configuredState().seats,
        seat({ playerId: "waiting", role: "unassigned", teamId: null }),
      ],
    });
    const session = RoomSession.from(state);
    expectError(
      await session.dispatch(
        hostActor(),
        envelope(0, {
          type: "set_role",
          playerId: "waiting",
          role: "operative",
        }),
        COMMAND_AT,
      ),
      "invalid_command",
      0,
    );
  });

  it("lets the host move a disconnected active seat to spectator before start", async () => {
    const state = configuredState({
      seats: [
        ...configuredState().seats,
        seat({
          playerId: "red-disconnected",
          teamId: "red",
          role: "operative",
          connected: false,
        }),
      ],
    });
    const session = RoomSession.from(state);

    expect(
      await session.dispatch(
        hostActor(),
        envelope(0, {
          type: "set_role",
          playerId: "red-disconnected",
          role: "spectator",
        }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: 1 });
    expect(
      await session.dispatch(
        hostActor(),
        envelope(1, { type: "start_board" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: 2 });
    expect(
      session
        .snapshot()
        .seats.find((candidate) => candidate.playerId === "red-disconnected"),
    ).toMatchObject({
      seatClass: "spectator",
      teamId: null,
      role: "spectator",
    });
  });
});

describe("RoomSession lobby mutations and capacity", () => {
  it("randomizes deterministically, balances active seats, skips spectators, and resets roles", async () => {
    const state = configuredState({
      revision: 7,
      seats: [
        ...configuredState().seats,
        seat({ playerId: "fifth", teamId: "red", role: "operative" }),
        seat({ playerId: "watcher", seatClass: "spectator" }),
      ],
    });
    const first = RoomSession.from(state);
    const second = RoomSession.from(state);
    const firstResult = await first.dispatch(
      hostActor(),
      envelope(7, { type: "randomize_teams" }),
      COMMAND_AT,
    );
    const secondResult = await second.dispatch(
      hostActor(),
      envelope(7, { type: "randomize_teams" }),
      COMMAND_AT,
    );

    expect(firstResult).toEqual({ ok: true, revision: 8 });
    expect(secondResult).toEqual({ ok: true, revision: 8 });
    expect(first.snapshot().seats).toEqual(second.snapshot().seats);
    const active = first
      .snapshot()
      .seats.filter((candidate) => candidate.seatClass === "active");
    expect(active.every((candidate) => candidate.role === "unassigned")).toBe(
      true,
    );
    expect(
      active.filter((candidate) => candidate.teamId === "red"),
    ).toHaveLength(3);
    expect(
      active.filter((candidate) => candidate.teamId === "blue"),
    ).toHaveLength(2);
    expect(first.snapshot().seats.at(-1)).toMatchObject({
      playerId: "watcher",
      seatClass: "spectator",
      teamId: null,
      role: "spectator",
    });
  });

  it("clearing an active seat team also resets its role", async () => {
    const session = RoomSession.from(configuredState());
    expect(
      await session.dispatch(
        hostActor(),
        envelope(0, {
          type: "assign_seat",
          playerId: "red-operative",
          teamId: null,
        }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: 1 });
    expect(
      session
        .snapshot()
        .seats.find((candidate) => candidate.playerId === "red-operative"),
    ).toMatchObject({ seatClass: "active", teamId: null, role: "unassigned" });
  });

  it("moves a spectator back to an unassigned active seat when capacity allows", async () => {
    const session = RoomSession.from(
      configuredState({
        seats: [
          ...configuredState().seats,
          seat({ playerId: "watcher", seatClass: "spectator" }),
        ],
      }),
    );
    expect(
      await session.dispatch(
        hostActor(),
        envelope(0, {
          type: "set_role",
          playerId: "watcher",
          role: "unassigned",
        }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: 1 });
    expect(session.snapshot().seats.at(-1)).toMatchObject({
      seatClass: "active",
      teamId: null,
      role: "unassigned",
    });
  });

  it("enforces the 16 active-seat limit when restoring a spectator", async () => {
    const active = Array.from({ length: 16 }, (_, index) =>
      seat({ playerId: index === 0 ? "host" : `active-${index}` }),
    );
    const session = RoomSession.from(
      lobbyState({
        seats: [
          ...active,
          seat({ playerId: "watcher", seatClass: "spectator" }),
        ],
      }),
    );
    expectError(
      await session.dispatch(
        hostActor(),
        envelope(0, {
          type: "set_role",
          playerId: "watcher",
          role: "unassigned",
        }),
        COMMAND_AT,
      ),
      "room_full",
      0,
    );
  });

  it("enforces the 16-spectator limit when moving an active seat", async () => {
    const spectators = Array.from({ length: 16 }, (_, index) =>
      seat({ playerId: `spectator-${index}`, seatClass: "spectator" }),
    );
    const session = RoomSession.from(
      lobbyState({
        seats: [seat({ playerId: "host" }), ...spectators],
      }),
    );
    expectError(
      await session.dispatch(
        hostActor(),
        envelope(0, {
          type: "set_role",
          playerId: "host",
          role: "spectator",
        }),
        COMMAND_AT,
      ),
      "room_full",
      0,
    );
  });

  it("rejects missing assignment targets and supports prototype-like player IDs", async () => {
    const state = configuredState({
      seats: [
        ...configuredState().seats,
        seat({ playerId: "__proto__", teamId: "red", role: "operative" }),
      ],
    });
    const session = RoomSession.from(state);
    expectError(
      await session.dispatch(
        hostActor(),
        envelope(0, {
          type: "assign_seat",
          playerId: "missing",
          teamId: "red",
        }),
        COMMAND_AT,
      ),
      "invalid_command",
      0,
    );
    expect(
      await session.dispatch(
        hostActor(),
        envelope(0, {
          type: "assign_seat",
          playerId: "__proto__",
          teamId: "blue",
        }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: 1 });
  });
});

describe("RoomSession authorization", () => {
  const lobbyHostCommands: ClientCommand[] = [
    { type: "randomize_teams" },
    { type: "assign_seat", playerId: "red-operative", teamId: "blue" },
    { type: "set_role", playerId: "red-operative", role: "spectator" },
    { type: "lock_room", locked: true },
    { type: "start_board" },
  ];

  for (const command of lobbyHostCommands) {
    it(`requires current connected host authority for ${command.type}`, async () => {
      for (const unauthorizedActor of [
        actor("host"),
        { playerId: "red-operative", hostAuthority: true },
        actor("missing"),
      ]) {
        const session = RoomSession.from(configuredState());
        expectError(
          await session.dispatch(
            unauthorizedActor,
            envelope(0, command),
            COMMAND_AT,
          ),
          "unauthorized",
          0,
        );
      }
      const disconnected = RoomSession.from(
        configuredState({
          seats: configuredState().seats.map((candidate) =>
            candidate.playerId === "host"
              ? { ...candidate, connected: false }
              : candidate,
          ),
        }),
      );
      expectError(
        await disconnected.dispatch(
          hostActor(),
          envelope(0, command),
          COMMAND_AT,
        ),
        "unauthorized",
        0,
      );
    });
  }

  it("allows only the connected active-team clue-giver to submit", async () => {
    const session = await startedSession();
    const { activeClue, opposingClue, activeOperative } =
      actorsForGame(session);
    const revision = session.snapshot().revision;
    for (const rejectedActor of [
      opposingClue,
      activeOperative,
      actor("missing"),
    ]) {
      expectError(
        await session.dispatch(
          rejectedActor,
          envelope(revision, { type: "submit_clue", word: "Orbit", count: 1 }),
          COMMAND_AT,
        ),
        "unauthorized",
        revision,
      );
    }
    expect(
      await session.dispatch(
        activeClue,
        envelope(revision, { type: "submit_clue", word: "Orbit", count: 1 }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: revision + 1 });
  });

  it("allows only the connected opposing clue-giver to challenge", async () => {
    const session = await guessingSession();
    const { activeClue, opposingClue, opposingOperative } =
      actorsForGame(session);
    const revision = session.snapshot().revision;
    for (const rejectedActor of [activeClue, opposingOperative]) {
      expectError(
        await session.dispatch(
          rejectedActor,
          envelope(revision, { type: "challenge_clue" }),
          COMMAND_AT,
        ),
        "unauthorized",
        revision,
      );
    }
    expect(
      await session.dispatch(
        opposingClue,
        envelope(revision, { type: "challenge_clue" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: revision + 1 });
  });

  const operativeCommands: ClientCommand[] = [
    { type: "nominate_card", cardId: "unknown-until-runtime" },
    { type: "clear_nomination" },
    { type: "confirm_reveal", cardId: "unknown-until-runtime" },
    { type: "end_turn" },
  ];

  for (const template of operativeCommands) {
    it(`requires a connected active-team operative for ${template.type}`, async () => {
      const session = await guessingSession();
      const { activeClue, opposingOperative } = actorsForGame(session);
      const revision = session.snapshot().revision;
      const cardId = session.snapshot().game!.board.order[0]!;
      const command: ClientCommand =
        template.type === "nominate_card" || template.type === "confirm_reveal"
          ? { ...template, cardId }
          : template;
      for (const rejectedActor of [
        activeClue,
        opposingOperative,
        actor("missing"),
      ]) {
        expectError(
          await session.dispatch(
            rejectedActor,
            envelope(revision, command),
            COMMAND_AT,
          ),
          "unauthorized",
          revision,
        );
      }
    });
  }

  it("requires matching connected host authority for challenge resolution, pause, and resume", async () => {
    const challenged = await guessingSession();
    const { opposingClue } = actorsForGame(challenged);
    let revision = challenged.snapshot().revision;
    await challenged.dispatch(
      opposingClue,
      envelope(revision, { type: "challenge_clue" }),
      COMMAND_AT,
    );
    revision += 1;
    expectError(
      await challenged.dispatch(
        actor("host"),
        envelope(revision, { type: "resolve_challenge", decision: "accept" }),
        COMMAND_AT,
      ),
      "unauthorized",
      revision,
    );
    expect(
      await challenged.dispatch(
        hostActor(),
        envelope(revision, { type: "resolve_challenge", decision: "accept" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: revision + 1 });

    revision += 1;
    expectError(
      await challenged.dispatch(
        actor("host"),
        envelope(revision, { type: "pause_room" }),
        COMMAND_AT,
      ),
      "unauthorized",
      revision,
    );
    expect(
      await challenged.dispatch(
        hostActor(),
        envelope(revision, { type: "pause_room" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });
    expectError(
      await challenged.dispatch(
        actor("host"),
        envelope(revision, { type: "resume_room" }),
        COMMAND_AT,
      ),
      "unauthorized",
      revision,
    );
    expect(
      await challenged.dispatch(
        hostActor(),
        envelope(revision, { type: "resume_room" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: revision + 1 });
  });
});

describe("RoomSession validation, revisions, idempotency, and isolation", () => {
  it("snapshots an unauthorized actor before the digest await", async () => {
    const session = RoomSession.from(configuredState());
    const mutableActor = actor("missing");
    const before = session.snapshot();

    const pending = session.dispatch(
      mutableActor,
      envelope(0, { type: "lock_room", locked: true }),
      COMMAND_AT,
    );
    mutableActor.playerId = "host";
    mutableActor.hostAuthority = true;

    expectError(await pending, "unauthorized", 0);
    expect(session.snapshot()).toEqual(before);
  });

  it("snapshots an authorized actor before the digest await", async () => {
    const session = RoomSession.from(configuredState());
    const mutableActor = hostActor();

    const pending = session.dispatch(
      mutableActor,
      envelope(0, { type: "lock_room", locked: true }),
      COMMAND_AT,
    );
    mutableActor.playerId = "missing";
    mutableActor.hostAuthority = false;

    expect(await pending).toEqual({ ok: true, revision: 1 });
    expect(session.snapshot().locked).toBe(true);
  });

  it("captures the command time before the digest await", async () => {
    const session = RoomSession.from(configuredState());
    const mutableNow = new Date("2026-08-30T12:00:00.000Z");

    const pending = session.dispatch(
      hostActor(),
      envelope(0, { type: "lock_room", locked: true }),
      mutableNow,
    );
    mutableNow.setUTCFullYear(2030);

    expect(await pending).toEqual({ ok: true, revision: 1 });
    expect(session.snapshot().lastActivity).toBe("2026-08-30T12:00:00.000Z");
  });

  it("rejects stale revisions without mutation", async () => {
    const session = RoomSession.from(configuredState({ revision: 4 }));
    const before = session.snapshot();
    const result = await session.dispatch(
      hostActor(),
      envelope(3, { type: "lock_room", locked: true }),
      COMMAND_AT,
    );
    expectError(result, "stale_revision", 4);
    expect(session.snapshot()).toEqual(before);
  });

  it("rejects invalid protocol/envelope shapes before idempotency", async () => {
    const session = RoomSession.from(configuredState());
    const before = session.snapshot();
    const invalid = {
      ...envelope(0, { type: "lock_room", locked: true }),
      protocolVersion: 2,
    } as unknown as CommandEnvelope;
    expectError(
      await session.dispatch(hostActor(), invalid, COMMAND_AT),
      "invalid_command",
      0,
    );
    expect(session.snapshot()).toEqual(before);
  });

  it("returns the original success for the same parsed command before stale or authorization checks", async () => {
    const session = RoomSession.from(configuredState());
    const id = commandId();
    const first = envelope(0, { type: "lock_room", locked: true }, id);
    expect(await session.dispatch(hostActor(), first, COMMAND_AT)).toEqual({
      ok: true,
      revision: 1,
    });
    const beforeReplay = session.snapshot();
    const replay = envelope(0, { locked: true, type: "lock_room" }, id);
    expect(
      await session.dispatch(
        actor("missing"),
        replay,
        new Date("2027-01-01T00:00:00Z"),
      ),
    ).toEqual({ ok: true, revision: 1 });
    expect(session.snapshot()).toEqual(beforeReplay);
  });

  it("digests canonical normalized parsed commands", async () => {
    const session = await startedSession();
    const { activeClue } = actorsForGame(session);
    const revision = session.snapshot().revision;
    const id = commandId();
    expect(
      await session.dispatch(
        activeClue,
        envelope(
          revision,
          { type: "submit_clue", word: "  Café  ", count: 1 },
          id,
        ),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: revision + 1 });
    expect(
      await session.dispatch(
        actor("missing"),
        envelope(
          revision,
          { type: "submit_clue", word: "Cafe\u0301", count: 1 },
          id,
        ),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: revision + 1 });
    expect(session.snapshot().game?.clue?.word).toBe("Café");
  });

  it("rejects command ID reuse with a different parsed payload", async () => {
    const session = RoomSession.from(configuredState());
    const id = commandId();
    await session.dispatch(
      hostActor(),
      envelope(0, { type: "lock_room", locked: true }, id),
      COMMAND_AT,
    );
    const before = session.snapshot();
    expectError(
      await session.dispatch(
        hostActor(),
        envelope(1, { type: "lock_room", locked: false }, id),
        COMMAND_AT,
      ),
      "invalid_command",
      1,
    );
    expect(session.snapshot()).toEqual(before);
  });

  it("caches successes only and keeps the newest 256", async () => {
    const session = RoomSession.from(configuredState());
    const failedId = commandId();
    await session.dispatch(
      actor("host"),
      envelope(0, { type: "lock_room", locked: true }, failedId),
      COMMAND_AT,
    );
    const successfulIds: string[] = [];
    for (let index = 0; index < 257; index += 1) {
      const id = commandId();
      successfulIds.push(id);
      const revision = session.snapshot().revision;
      const result = await session.dispatch(
        hostActor(),
        envelope(revision, { type: "lock_room", locked: index % 2 === 0 }, id),
        COMMAND_AT,
      );
      expect(result).toEqual({ ok: true, revision: revision + 1 });
    }

    const processed = session.snapshot().processedCommands;
    expect(processed).toHaveLength(256);
    expect(processed.map((entry) => entry.commandId)).toEqual(
      successfulIds.slice(1),
    );
    expect(processed.some((entry) => entry.commandId === failedId)).toBe(false);
  });

  it("increments once, records the supplied time, and never mutates caller objects", async () => {
    const source = configuredState();
    const session = RoomSession.from(source);
    source.locked = true;
    source.seats[0]!.displayName = "Mutated outside";
    expect(session.snapshot().locked).toBe(false);
    expect(session.snapshot().seats[0]!.displayName).toBe("host");

    const actorInput = hostActor();
    const envelopeInput = envelope(0, { type: "lock_room", locked: true });
    const actorBefore = structuredClone(actorInput);
    const envelopeBefore = structuredClone(envelopeInput);
    expect(
      await session.dispatch(actorInput, envelopeInput, COMMAND_AT),
    ).toEqual({ ok: true, revision: 1 });
    expect(actorInput).toEqual(actorBefore);
    expect(envelopeInput).toEqual(envelopeBefore);
    expect(session.snapshot()).toMatchObject({
      revision: 1,
      locked: true,
      lastActivity: COMMAND_AT.toISOString(),
    });

    const exposed = session.snapshot();
    exposed.locked = false;
    exposed.seats[0]!.displayName = "Snapshot mutation";
    expect(session.snapshot().locked).toBe(true);
    expect(session.snapshot().seats[0]!.displayName).toBe("host");
  });

  it("does not mutate session or caller inputs when reducer validation fails", async () => {
    const session = await guessingSession();
    const { activeOperative } = actorsForGame(session);
    const revision = session.snapshot().revision;
    const command = envelope(revision, {
      type: "nominate_card",
      cardId: "missing-card",
    });
    const before = session.snapshot();
    const commandBefore = structuredClone(command);
    expectError(
      await session.dispatch(activeOperative, command, COMMAND_AT),
      "invalid_command",
      revision,
    );
    expect(command).toEqual(commandBefore);
    expect(session.snapshot()).toEqual(before);
  });
});

describe("RoomSession game-core integration and public history", () => {
  it("maps clue, challenge, resolution, nomination, clear, reveal, end, pause, and resume", async () => {
    const session = await startedSession();
    const { activeClue, opposingClue, activeOperative } =
      actorsForGame(session);
    let revision = session.snapshot().revision;
    expect(
      await session.dispatch(
        activeClue,
        envelope(revision, { type: "submit_clue", word: "Orbit", count: 2 }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });
    expect(session.snapshot().game).toMatchObject({
      phase: "guess",
      clue: { word: "Orbit", count: 2 },
      guessesRemaining: 3,
    });
    expect(
      await session.dispatch(
        opposingClue,
        envelope(revision, { type: "challenge_clue" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });
    expect(session.snapshot().game?.phase).toBe("challenged");
    expect(
      await session.dispatch(
        hostActor(),
        envelope(revision, { type: "resolve_challenge", decision: "accept" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });

    const ownCard = session
      .snapshot()
      .game!.board.order.find(
        (cardId) =>
          session.snapshot().game!.board.cards[cardId]!.owner ===
          session.snapshot().game!.activeTeam,
      )!;
    expect(
      await session.dispatch(
        activeOperative,
        envelope(revision, { type: "nominate_card", cardId: ownCard }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });
    expect(session.snapshot().game?.nomination).toEqual({
      playerId: activeOperative.playerId,
      cardId: ownCard,
    });
    expect(
      await session.dispatch(
        activeOperative,
        envelope(revision, { type: "clear_nomination" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });
    expect(session.snapshot().game?.nomination).toBeNull();
    expect(
      await session.dispatch(
        activeOperative,
        envelope(revision, { type: "nominate_card", cardId: ownCard }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });
    expect(
      await session.dispatch(
        activeOperative,
        envelope(revision, { type: "confirm_reveal", cardId: ownCard }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });
    expect(session.snapshot().game!.board.cards[ownCard]!.revealed).toBe(true);
    expect(
      await session.dispatch(
        activeOperative,
        envelope(revision, { type: "end_turn" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });

    expect(
      await session.dispatch(
        hostActor(),
        envelope(revision, { type: "pause_room" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: ++revision });
    expect(session.snapshot().game?.phase).toBe("paused");
    expect(
      await session.dispatch(
        hostActor(),
        envelope(revision, { type: "resume_room" }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: revision + 1 });
    expect(session.snapshot().game?.phase).toBe("clue");

    expect(session.snapshot().publicHistory.map((entry) => entry.type)).toEqual(
      [
        "clue_submitted",
        "clue_challenged",
        "challenge_resolved",
        "card_revealed",
        "turn_ended",
        "room_paused",
        "room_resumed",
      ],
    );
    expect(session.snapshot().publicHistory[3]).toEqual({
      revision: 8,
      at: COMMAND_AT.toISOString(),
      type: "card_revealed",
      teamId: configuredState().startingTeam,
      cardId: ownCard,
      owner: configuredState().startingTeam,
    });
  });

  it("maps phase failures to wrong_phase and other reducer failures to invalid_command", async () => {
    const lobby = RoomSession.from(configuredState());
    expectError(
      await lobby.dispatch(
        actor("host"),
        envelope(0, { type: "submit_clue", word: "Orbit", count: 1 }),
        COMMAND_AT,
      ),
      "wrong_phase",
      0,
    );
    const session = await startedSession();
    const { activeOperative } = actorsForGame(session);
    const revision = session.snapshot().revision;
    expectError(
      await session.dispatch(
        activeOperative,
        envelope(revision, { type: "end_turn" }),
        COMMAND_AT,
      ),
      "wrong_phase",
      revision,
    );
  });

  it("marks the room complete when a reveal completes the board", async () => {
    const session = await guessingSession();
    const { activeOperative } = actorsForGame(session);
    const hazard = session
      .snapshot()
      .game!.board.order.find(
        (cardId) =>
          session.snapshot().game!.board.cards[cardId]!.owner === "hazard",
      )!;
    let revision = session.snapshot().revision;
    await session.dispatch(
      activeOperative,
      envelope(revision, { type: "nominate_card", cardId: hazard }),
      COMMAND_AT,
    );
    revision += 1;
    expect(
      await session.dispatch(
        activeOperative,
        envelope(revision, { type: "confirm_reveal", cardId: hazard }),
        COMMAND_AT,
      ),
    ).toEqual({ ok: true, revision: revision + 1 });
    expect(session.snapshot()).toMatchObject({
      phase: "complete",
      game: { phase: "board_complete", completionReason: "hazard" },
    });
  });

  it("trims public history to the newest 100 and adds no lobby/nomination entries", async () => {
    const oldHistory: PublicHistoryEntry[] = Array.from(
      { length: 100 },
      (_, index) => ({
        revision: index,
        at: CREATED_AT,
        type: "room_paused",
      }),
    );
    const session = await startedSession(
      configuredState({ publicHistory: oldHistory }),
    );
    expect(session.snapshot().publicHistory).toEqual(oldHistory);
    const { activeClue } = actorsForGame(session);
    const revision = session.snapshot().revision;
    await session.dispatch(
      activeClue,
      envelope(revision, { type: "submit_clue", word: "Orbit", count: 1 }),
      COMMAND_AT,
    );
    expect(session.snapshot().publicHistory).toHaveLength(100);
    expect(session.snapshot().publicHistory[0]?.revision).toBe(1);
    expect(session.snapshot().publicHistory.at(-1)).toMatchObject({
      revision: revision + 1,
      type: "clue_submitted",
    });
  });
});

describe("RoomSession projections", () => {
  it("passes only allowlisted projection data and leaks no hashes, tickets, cache, or hidden owner", async () => {
    const state = configuredState({
      connectionTickets: [
        {
          ticketHash: "TOP-SECRET-TICKET",
          playerId: "blue-operative",
          hostAuthority: false,
          expiresAt: 123,
        },
      ],
      processedCommands: [
        {
          commandId: commandId(),
          payloadDigest: "TOP-SECRET-DIGEST",
          result: { ok: true, revision: 0 },
        },
      ],
    });
    const session = await startedSession(state);
    const spectator: ViewerContext = {
      playerId: "outside-viewer",
      teamId: null,
      role: "spectator",
      isHost: false,
    };
    const projection = session.project(spectator);
    const serialized = JSON.stringify(projection);

    expect(serialized).not.toContain("TOP-SECRET");
    expect(serialized).not.toContain("host-authority-hash");
    expect(serialized).not.toContain("seat-hash");
    expect(serialized).not.toContain("processedCommands");
    expect(serialized).not.toContain("connectionTickets");
    expect(serialized).not.toContain("boardSeed");
    expect(projection.viewRole).toBe("spectator");
    expect(projection.board?.cards.every((card) => !("owner" in card))).toBe(
      true,
    );
  });

  it("returns projection copies that cannot mutate the session", async () => {
    const session = await startedSession();
    const viewer: ViewerContext = {
      playerId: "blue-operative",
      teamId: "blue",
      role: "operative",
      isHost: false,
    };
    const projection = session.project(viewer);
    projection.seats[0]!.displayName = "Mutated projection";
    projection.board!.order.reverse();

    expect(session.snapshot().seats[0]!.displayName).toBe("host");
    expect(session.project(viewer).board!.order).not.toEqual(
      projection.board!.order,
    );
  });
});
