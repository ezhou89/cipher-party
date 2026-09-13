import type {
  BoardCard,
  ClassicGameState,
  PlayPhase,
  SeatRole,
  TeamCount,
  TeamId,
} from "@cipher-party/game-core";
import { describe, expect, it } from "vitest";

import {
  ClientProjectionSchema,
  projectRoomForSeat,
  type ClientProjection,
  type PublicHistoryEntry,
  type RoomProjectionSource,
  type ViewerContext,
} from "./projections";

const allFalsePermissions = {
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

function gameState(
  phase: PlayPhase = "clue",
  overrides: Partial<ClassicGameState> = {},
  teamCount: TeamCount = 2,
): ClassicGameState {
  const boardSpecs = {
    2: { rows: 5 as const, columns: 5 as const, cardCount: 25 },
    3: { rows: 5 as const, columns: 6 as const, cardCount: 30 },
    4: { rows: 6 as const, columns: 6 as const, cardCount: 36 },
  };
  const configuredTeams = ["red", "blue", "green", "yellow"].slice(
    0,
    teamCount,
  ) as TeamId[];
  const cards: Record<string, BoardCard> = Object.create(null);
  cards["red-1"] = {
    id: "red-1",
    label: "Ruby",
    owner: "red",
    revealed: true,
  };
  cards["blue-1"] = {
    id: "blue-1",
    label: "Ocean",
    owner: "blue",
    revealed: false,
  };
  cards["neutral-1"] = {
    id: "neutral-1",
    label: "Cloud",
    owner: "neutral",
    revealed: false,
  };
  cards["hazard-1"] = {
    id: "hazard-1",
    label: "Volcano",
    owner: "hazard",
    revealed: false,
  };
  cards["__proto__"] = {
    id: "__proto__",
    label: "Prototype",
    owner: "red",
    revealed: false,
  };
  cards["constructor"] = {
    id: "constructor",
    label: "Constructor",
    owner: "blue",
    revealed: false,
  };
  const order = [
    "red-1",
    "blue-1",
    "neutral-1",
    "hazard-1",
    "__proto__",
    "constructor",
  ];
  for (
    let index = order.length;
    index < boardSpecs[teamCount].cardCount;
    index += 1
  ) {
    const id = `filler-${index}`;
    const teamOwner = configuredTeams[index % configuredTeams.length]!;
    cards[id] = {
      id,
      label: `Filler ${index}`,
      owner: index % 3 === 0 ? teamOwner : "neutral",
      revealed: false,
    };
    order.push(id);
  }

  return {
    board: {
      teamCount,
      configuredTeams,
      rows: boardSpecs[teamCount].rows,
      columns: boardSpecs[teamCount].columns,
      order,
      cards,
      startingTeam: "red",
    },
    phase,
    resumePhase: null,
    activeTeam: "red",
    eliminatedTeams: [],
    clue: phase === "clue" ? null : { word: "ember", count: 2 },
    guessesRemaining: phase === "clue" ? 0 : 3,
    nomination: null,
    winner: null,
    completionReason: null,
    ...overrides,
  };
}

function roomSource(input?: {
  viewer?: Partial<ViewerContext>;
  connected?: boolean | undefined;
  roomPhase?: RoomProjectionSource["roomPhase"] | undefined;
  game?: ClassicGameState | null;
  publicHistory?: PublicHistoryEntry[];
  protocolVersion?: number;
  teamCount?: TeamCount;
  configuredTeams?: TeamId[];
}): RoomProjectionSource {
  const viewer: ViewerContext = {
    playerId: "viewer",
    teamId: "red",
    role: "operative",
    isHost: false,
    ...input?.viewer,
  };

  const game = input?.game === undefined ? gameState() : input.game;
  const teamCount = input?.teamCount ?? game?.board.teamCount ?? 2;
  const configuredTeams =
    input?.configuredTeams ??
    game?.board.configuredTeams ??
    (["red", "blue", "green", "yellow"].slice(0, teamCount) as TeamId[]);

  return {
    protocolVersion: input?.protocolVersion ?? 2,
    code: "ABC123",
    inviteUrl: "https://cipher.example/room/ABC123",
    revision: 42,
    roomPhase: input?.roomPhase ?? "playing",
    locked: true,
    teamCount,
    configuredTeams,
    seats: [
      {
        playerId: viewer.playerId,
        displayName: "Viewer",
        teamId: viewer.teamId,
        role: viewer.role,
        connected: input?.connected ?? true,
      },
      {
        playerId: "red-clue",
        displayName: "Red Clue",
        teamId: "red",
        role: "clue-giver",
        connected: true,
      },
    ],
    publicHistory: input?.publicHistory ?? [
      {
        revision: 40,
        at: "2026-08-30T17:00:00.000Z",
        type: "card_revealed",
        teamId: "red",
        cardId: "red-1",
        owner: "red",
      },
    ],
    game,
  };
}

function viewer(
  role: SeatRole,
  teamId: TeamId | null,
  isHost = false,
): ViewerContext {
  return { playerId: "viewer", role, teamId, isHost };
}

function projectionFor(input: {
  role: SeatRole;
  teamId: TeamId | null;
  isHost?: boolean;
  connected?: boolean;
  roomPhase?: RoomProjectionSource["roomPhase"];
  phase?: PlayPhase;
  activeTeam?: TeamId;
  nomination?: ClassicGameState["nomination"];
}): ClientProjection {
  const context = viewer(input.role, input.teamId, input.isHost);
  const game = gameState(input.phase, {
    activeTeam: input.activeTeam ?? "red",
    nomination: input.nomination ?? null,
  });
  return projectRoomForSeat(
    roomSource({
      viewer: context,
      connected: input.connected,
      roomPhase: input.roomPhase,
      game,
    }),
    context,
  );
}

describe("projectRoomForSeat hidden-information boundary", () => {
  it("projects a four-team board with exact grid and revealed-only team summaries", () => {
    const context = viewer("operative", "yellow");
    const game = gameState("guess", { eliminatedTeams: ["green"] }, 4);
    const fourTeamOperativeProjection = projectRoomForSeat(
      roomSource({ viewer: context, game }),
      context,
    );

    expect(fourTeamOperativeProjection).toMatchObject({
      protocolVersion: 2,
      teamCount: 4,
      configuredTeams: ["red", "blue", "green", "yellow"],
      board: {
        teamCount: 4,
        rows: 6,
        columns: 6,
        configuredTeams: ["red", "blue", "green", "yellow"],
        eliminatedTeams: ["green"],
        teamSummaries: [
          { teamId: "red", revealedTargets: 1, eliminated: false },
          { teamId: "blue", revealedTargets: 0, eliminated: false },
          { teamId: "green", revealedTargets: 0, eliminated: true },
          { teamId: "yellow", revealedTargets: 0, eliminated: false },
        ],
      },
    });
    expect(
      ClientProjectionSchema.safeParse(fourTeamOperativeProjection).success,
    ).toBe(true);
    expect(
      ClientProjectionSchema.safeParse({
        ...fourTeamOperativeProjection,
        board: {
          ...fourTeamOperativeProjection.board,
          teamSummaries: fourTeamOperativeProjection.board!.teamSummaries.map(
            (summary) =>
              summary.teamId === "red"
                ? { ...summary, targetTotal: 8 }
                : summary,
          ),
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    { role: "operative" as const, teamId: "red" as const, isHost: false },
    { role: "spectator" as const, teamId: null, isHost: false },
    { role: "operative" as const, teamId: "red" as const, isHost: true },
    { role: "unassigned" as const, teamId: null, isHost: false },
  ])("omits the key and unrevealed ownership for $role", (context) => {
    const source = roomSource({ viewer: context });
    const projection = projectRoomForSeat(source, {
      playerId: "viewer",
      ...context,
    });

    expect("key" in projection).toBe(false);
    expect(JSON.stringify(projection)).not.toContain('"hazard"');
    expect(
      projection.board?.cards
        .filter((card) => !card.revealed)
        .every((card) => !("owner" in card)),
    ).toBe(true);
  });

  it("gives a clue-giver the complete key without hiding prototype-like IDs", () => {
    const context = viewer("clue-giver", "red");
    const projection = projectRoomForSeat(
      roomSource({ viewer: context }),
      context,
    );

    expect(projection.viewRole).toBe("clue-giver");
    if (projection.viewRole !== "clue-giver") {
      throw new Error("expected clue-giver projection");
    }
    expect(projection.key).toEqual(
      expect.objectContaining({
        "red-1": "red",
        "blue-1": "blue",
        "neutral-1": "neutral",
        "hazard-1": "hazard",
      }),
    );
    expect(Object.keys(projection.key)).toEqual(projection.board?.order);
    expect(Object.hasOwn(projection.key, "__proto__")).toBe(true);
    expect(Object.hasOwn(projection.key, "constructor")).toBe(true);
    expect(projection.key["__proto__"]).toBe("red");
    expect(projection.key.constructor).toBe("blue");
    expect(Object.getPrototypeOf(projection.key)).toBeNull();
    expect(
      projection.board?.cards.find((card) => card.id === "__proto__")?.label,
    ).toBe("Prototype");
  });

  it("exposes an owner only after that card is public", () => {
    const projection = projectionFor({ role: "operative", teamId: "red" });

    expect(projection.board?.cards.find((card) => card.id === "red-1")).toEqual(
      {
        id: "red-1",
        label: "Ruby",
        revealed: true,
        owner: "red",
      },
    );
    expect(
      projection.board?.cards.find((card) => card.id === "blue-1"),
    ).toEqual({ id: "blue-1", label: "Ocean", revealed: false });
  });

  it.each([
    ["unassigned", null],
    ["operative", "red"],
    ["spectator", null],
  ] as const)(
    "keeps connected host powers on a %s view without adding a key",
    (role, teamId) => {
      const projection = projectionFor({ role, teamId, isHost: true });

      expect(projection.viewRole).toBe(role);
      expect("key" in projection).toBe(false);
      expect(projection.permissions.moderate).toBe(true);
    },
  );

  it("copies only public allowlisted fields into fresh DTO data", () => {
    const context = viewer("operative", "red");
    const source = roomSource({ viewer: context });
    Object.assign(source, { durableSeatToken: "source-secret" });
    Object.assign(source.seats[0]!, { tokenHash: "seat-secret" });
    Object.assign(source.publicHistory[0]!, { internal: "history-secret" });
    Object.assign(source.game!, { boardSeed: "game-secret" });
    Object.assign(source.game!.board.cards["red-1"]!, {
      privateNote: "card-secret",
    });

    const projection = projectRoomForSeat(source, context);
    const serialized = JSON.stringify(projection);

    expect(serialized).not.toContain("secret");
    expect(projection.viewer).not.toBe(context);
    expect(projection.seats).not.toBe(source.seats);
    expect(projection.seats[0]).not.toBe(source.seats[0]);
    expect(projection.publicHistory).not.toBe(source.publicHistory);
    expect(projection.publicHistory[0]).not.toBe(source.publicHistory[0]);
    expect(projection.board?.order).not.toBe(source.game?.board.order);
    expect(projection.board?.cards[0]).not.toBe(
      source.game?.board.cards["red-1"],
    );

    projection.seats[0]!.displayName = "Changed";
    projection.publicHistory[0]!.revision = 999;
    projection.board!.order[0] = "changed";
    projection.board!.cards[0]!.label = "Changed";
    expect(source.seats[0]!.displayName).toBe("Viewer");
    expect(source.publicHistory[0]!.revision).toBe(40);
    expect(source.game?.board.order[0]).toBe("red-1");
    expect(source.game?.board.cards["red-1"]?.label).toBe("Ruby");
  });

  it("caps public history to the newest 100 entries while preserving order", () => {
    const history: PublicHistoryEntry[] = Array.from(
      { length: 105 },
      (_, index) => ({
        revision: index + 1,
        at: `2026-08-30T17:${String(index).padStart(2, "0")}:00.000Z`,
        type: "turn_ended" as const,
        teamId: index % 2 === 0 ? ("red" as const) : ("blue" as const),
      }),
    );

    const projection = projectRoomForSeat(
      roomSource({ publicHistory: history }),
      viewer("operative", "red"),
    );

    expect(projection.publicHistory).toHaveLength(100);
    expect(projection.publicHistory.map((entry) => entry.revision)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 6),
    );
  });

  it("returns a null board in the lobby and retains only lobby host controls", () => {
    const context = viewer("unassigned", null, true);
    const projection = projectRoomForSeat(
      roomSource({ viewer: context, roomPhase: "lobby", game: null }),
      context,
    );

    expect(projection.board).toBeNull();
    expect(projection.permissions).toEqual({
      ...allFalsePermissions,
      configure: true,
      moderate: true,
    });
  });

  it("rejects an unsupported source protocol version instead of relabeling it", () => {
    expect(() =>
      projectRoomForSeat(
        roomSource({ protocolVersion: 1 }),
        viewer("operative", "red"),
      ),
    ).toThrow(/protocol version/i);
  });
});

describe("projection permission derivation", () => {
  it.each([
    {
      name: "connected lobby host configures and moderates",
      input: {
        role: "spectator" as const,
        teamId: null,
        isHost: true,
        roomPhase: "lobby" as const,
      },
      expected: { configure: true, moderate: true },
    },
    {
      name: "active clue-giver submits during clue",
      input: {
        role: "clue-giver" as const,
        teamId: "red" as const,
        phase: "clue" as const,
      },
      expected: { submitClue: true },
    },
    {
      name: "opposing clue-giver challenges during guess",
      input: {
        role: "clue-giver" as const,
        teamId: "blue" as const,
        phase: "guess" as const,
      },
      expected: { challengeClue: true },
    },
    {
      name: "active operative nominates and ends during guess",
      input: {
        role: "operative" as const,
        teamId: "red" as const,
        phase: "guess" as const,
      },
      expected: { nominate: true, endTurn: true },
    },
    {
      name: "active operative confirms only a current nomination",
      input: {
        role: "operative" as const,
        teamId: "red" as const,
        phase: "guess" as const,
        nomination: { playerId: "viewer", cardId: "blue-1" },
      },
      expected: { nominate: true, confirmReveal: true, endTurn: true },
    },
    {
      name: "host resolves a challenge",
      input: {
        role: "operative" as const,
        teamId: "blue" as const,
        isHost: true,
        phase: "challenged" as const,
      },
      expected: { moderate: true, resolveChallenge: true, pause: true },
    },
    ...(["clue", "guess"] as const).map((phase) => ({
      name: `host pauses during ${phase}`,
      input: {
        role: "spectator" as const,
        teamId: null,
        isHost: true,
        phase,
      },
      expected: { moderate: true, pause: true },
    })),
    {
      name: "host resumes a paused board",
      input: {
        role: "spectator" as const,
        teamId: null,
        isHost: true,
        phase: "paused" as const,
      },
      expected: { moderate: true, resume: true },
    },
    {
      name: "host has only moderation authority after board completion",
      input: {
        role: "clue-giver" as const,
        teamId: "red" as const,
        isHost: true,
        roomPhase: "complete" as const,
        phase: "board_complete" as const,
      },
      expected: { moderate: true },
    },
    {
      name: "inactive clue-giver receives no clue action",
      input: {
        role: "clue-giver" as const,
        teamId: "blue" as const,
        phase: "clue" as const,
      },
      expected: {},
    },
    {
      name: "active clue-giver receives no operative actions",
      input: {
        role: "clue-giver" as const,
        teamId: "red" as const,
        phase: "guess" as const,
      },
      expected: {},
    },
    {
      name: "inactive operative receives no gameplay actions",
      input: {
        role: "operative" as const,
        teamId: "blue" as const,
        phase: "guess" as const,
      },
      expected: {},
    },
    {
      name: "spectator receives no gameplay actions",
      input: {
        role: "spectator" as const,
        teamId: null,
        phase: "guess" as const,
      },
      expected: {},
    },
    {
      name: "unassigned player receives no gameplay actions",
      input: {
        role: "unassigned" as const,
        teamId: null,
        phase: "guess" as const,
      },
      expected: {},
    },
  ])("$name", ({ input, expected }) => {
    const projection = projectionFor(input);

    expect(projection.permissions).toEqual({
      ...allFalsePermissions,
      ...expected,
    });
  });

  it.each([
    { role: "operative" as const, teamId: "red" as const, isHost: false },
    { role: "clue-giver" as const, teamId: "red" as const, isHost: false },
    { role: "spectator" as const, teamId: null, isHost: true },
    { role: "unassigned" as const, teamId: null, isHost: true },
  ])("grants no action to a disconnected $role", (context) => {
    const projection = projectionFor({
      ...context,
      connected: false,
      phase: "guess",
    });

    expect(projection.permissions).toEqual(allFalsePermissions);
  });

  it("treats a viewer absent from seats as disconnected", () => {
    const context: ViewerContext = {
      playerId: "missing",
      teamId: "red",
      role: "operative",
      isHost: true,
    };
    const projection = projectRoomForSeat(roomSource(), context);

    expect(projection.permissions).toEqual(allFalsePermissions);
  });
});

describe("ClientProjectionSchema", () => {
  it.each([
    { teamCount: 2 as const, rows: 5, columns: 5, cardCount: 25 },
    { teamCount: 3 as const, rows: 5, columns: 6, cardCount: 30 },
    { teamCount: 4 as const, rows: 6, columns: 6, cardCount: 36 },
  ])(
    "accepts the exact $teamCount-team board dimensions",
    ({ teamCount, rows, columns, cardCount }) => {
      const context = viewer("clue-giver", "red");
      const projection = projectRoomForSeat(
        roomSource({ viewer: context, game: gameState("clue", {}, teamCount) }),
        context,
      );

      expect(projection.board).toMatchObject({ rows, columns });
      expect(projection.board?.order).toHaveLength(cardCount);
      expect(projection.board?.cards).toHaveLength(cardCount);
      expect(projection.viewRole).toBe("clue-giver");
      if (projection.viewRole !== "clue-giver") {
        throw new Error("expected clue-giver projection");
      }
      expect(Object.keys(projection.key)).toEqual(projection.board?.order);
      expect(ClientProjectionSchema.safeParse(projection).success).toBe(true);
    },
  );

  it.each([
    ["unassigned", null, false],
    ["unassigned", null, true],
    ["operative", "red", false],
    ["operative", "red", true],
    ["clue-giver", "red", false],
    ["clue-giver", "red", true],
    ["spectator", null, false],
    ["spectator", null, true],
  ] as const)(
    "accepts the strict %s projection variant",
    (role, teamId, isHost) => {
      const projection = projectionFor({ role, teamId, isHost });

      expect(ClientProjectionSchema.parse(projection)).toEqual(projection);
    },
  );

  it("rejects a key added to each non-clue-giver variant", () => {
    for (const [role, teamId] of [
      ["unassigned", null],
      ["operative", "red"],
      ["spectator", null],
    ] as const) {
      const projection = projectionFor({ role, teamId });
      const unsafe = { ...projection, key: { "hazard-1": "hazard" } };

      expect(ClientProjectionSchema.safeParse(unsafe).success).toBe(false);
    }
  });

  it("rejects a clue-giver variant missing its key", () => {
    const projection = projectionFor({ role: "clue-giver", teamId: "red" });
    const missingKey = JSON.parse(JSON.stringify(projection)) as Record<
      string,
      unknown
    >;
    delete missingKey.key;

    expect(ClientProjectionSchema.safeParse(missingKey).success).toBe(false);
  });

  it("rejects clue-giver keys that do not exactly cover the current board", () => {
    const projection = projectionFor({ role: "clue-giver", teamId: "red" });
    if (projection.viewRole !== "clue-giver") {
      throw new Error("expected clue-giver projection");
    }

    const missing = JSON.parse(JSON.stringify(projection)) as typeof projection;
    delete missing.key["hazard-1"];
    expect(ClientProjectionSchema.safeParse(missing).success).toBe(false);

    const extra = JSON.parse(JSON.stringify(projection)) as typeof projection;
    extra.key["not-on-board"] = "hazard";
    expect(ClientProjectionSchema.safeParse(extra).success).toBe(false);
  });

  it.each([
    { field: "rows", value: 6 },
    { field: "columns", value: 6 },
  ])("rejects a 2-team board with an invalid $field", ({ field, value }) => {
    const projection = projectionFor({ role: "operative", teamId: "red" });
    const candidate = JSON.parse(JSON.stringify(projection)) as {
      board: Record<string, unknown>;
    };
    candidate.board[field] = value;

    expect(ClientProjectionSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects board card collections that do not exactly match the grid order", () => {
    const projection = projectionFor({ role: "operative", teamId: "red" });
    const missingOrderCard = JSON.parse(JSON.stringify(projection)) as {
      board: { order: string[] };
    };
    missingOrderCard.board.order.pop();
    expect(ClientProjectionSchema.safeParse(missingOrderCard).success).toBe(
      false,
    );

    const mismatchedCard = JSON.parse(JSON.stringify(projection)) as {
      board: { cards: Array<{ id: string }> };
    };
    mismatchedCard.board.cards[0]!.id = "not-in-order";
    expect(ClientProjectionSchema.safeParse(mismatchedCard).success).toBe(
      false,
    );
  });

  it("requires configured teams and summaries to exactly match team count", () => {
    const projection = projectionFor({ role: "operative", teamId: "red" });
    const missingSummary = JSON.parse(JSON.stringify(projection)) as {
      board: { teamSummaries: unknown[] };
    };
    missingSummary.board.teamSummaries.pop();
    expect(ClientProjectionSchema.safeParse(missingSummary).success).toBe(
      false,
    );

    const wrongConfiguredTeams = JSON.parse(JSON.stringify(projection)) as {
      configuredTeams: string[];
    };
    wrongConfiguredTeams.configuredTeams = ["red", "green"];
    expect(ClientProjectionSchema.safeParse(wrongConfiguredTeams).success).toBe(
      false,
    );

    const wrongBoardTeams = JSON.parse(JSON.stringify(projection)) as {
      board: { configuredTeams: string[] };
    };
    wrongBoardTeams.board.configuredTeams = ["red", "green"];
    expect(ClientProjectionSchema.safeParse(wrongBoardTeams).success).toBe(
      false,
    );
  });

  it("requires board team count to match the projection team count", () => {
    const projection = projectionFor({ role: "operative", teamId: "red" });
    const mismatched = JSON.parse(JSON.stringify(projection)) as {
      board: { teamCount: number };
    };
    mismatched.board.teamCount = 4;

    expect(ClientProjectionSchema.safeParse(mismatched).success).toBe(false);
  });

  it("requires eliminated teams to be unique configured teams", () => {
    const projection = projectionFor({ role: "operative", teamId: "red" });
    const duplicated = JSON.parse(JSON.stringify(projection)) as {
      board: { eliminatedTeams: string[] };
    };
    duplicated.board.eliminatedTeams = ["red", "red"];
    expect(ClientProjectionSchema.safeParse(duplicated).success).toBe(false);

    const unconfigured = JSON.parse(JSON.stringify(projection)) as {
      board: { eliminatedTeams: string[] };
    };
    unconfigured.board.eliminatedTeams = ["green"];
    expect(ClientProjectionSchema.safeParse(unconfigured).success).toBe(false);
  });

  it("requires team summaries to match revealed target counts and elimination state", () => {
    const projection = projectionFor({ role: "operative", teamId: "red" });
    const wrongCount = JSON.parse(JSON.stringify(projection)) as {
      board: { teamSummaries: Array<{ revealedTargets: number }> };
    };
    wrongCount.board.teamSummaries[0]!.revealedTargets = 0;
    expect(ClientProjectionSchema.safeParse(wrongCount).success).toBe(false);

    const wrongElimination = JSON.parse(JSON.stringify(projection)) as {
      board: { teamSummaries: Array<{ eliminated: boolean }> };
    };
    wrongElimination.board.teamSummaries[0]!.eliminated = true;
    expect(ClientProjectionSchema.safeParse(wrongElimination).success).toBe(
      false,
    );
  });

  it("rejects ownership on an unrevealed public card and requires it when revealed", () => {
    const projection = projectionFor({ role: "operative", teamId: "red" });
    const hiddenOwner = JSON.parse(JSON.stringify(projection)) as {
      board: { cards: Array<Record<string, unknown>> };
    };
    hiddenOwner.board.cards.find((card) => card.id === "blue-1")!.owner =
      "blue";
    expect(ClientProjectionSchema.safeParse(hiddenOwner).success).toBe(false);

    const missingPublicOwner = JSON.parse(JSON.stringify(projection)) as {
      board: { cards: Array<Record<string, unknown>> };
    };
    delete missingPublicOwner.board.cards.find((card) => card.id === "red-1")!
      .owner;
    expect(ClientProjectionSchema.safeParse(missingPublicOwner).success).toBe(
      false,
    );
  });

  it("rejects unknown fields at every nested object boundary", () => {
    const base = projectionFor({
      role: "operative",
      teamId: "red",
      phase: "guess",
      nomination: { playerId: "viewer", cardId: "blue-1" },
    });
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => Object.assign(value, { unknown: true }),
      (value) => Object.assign(value.viewer as object, { unknown: true }),
      (value) => Object.assign(value.permissions as object, { unknown: true }),
      (value) =>
        Object.assign((value.seats as Array<object>)[0]!, { unknown: true }),
      (value) =>
        Object.assign((value.publicHistory as Array<object>)[0]!, {
          unknown: true,
        }),
      (value) => Object.assign(value.board as object, { unknown: true }),
      (value) =>
        Object.assign((value.board as { cards: Array<object> }).cards[0]!, {
          unknown: true,
        }),
      (value) =>
        Object.assign((value.board as { clue: object }).clue, {
          unknown: true,
        }),
      (value) =>
        Object.assign((value.board as { nomination: object }).nomination, {
          unknown: true,
        }),
    ];

    for (const mutate of mutations) {
      const candidate = JSON.parse(JSON.stringify(base)) as Record<
        string,
        unknown
      >;
      mutate(candidate);
      expect(ClientProjectionSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it.each([
    {
      revision: 1,
      at: "2026-08-30T17:00:00.000Z",
      type: "clue_submitted",
      teamId: "red",
      word: "ember",
      count: 2,
    },
    {
      revision: 2,
      at: "2026-08-30T17:01:00.000Z",
      type: "clue_challenged",
      teamId: "blue",
    },
    {
      revision: 3,
      at: "2026-08-30T17:02:00.000Z",
      type: "challenge_resolved",
      decision: "accept",
    },
    {
      revision: 4,
      at: "2026-08-30T17:03:00.000Z",
      type: "card_revealed",
      teamId: "red",
      cardId: "red-1",
      owner: "red",
    },
    {
      revision: 5,
      at: "2026-08-30T17:04:00.000Z",
      type: "turn_ended",
      teamId: "red",
    },
    {
      revision: 6,
      at: "2026-08-30T17:05:00.000Z",
      type: "room_paused",
    },
    {
      revision: 7,
      at: "2026-08-30T17:06:00.000Z",
      type: "room_resumed",
    },
  ] satisfies PublicHistoryEntry[])(
    "rejects unknown fields on the $type history result variant",
    (entry) => {
      const source = roomSource({ publicHistory: [entry] });
      const projection = projectRoomForSeat(source, viewer("operative", "red"));
      const candidate = JSON.parse(JSON.stringify(projection)) as {
        publicHistory: Array<Record<string, unknown>>;
      };
      candidate.publicHistory[0]!.unknown = true;

      expect(ClientProjectionSchema.safeParse(candidate).success).toBe(false);
    },
  );

  it("accepts hazard elimination history metadata and preserves it in projection", () => {
    const entry: PublicHistoryEntry = {
      revision: 4,
      at: "2026-08-30T17:03:00.000Z",
      type: "card_revealed",
      teamId: "red",
      cardId: "hazard-1",
      owner: "hazard",
      eliminatedTeam: "red",
    };
    const projection = projectRoomForSeat(
      roomSource({ publicHistory: [entry] }),
      viewer("operative", "red"),
    );

    expect(projection.publicHistory).toEqual([entry]);
    expect(ClientProjectionSchema.safeParse(projection).success).toBe(true);
  });

  it("rejects elimination history metadata for a non-hazard reveal", () => {
    const projection = projectionFor({ role: "operative", teamId: "red" });
    const candidate = JSON.parse(JSON.stringify(projection)) as {
      publicHistory: Array<Record<string, unknown>>;
    };
    candidate.publicHistory[0]!.eliminatedTeam = "red";

    expect(ClientProjectionSchema.safeParse(candidate).success).toBe(false);
  });

  it("accepts a hazard reveal without elimination history metadata", () => {
    const entry: PublicHistoryEntry = {
      revision: 4,
      at: "2026-08-30T17:03:00.000Z",
      type: "card_revealed",
      teamId: "red",
      cardId: "hazard-1",
      owner: "hazard",
    };
    const projection = projectRoomForSeat(
      roomSource({ publicHistory: [entry] }),
      viewer("operative", "red"),
    );

    expect(ClientProjectionSchema.safeParse(projection).success).toBe(true);
  });
});
