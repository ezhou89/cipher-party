import {
  TEAM_IDS,
  classicBoardSpec,
  configuredTeams,
  type Ownership,
  type TeamId,
} from "@cipher-party/game-core";
import {
  CommandEnvelopeSchema,
  CommandResultSchema,
  ClientCommandSchema,
  TeamCountSchema,
  TeamIdSchema,
} from "@cipher-party/protocol";
import { z } from "zod";
import { DisplayNameSchema } from "../http/schemas";
import type { RoomState } from "./room-state";

export class InvalidRoomSnapshotError extends Error {
  constructor() {
    super("Room snapshot is invalid");
    this.name = "InvalidRoomSnapshotError";
  }
}

export class UnsupportedRoomSnapshotError extends Error {
  constructor() {
    super("Room snapshot version is unsupported");
    this.name = "UnsupportedRoomSnapshotError";
  }
}

const id = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().nonnegative();
const legacyTeam = z.enum(["red", "blue"]);
const legacyOwner = z.enum(["red", "blue", "neutral", "hazard"]);
const owner = z.enum([...TEAM_IDS, "neutral", "hazard"]);
const timestamp = z.string().refine((value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
});
const clueWord = z.string().refine((word) => {
  const parsed = ClientCommandSchema.safeParse({
    type: "submit_clue",
    word,
    count: 1,
  });
  return (
    parsed.success &&
    parsed.data.type === "submit_clue" &&
    parsed.data.word === word
  );
});
const clue = z
  .object({ word: clueWord, count: z.number().int().min(1).max(9) })
  .strict();
const seat = z
  .object({
    playerId: id,
    displayName: z.string().refine((value) => {
      const parsed = DisplayNameSchema.safeParse(value);
      return parsed.success && parsed.data === value;
    }),
    seatClass: z.enum(["active", "spectator"]),
    teamId: TeamIdSchema.nullable(),
    role: z.enum(["unassigned", "clue-giver", "operative", "spectator"]),
    connected: z.boolean(),
    seatTokenHash: hash,
  })
  .strict()
  .refine((value) =>
    value.seatClass === "spectator"
      ? value.role === "spectator" && value.teamId === null
      : value.role !== "spectator" &&
        (value.role === "unassigned" || value.teamId !== null),
  );
const legacyCard = z
  .object({
    id,
    label: z.string().min(1),
    owner: legacyOwner,
    revealed: z.boolean(),
  })
  .strict();
const card = z
  .object({ id, label: z.string().min(1), owner, revealed: z.boolean() })
  .strict();
const legacyBoard = z
  .object({
    order: z.array(id).length(25),
    cards: z.record(id, legacyCard),
    startingTeam: legacyTeam,
  })
  .strict();
const board = z
  .object({
    teamCount: TeamCountSchema,
    configuredTeams: z.array(TeamIdSchema),
    rows: z.union([z.literal(5), z.literal(6)]),
    columns: z.union([z.literal(5), z.literal(6)]),
    order: z.array(id).min(1).max(36),
    cards: z.record(id, card),
    startingTeam: TeamIdSchema,
  })
  .strict();

const legacyGame = z
  .object({
    board: legacyBoard,
    phase: z.enum(["clue", "guess", "challenged", "paused", "board_complete"]),
    resumePhase: z.enum(["clue", "guess", "challenged"]).nullable(),
    activeTeam: legacyTeam,
    clue: clue.nullable(),
    guessesRemaining: z.number().int().min(0).max(10),
    nomination: z.object({ playerId: id, cardId: id }).strict().nullable(),
    winner: legacyTeam.nullable(),
    completionReason: z.enum(["targets", "hazard"]).nullable(),
  })
  .strict();
const game = z
  .object({
    board,
    phase: z.enum(["clue", "guess", "challenged", "paused", "board_complete"]),
    resumePhase: z.enum(["clue", "guess", "challenged"]).nullable(),
    activeTeam: TeamIdSchema,
    eliminatedTeams: z.array(TeamIdSchema),
    clue: clue.nullable(),
    guessesRemaining: z.number().int().min(0).max(10),
    nomination: z.object({ playerId: id, cardId: id }).strict().nullable(),
    winner: TeamIdSchema.nullable(),
    completionReason: z.enum(["targets", "hazard"]).nullable(),
  })
  .strict();

const historyBase = { revision, at: timestamp };
const legacyHistory = z.discriminatedUnion("type", [
  z
    .object({
      ...historyBase,
      type: z.literal("clue_submitted"),
      teamId: legacyTeam,
      word: clueWord,
      count: z.number().int().min(1).max(9),
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("clue_challenged"),
      teamId: legacyTeam,
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("challenge_resolved"),
      decision: z.enum(["accept", "reject"]),
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("card_revealed"),
      teamId: legacyTeam,
      cardId: id,
      owner: legacyOwner,
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("turn_ended"),
      teamId: legacyTeam,
    })
    .strict(),
  z.object({ ...historyBase, type: z.literal("room_paused") }).strict(),
  z.object({ ...historyBase, type: z.literal("room_resumed") }).strict(),
]);
const history = z.discriminatedUnion("type", [
  z
    .object({
      ...historyBase,
      type: z.literal("clue_submitted"),
      teamId: TeamIdSchema,
      word: clueWord,
      count: z.number().int().min(1).max(9),
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("clue_challenged"),
      teamId: TeamIdSchema,
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("challenge_resolved"),
      decision: z.enum(["accept", "reject"]),
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("card_revealed"),
      teamId: TeamIdSchema,
      cardId: id,
      owner,
      eliminatedTeam: TeamIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("turn_ended"),
      teamId: TeamIdSchema,
    })
    .strict(),
  z.object({ ...historyBase, type: z.literal("room_paused") }).strict(),
  z.object({ ...historyBase, type: z.literal("room_resumed") }).strict(),
]);

const sharedRoomShape = {
  code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{6}$/u),
  inviteUrl: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === ""
      );
    } catch {
      return false;
    }
  }),
  revision,
  phase: z.enum(["lobby", "playing", "complete"]),
  locked: z.boolean(),
  createdAt: timestamp,
  lastActivity: timestamp,
  boardSeed: id,
};
const sharedAuthorityShape = {
  hostPlayerId: id,
  hostTokenHash: hash,
  seats: z.array(seat).min(1).max(32),
};
const sharedStorageShape = {
  // Older valid snapshots may exceed today's issuance cap; never evict tickets here.
  connectionTickets: z.array(
    z
      .object({
        ticketHash: hash,
        playerId: id,
        hostAuthority: z.boolean(),
        expiresAt: z.number().finite(),
      })
      .strict(),
  ),
  processedCommands: z
    .array(
      z
        .object({
          commandId: CommandEnvelopeSchema.shape.commandId,
          payloadDigest: hash,
          result: CommandResultSchema,
        })
        .strict(),
    )
    .max(256),
};

const legacySnapshot = z
  .object({
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(1),
    ...sharedRoomShape,
    startingTeam: legacyTeam,
    ...sharedAuthorityShape,
    game: legacyGame.nullable(),
    publicHistory: z.array(legacyHistory).max(100),
    ...sharedStorageShape,
  })
  .strict();
const snapshot = z
  .object({
    schemaVersion: z.literal(2),
    protocolVersion: z.literal(2),
    teamCount: TeamCountSchema,
    configuredTeams: z.array(TeamIdSchema),
    initialOwners: z.record(id, owner).nullable(),
    ...sharedRoomShape,
    startingTeam: TeamIdSchema,
    ...sharedAuthorityShape,
    game: game.nullable(),
    publicHistory: z.array(history).max(100),
    ...sharedStorageShape,
  })
  .strict();

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function ownershipCounts(
  values: readonly Ownership[],
): Record<Ownership, number> {
  const counts: Record<Ownership, number> = {
    red: 0,
    blue: 0,
    green: 0,
    yellow: 0,
    neutral: 0,
    hazard: 0,
  };
  for (const value of values) counts[value] += 1;
  return counts;
}

function validHistory(state: RoomState): boolean {
  return state.publicHistory.every((entry, index) => {
    if (
      entry.revision > state.revision ||
      entry.revision <= (state.publicHistory[index - 1]?.revision ?? 0)
    ) {
      return false;
    }
    if ("teamId" in entry && !state.configuredTeams.includes(entry.teamId)) {
      return false;
    }
    if (entry.type !== "card_revealed") return true;
    const value = state.game?.board.cards[entry.cardId];
    if (value === undefined || !value.revealed || value.owner !== entry.owner) {
      return false;
    }
    if (entry.eliminatedTeam === undefined) return true;
    return (
      entry.owner === "hazard" &&
      state.teamCount > 2 &&
      entry.eliminatedTeam === entry.teamId &&
      state.game?.eliminatedTeams.includes(entry.eliminatedTeam) === true
    );
  });
}

function validReferences(state: RoomState): boolean {
  const expectedTeams = configuredTeams(state.teamCount);
  if (
    !arraysEqual(state.configuredTeams, expectedTeams) ||
    !state.configuredTeams.includes(state.startingTeam)
  ) {
    return false;
  }
  const ids = new Set(state.seats.map((value) => value.playerId));
  if (!ids.has(state.hostPlayerId) || ids.size !== state.seats.length) {
    return false;
  }
  if (!unique(state.seats.map((value) => value.seatTokenHash))) return false;
  if (
    state.seats.some(
      (value) =>
        value.teamId !== null && !state.configuredTeams.includes(value.teamId),
    )
  ) {
    return false;
  }
  for (const kind of ["active", "spectator"] as const) {
    if (state.seats.filter((value) => value.seatClass === kind).length > 16) {
      return false;
    }
  }
  if (!unique(state.connectionTickets.map((value) => value.ticketHash))) {
    return false;
  }
  if (
    state.connectionTickets.some(
      (value) =>
        !ids.has(value.playerId) ||
        (value.hostAuthority && value.playerId !== state.hostPlayerId),
    )
  ) {
    return false;
  }
  if (!unique(state.processedCommands.map((value) => value.commandId))) {
    return false;
  }
  if (
    state.processedCommands.some(
      (value) => value.result.revision > state.revision,
    )
  ) {
    return false;
  }
  return validHistory(state);
}

function validBoard(state: RoomState): boolean {
  const value = state.game;
  if (value === null) return true;
  const { board: gameBoard } = value;
  const spec = classicBoardSpec(state.teamCount);
  if (
    gameBoard.teamCount !== state.teamCount ||
    !arraysEqual(gameBoard.configuredTeams, state.configuredTeams) ||
    gameBoard.rows !== spec.rows ||
    gameBoard.columns !== spec.columns ||
    gameBoard.order.length !== spec.cardCount ||
    state.initialOwners === null ||
    !state.configuredTeams.includes(gameBoard.startingTeam) ||
    !unique(gameBoard.order) ||
    Object.keys(gameBoard.cards).length !== spec.cardCount
  ) {
    return false;
  }
  if (
    !gameBoard.order.every(
      (key) =>
        Object.hasOwn(gameBoard.cards, key) && gameBoard.cards[key]!.id === key,
    ) ||
    Object.keys(state.initialOwners).length !== spec.cardCount ||
    !gameBoard.order.every((key) => Object.hasOwn(state.initialOwners!, key))
  ) {
    return false;
  }
  const initialCounts = ownershipCounts(Object.values(state.initialOwners));
  for (const teamId of TEAM_IDS) {
    const expected = !state.configuredTeams.includes(teamId)
      ? 0
      : teamId === gameBoard.startingTeam
        ? spec.startingTargets
        : spec.otherTargets;
    if (initialCounts[teamId] !== expected) return false;
  }
  if (
    initialCounts.neutral !== spec.neutralCards ||
    initialCounts.hazard !== spec.hazardCards
  ) {
    return false;
  }
  if (
    !unique(value.eliminatedTeams) ||
    value.eliminatedTeams.some(
      (teamId) => !state.configuredTeams.includes(teamId),
    ) ||
    (state.teamCount === 2 && value.eliminatedTeams.length !== 0)
  ) {
    return false;
  }

  const eliminated = new Set(value.eliminatedTeams);
  for (const cardId of gameBoard.order) {
    const cardValue = gameBoard.cards[cardId]!;
    const originalOwner = state.initialOwners[cardId];
    if (cardValue.owner === originalOwner) continue;
    if (
      originalOwner === undefined ||
      cardValue.owner !== "neutral" ||
      cardValue.revealed ||
      originalOwner === "neutral" ||
      originalOwner === "hazard" ||
      !eliminated.has(originalOwner)
    ) {
      return false;
    }
  }
  return true;
}

function allTargetsRevealed(
  value: NonNullable<RoomState["game"]>,
  teamId: TeamId,
): boolean {
  return Object.values(value.board.cards)
    .filter((cardValue) => cardValue.owner === teamId)
    .every((cardValue) => cardValue.revealed);
}

function validGameOutcome(value: NonNullable<RoomState["game"]>): boolean {
  const complete = value.phase === "board_complete";
  if (complete !== (value.winner !== null && value.completionReason !== null)) {
    return false;
  }
  if (!complete && (value.winner !== null || value.completionReason !== null)) {
    return false;
  }
  if (!value.board.configuredTeams.includes(value.activeTeam)) return false;
  const eliminated = new Set(value.eliminatedTeams);
  const remainingTeams = value.board.configuredTeams.filter(
    (teamId) => !eliminated.has(teamId),
  );
  const revealedHazard = Object.values(value.board.cards).some(
    (cardValue) => cardValue.owner === "hazard" && cardValue.revealed,
  );
  if (eliminated.size > 0 && !revealedHazard) return false;
  if (revealedHazard && value.board.teamCount === 2) {
    return (
      value.completionReason === "hazard" &&
      value.winner !== null &&
      remainingTeams.includes(value.winner) &&
      value.winner !== value.activeTeam
    );
  }
  if (revealedHazard && eliminated.size === 0) return false;

  if (!complete) {
    return (
      !eliminated.has(value.activeTeam) &&
      remainingTeams.length >= 2 &&
      remainingTeams.every((teamId) => !allTargetsRevealed(value, teamId))
    );
  }
  if (value.winner === null || !remainingTeams.includes(value.winner)) {
    return false;
  }
  if (value.completionReason === "hazard") {
    return (
      revealedHazard &&
      eliminated.has(value.activeTeam) &&
      remainingTeams.length === 1 &&
      remainingTeams[0] === value.winner
    );
  }
  return (
    !eliminated.has(value.activeTeam) && allTargetsRevealed(value, value.winner)
  );
}

function validGamePhase(value: NonNullable<RoomState["game"]>): boolean {
  const phase = value.phase === "paused" ? value.resumePhase : value.phase;
  if ((value.phase === "paused") !== (value.resumePhase !== null)) return false;
  if (!validGameOutcome(value)) return false;
  if (phase === "clue") {
    return (
      value.clue === null &&
      value.guessesRemaining === 0 &&
      value.nomination === null
    );
  }
  if (value.clue === null || value.guessesRemaining > value.clue.count + 1) {
    return false;
  }
  if (value.phase === "board_complete") return value.nomination === null;
  return value.guessesRemaining > 0;
}

function validRoomGame(state: RoomState): boolean {
  const value = state.game;
  if (value === null) {
    return (
      state.initialOwners === null &&
      state.phase === "lobby" &&
      state.publicHistory.length === 0
    );
  }
  if (
    state.phase === "lobby" ||
    (state.phase === "complete") !== (value.phase === "board_complete") ||
    state.startingTeam !== value.board.startingTeam ||
    !validBoard(state) ||
    !validGamePhase(value)
  ) {
    return false;
  }
  const active = state.seats.filter(
    (seatValue) => seatValue.seatClass === "active",
  );
  if (
    active.some(
      (seatValue) =>
        seatValue.teamId === null ||
        seatValue.role === "unassigned" ||
        value.eliminatedTeams.includes(seatValue.teamId),
    )
  ) {
    return false;
  }
  for (const teamId of state.configuredTeams) {
    if (value.eliminatedTeams.includes(teamId)) continue;
    if (
      active.filter(
        (seatValue) =>
          seatValue.teamId === teamId && seatValue.role === "clue-giver",
      ).length !== 1 ||
      !active.some(
        (seatValue) =>
          seatValue.teamId === teamId && seatValue.role === "operative",
      )
    ) {
      return false;
    }
  }
  if (value.nomination === null) return true;
  const nominator = state.seats.find(
    (seatValue) => seatValue.playerId === value.nomination!.playerId,
  );
  const nominated = value.board.cards[value.nomination.cardId];
  return (
    nominator?.role === "operative" &&
    nominator.teamId === value.activeTeam &&
    !value.eliminatedTeams.includes(value.activeTeam) &&
    nominated !== undefined &&
    !nominated.revealed
  );
}

function normalizeLegacySnapshot(
  value: z.infer<typeof legacySnapshot>,
): unknown {
  return {
    ...value,
    schemaVersion: 2,
    protocolVersion: 2,
    teamCount: 2,
    configuredTeams: ["red", "blue"],
    initialOwners:
      value.game === null
        ? null
        : Object.fromEntries(
            Object.entries(value.game.board.cards).map(
              ([cardId, cardValue]) => [cardId, cardValue.owner],
            ),
          ),
    game:
      value.game === null
        ? null
        : {
            ...value.game,
            board: {
              teamCount: 2,
              configuredTeams: ["red", "blue"],
              rows: 5,
              columns: 5,
              ...value.game.board,
            },
            eliminatedTeams: [],
          },
  };
}

function snapshotVersion(input: unknown): 1 | 2 | null {
  if (input === null || typeof input !== "object") return null;
  const versions = input as {
    schemaVersion?: unknown;
    protocolVersion?: unknown;
  };
  if (versions.schemaVersion === 1 && versions.protocolVersion === 1) return 1;
  if (versions.schemaVersion === 2 && versions.protocolVersion === 2) return 2;
  if (
    typeof versions.schemaVersion === "number" ||
    typeof versions.protocolVersion === "number"
  ) {
    throw new UnsupportedRoomSnapshotError();
  }
  return null;
}

export function parseRoomSnapshot(input: unknown): RoomState {
  const version = snapshotVersion(input);
  let normalizedInput: unknown;
  if (version === 1) {
    const legacy = legacySnapshot.safeParse(input);
    if (!legacy.success) throw new InvalidRoomSnapshotError();
    normalizedInput = normalizeLegacySnapshot(legacy.data);
  } else if (version === 2) {
    const current = snapshot.safeParse(input);
    if (!current.success) throw new InvalidRoomSnapshotError();
    normalizedInput = current.data;
  } else {
    throw new InvalidRoomSnapshotError();
  }
  const normalized = snapshot.safeParse(normalizedInput);
  if (!normalized.success) {
    throw new InvalidRoomSnapshotError();
  }
  const state = normalized.data as unknown as RoomState;
  if (!validReferences(state) || !validRoomGame(state)) {
    throw new InvalidRoomSnapshotError();
  }
  if (state.game !== null) {
    state.game.board.cards = Object.assign(
      Object.create(null),
      state.game.board.cards,
    );
  }
  return state;
}
