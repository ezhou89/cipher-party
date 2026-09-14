import type {
  CardId,
  ClassicGameState,
  Ownership,
  PlayerId,
  PlayPhase,
  SeatRole,
  TeamCount,
  TeamId,
} from "@cipher-party/game-core";
import { TEAM_IDS } from "@cipher-party/game-core";
import { z } from "zod";

import { PROTOCOL_VERSION, TeamCountSchema, TeamIdSchema } from "./commands";

export interface SeatSummary {
  playerId: PlayerId;
  displayName: string;
  teamId: TeamId | null;
  role: SeatRole;
  connected: boolean;
}

export type PublicHistoryEntry =
  | {
      revision: number;
      at: string;
      type: "clue_submitted";
      teamId: TeamId;
      word: string;
      count: number;
    }
  | {
      revision: number;
      at: string;
      type: "clue_challenged";
      teamId: TeamId;
    }
  | {
      revision: number;
      at: string;
      type: "challenge_resolved";
      decision: "accept" | "reject";
    }
  | {
      revision: number;
      at: string;
      type: "card_revealed";
      teamId: TeamId;
      cardId: CardId;
      owner: Ownership;
      eliminatedTeam?: TeamId;
    }
  | {
      revision: number;
      at: string;
      type: "turn_ended";
      teamId: TeamId;
    }
  | {
      revision: number;
      at: string;
      type: "room_paused" | "room_resumed";
    };

export interface RoomProjectionSource {
  protocolVersion: number;
  code: string;
  inviteUrl: string;
  revision: number;
  roomPhase: "lobby" | "playing" | "complete";
  locked: boolean;
  teamCount: TeamCount;
  configuredTeams: TeamId[];
  seats: SeatSummary[];
  publicHistory: PublicHistoryEntry[];
  game: ClassicGameState | null;
}

interface PublicCardBase {
  id: CardId;
  label: string;
}

export type PublicCard =
  | (PublicCardBase & { revealed: false; owner?: never })
  | (PublicCardBase & { revealed: true; owner: Ownership });

export interface ViewerContext {
  playerId: PlayerId;
  teamId: TeamId | null;
  role: SeatRole;
  isHost: boolean;
}

export interface ProjectionPermissions {
  configure: boolean;
  moderate: boolean;
  submitClue: boolean;
  challengeClue: boolean;
  nominate: boolean;
  confirmReveal: boolean;
  endTurn: boolean;
  resolveChallenge: boolean;
  pause: boolean;
  resume: boolean;
}

export interface PublicBoard {
  teamCount: TeamCount;
  rows: 5 | 6;
  columns: 5 | 6;
  configuredTeams: TeamId[];
  eliminatedTeams: TeamId[];
  teamSummaries: PublicTeamSummary[];
  order: CardId[];
  cards: PublicCard[];
  activeTeam: TeamId;
  phase: PlayPhase;
  clue: { word: string; count: number } | null;
  guessesRemaining: number;
  nomination: { playerId: PlayerId; cardId: CardId } | null;
  winner: TeamId | null;
  completionReason: "targets" | "hazard" | null;
}

export interface PublicTeamSummary {
  teamId: TeamId;
  revealedTargets: number;
  eliminated: boolean;
}

export interface ProjectionBase {
  protocolVersion: 2;
  revision: number;
  code: string;
  inviteUrl: string;
  roomPhase: "lobby" | "playing" | "complete";
  locked: boolean;
  teamCount: TeamCount;
  configuredTeams: TeamId[];
  viewer: ViewerContext;
  permissions: ProjectionPermissions;
  seats: SeatSummary[];
  publicHistory: PublicHistoryEntry[];
  board: PublicBoard | null;
}

export interface PublicProjection extends ProjectionBase {
  viewRole: "spectator";
  key?: never;
}

export type SpectatorProjection = PublicProjection;

export interface UnassignedProjection extends ProjectionBase {
  viewRole: "unassigned";
  key?: never;
}

export interface OperativeProjection extends ProjectionBase {
  viewRole: "operative";
  key?: never;
}

export interface ClueGiverProjection extends ProjectionBase {
  viewRole: "clue-giver";
  key: Record<CardId, Ownership>;
}

export type ClientProjection =
  | UnassignedProjection
  | OperativeProjection
  | ClueGiverProjection
  | SpectatorProjection;

const SeatRoleSchema = z.enum([
  "unassigned",
  "clue-giver",
  "operative",
  "spectator",
]);
const OwnershipSchema = z.enum([...TEAM_IDS, "neutral", "hazard"]);
const PlayPhaseSchema = z.enum([
  "clue",
  "guess",
  "challenged",
  "paused",
  "board_complete",
]);

const ViewerContextSchema = z
  .object({
    playerId: z.string(),
    teamId: TeamIdSchema.nullable(),
    role: SeatRoleSchema,
    isHost: z.boolean(),
  })
  .strict();

const ProjectionPermissionsSchema = z
  .object({
    configure: z.boolean(),
    moderate: z.boolean(),
    submitClue: z.boolean(),
    challengeClue: z.boolean(),
    nominate: z.boolean(),
    confirmReveal: z.boolean(),
    endTurn: z.boolean(),
    resolveChallenge: z.boolean(),
    pause: z.boolean(),
    resume: z.boolean(),
  })
  .strict();

const SeatSummarySchema = z
  .object({
    playerId: z.string(),
    displayName: z.string(),
    teamId: TeamIdSchema.nullable(),
    role: SeatRoleSchema,
    connected: z.boolean(),
  })
  .strict();

const PublicHistoryEntrySchema = z.discriminatedUnion("type", [
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string(),
      type: z.literal("clue_submitted"),
      teamId: TeamIdSchema,
      word: z.string(),
      count: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string(),
      type: z.literal("clue_challenged"),
      teamId: TeamIdSchema,
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string(),
      type: z.literal("challenge_resolved"),
      decision: z.enum(["accept", "reject"]),
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string(),
      type: z.literal("card_revealed"),
      teamId: TeamIdSchema,
      cardId: z.string(),
      owner: OwnershipSchema,
      eliminatedTeam: TeamIdSchema.optional(),
    })
    .strict()
    .superRefine((entry, context) => {
      if (entry.eliminatedTeam !== undefined && entry.owner !== "hazard") {
        context.addIssue({
          code: "custom",
          path: ["eliminatedTeam"],
          message: "Only hazard reveals may eliminate a team",
        });
      }
    }),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string(),
      type: z.literal("turn_ended"),
      teamId: TeamIdSchema,
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string(),
      type: z.literal("room_paused"),
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string(),
      type: z.literal("room_resumed"),
    })
    .strict(),
]);

const UnrevealedPublicCardSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    revealed: z.literal(false),
  })
  .strict();
const RevealedPublicCardSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    revealed: z.literal(true),
    owner: OwnershipSchema,
  })
  .strict();
const PublicCardSchema = z.discriminatedUnion("revealed", [
  UnrevealedPublicCardSchema,
  RevealedPublicCardSchema,
]);

const PublicClueSchema = z
  .object({ word: z.string(), count: z.number().int().nonnegative() })
  .strict();

const PublicNominationSchema = z
  .object({ playerId: z.string(), cardId: z.string() })
  .strict();

const PublicTeamSummarySchema = z
  .object({
    teamId: TeamIdSchema,
    revealedTargets: z.number().int().nonnegative(),
    eliminated: z.boolean(),
  })
  .strict();

const PublicBoardSchema = z
  .object({
    teamCount: TeamCountSchema,
    rows: z.union([z.literal(5), z.literal(6)]),
    columns: z.union([z.literal(5), z.literal(6)]),
    configuredTeams: z.array(TeamIdSchema),
    eliminatedTeams: z.array(TeamIdSchema),
    teamSummaries: z.array(PublicTeamSummarySchema),
    order: z.array(z.string()),
    cards: z.array(PublicCardSchema),
    activeTeam: TeamIdSchema,
    phase: PlayPhaseSchema,
    clue: PublicClueSchema.nullable(),
    guessesRemaining: z.number().int().nonnegative(),
    nomination: PublicNominationSchema.nullable(),
    winner: TeamIdSchema.nullable(),
    completionReason: z.enum(["targets", "hazard"]).nullable(),
  })
  .strict();

const OwnershipKeySchema = z
  .preprocess(
    (value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      return Object.keys(value).map((cardId) => [
        cardId,
        (value as Record<string, unknown>)[cardId],
      ]);
    },
    z.array(z.tuple([z.string(), OwnershipSchema])),
  )
  .transform((entries): Record<CardId, Ownership> => {
    const key: Record<CardId, Ownership> = Object.create(null);
    for (const [cardId, owner] of entries) {
      key[cardId] = owner;
    }
    return key;
  });

const projectionBaseShape = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  revision: z.number().int().nonnegative(),
  code: z.string(),
  inviteUrl: z.string(),
  roomPhase: z.enum(["lobby", "playing", "complete"]),
  locked: z.boolean(),
  teamCount: TeamCountSchema,
  configuredTeams: z.array(TeamIdSchema),
  viewer: ViewerContextSchema,
  permissions: ProjectionPermissionsSchema,
  seats: z.array(SeatSummarySchema),
  publicHistory: z.array(PublicHistoryEntrySchema).max(100),
  board: PublicBoardSchema.nullable(),
};

const UnassignedProjectionSchema = z
  .object({ ...projectionBaseShape, viewRole: z.literal("unassigned") })
  .strict();
const OperativeProjectionSchema = z
  .object({ ...projectionBaseShape, viewRole: z.literal("operative") })
  .strict();
const ClueGiverProjectionSchema = z
  .object({
    ...projectionBaseShape,
    viewRole: z.literal("clue-giver"),
    key: OwnershipKeySchema,
  })
  .strict();
const SpectatorProjectionSchema = z
  .object({ ...projectionBaseShape, viewRole: z.literal("spectator") })
  .strict();

export const ClientProjectionSchema = z
  .discriminatedUnion("viewRole", [
    UnassignedProjectionSchema,
    OperativeProjectionSchema,
    ClueGiverProjectionSchema,
    SpectatorProjectionSchema,
  ])
  .superRefine((projection, context) => {
    const expectedTeams = TEAM_IDS.slice(0, projection.teamCount);
    if (!arraysEqual(projection.configuredTeams, expectedTeams)) {
      context.addIssue({
        code: "custom",
        path: ["configuredTeams"],
        message: "Configured teams must exactly match the team count",
      });
    }

    const board = projection.board;
    if (board !== null) {
      validatePublicBoard(projection.teamCount, expectedTeams, board, context);
    }

    if (projection.viewRole === "clue-giver") {
      const boardCardIds = new Set(board?.order ?? []);
      const keyCardIds = Object.keys(projection.key);
      if (
        keyCardIds.length !== boardCardIds.size ||
        keyCardIds.some((cardId) => !boardCardIds.has(cardId))
      ) {
        context.addIssue({
          code: "custom",
          path: ["key"],
          message: "Clue-giver key must exactly cover the current board",
        });
      }
    }
  });

const BOARD_DIMENSIONS: Record<
  TeamCount,
  { rows: 5 | 6; columns: 5 | 6; cardCount: 25 | 30 | 36 }
> = {
  2: { rows: 5, columns: 5, cardCount: 25 },
  3: { rows: 5, columns: 6, cardCount: 30 },
  4: { rows: 6, columns: 6, cardCount: 36 },
};

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validatePublicBoard(
  teamCount: TeamCount,
  expectedTeams: readonly TeamId[],
  board: PublicBoard,
  context: z.RefinementCtx,
): void {
  if (board.teamCount !== teamCount) {
    context.addIssue({
      code: "custom",
      path: ["board", "teamCount"],
      message: "Board team count must match the projection team count",
    });
  }

  const dimensions = BOARD_DIMENSIONS[board.teamCount];
  if (
    board.rows !== dimensions.rows ||
    board.columns !== dimensions.columns ||
    board.order.length !== dimensions.cardCount ||
    board.cards.length !== dimensions.cardCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["board"],
      message: "Board dimensions must match the configured team count",
    });
  }

  if (!arraysEqual(board.configuredTeams, expectedTeams)) {
    context.addIssue({
      code: "custom",
      path: ["board", "configuredTeams"],
      message: "Board teams must match the projection teams",
    });
  }

  const orderIds = new Set(board.order);
  const cardIds = new Set(board.cards.map((card) => card.id));
  if (
    orderIds.size !== board.order.length ||
    cardIds.size !== board.cards.length ||
    !arraysEqual([...cardIds].sort(), [...orderIds].sort())
  ) {
    context.addIssue({
      code: "custom",
      path: ["board", "cards"],
      message: "Public cards must exactly cover the board order",
    });
  }

  const eliminatedTeams = new Set(board.eliminatedTeams);
  if (
    eliminatedTeams.size !== board.eliminatedTeams.length ||
    board.eliminatedTeams.some((teamId) => !expectedTeams.includes(teamId))
  ) {
    context.addIssue({
      code: "custom",
      path: ["board", "eliminatedTeams"],
      message: "Eliminated teams must be unique configured teams",
    });
  }

  const summaries = new Map(
    board.teamSummaries.map((summary) => [summary.teamId, summary]),
  );
  if (
    summaries.size !== board.teamSummaries.length ||
    !arraysEqual(
      board.teamSummaries.map((summary) => summary.teamId),
      expectedTeams,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["board", "teamSummaries"],
      message: "Team summaries must exactly cover configured teams in order",
    });
  }

  for (const teamId of expectedTeams) {
    const summary = summaries.get(teamId);
    const revealedTargets = board.cards.filter(
      (card) => card.revealed && card.owner === teamId,
    ).length;
    if (
      summary === undefined ||
      summary.revealedTargets !== revealedTargets ||
      summary.eliminated !== eliminatedTeams.has(teamId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["board", "teamSummaries"],
        message: "Team summaries must contain only current public board facts",
      });
      break;
    }
  }
}

function copyViewer(viewer: ViewerContext): ViewerContext {
  return {
    playerId: viewer.playerId,
    teamId: viewer.teamId,
    role: viewer.role,
    isHost: viewer.isHost,
  };
}

function copySeat(seat: SeatSummary): SeatSummary {
  return {
    playerId: seat.playerId,
    displayName: seat.displayName,
    teamId: seat.teamId,
    role: seat.role,
    connected: seat.connected,
  };
}

function copyHistoryEntry(entry: PublicHistoryEntry): PublicHistoryEntry {
  switch (entry.type) {
    case "clue_submitted":
      return {
        revision: entry.revision,
        at: entry.at,
        type: "clue_submitted",
        teamId: entry.teamId,
        word: entry.word,
        count: entry.count,
      };
    case "clue_challenged":
      return {
        revision: entry.revision,
        at: entry.at,
        type: "clue_challenged",
        teamId: entry.teamId,
      };
    case "challenge_resolved":
      return {
        revision: entry.revision,
        at: entry.at,
        type: "challenge_resolved",
        decision: entry.decision,
      };
    case "card_revealed":
      return {
        revision: entry.revision,
        at: entry.at,
        type: "card_revealed",
        teamId: entry.teamId,
        cardId: entry.cardId,
        owner: entry.owner,
        ...(entry.eliminatedTeam === undefined
          ? {}
          : { eliminatedTeam: entry.eliminatedTeam }),
      };
    case "turn_ended":
      return {
        revision: entry.revision,
        at: entry.at,
        type: "turn_ended",
        teamId: entry.teamId,
      };
    case "room_paused":
      return {
        revision: entry.revision,
        at: entry.at,
        type: "room_paused",
      };
    case "room_resumed":
      return {
        revision: entry.revision,
        at: entry.at,
        type: "room_resumed",
      };
  }
}

function permissionsFor(
  source: RoomProjectionSource,
  viewer: ViewerContext,
): ProjectionPermissions {
  const matchingSeat = source.seats.find(
    (seat) => seat.playerId === viewer.playerId,
  );
  const connected = matchingSeat?.connected === true;
  const host = connected && viewer.isHost;
  const game = source.roomPhase === "playing" ? source.game : null;
  const activeClueGiver =
    connected &&
    viewer.role === "clue-giver" &&
    viewer.teamId !== null &&
    viewer.teamId === game?.activeTeam;
  const opposingClueGiver =
    connected &&
    viewer.role === "clue-giver" &&
    viewer.teamId !== null &&
    viewer.teamId !== game?.activeTeam;
  const activeOperative =
    connected &&
    viewer.role === "operative" &&
    viewer.teamId !== null &&
    viewer.teamId === game?.activeTeam;
  const operativeGuess = activeOperative && game?.phase === "guess";

  return {
    configure: host && source.roomPhase === "lobby",
    moderate: host,
    submitClue: activeClueGiver && game?.phase === "clue",
    challengeClue: opposingClueGiver && game?.phase === "guess",
    nominate: operativeGuess,
    confirmReveal: operativeGuess && game.nomination !== null,
    endTurn: operativeGuess,
    resolveChallenge: host && game?.phase === "challenged",
    pause:
      host &&
      (game?.phase === "clue" ||
        game?.phase === "guess" ||
        game?.phase === "challenged"),
    resume: host && game?.phase === "paused",
  };
}

function publicBoard(game: ClassicGameState | null): PublicBoard | null {
  if (game === null) {
    return null;
  }

  const order = game.board.order.map((cardId) => cardId);
  const cards = order.map((cardId): PublicCard => {
    if (!Object.hasOwn(game.board.cards, cardId)) {
      throw new Error(`Board order contains unknown card ID: ${cardId}`);
    }
    const card = game.board.cards[cardId]!;
    if (card.revealed) {
      return {
        id: card.id,
        label: card.label,
        revealed: true,
        owner: card.owner,
      };
    }
    return { id: card.id, label: card.label, revealed: false };
  });

  return {
    teamCount: game.board.teamCount,
    rows: game.board.rows,
    columns: game.board.columns,
    configuredTeams: [...game.board.configuredTeams],
    eliminatedTeams: [...game.eliminatedTeams],
    teamSummaries: game.board.configuredTeams.map((teamId) => ({
      teamId,
      revealedTargets: cards.filter(
        (card) => card.revealed && card.owner === teamId,
      ).length,
      eliminated: game.eliminatedTeams.includes(teamId),
    })),
    order,
    cards,
    activeTeam: game.activeTeam,
    phase: game.phase,
    clue:
      game.clue === null
        ? null
        : { word: game.clue.word, count: game.clue.count },
    guessesRemaining: game.guessesRemaining,
    nomination:
      game.nomination === null
        ? null
        : {
            playerId: game.nomination.playerId,
            cardId: game.nomination.cardId,
          },
    winner: game.winner,
    completionReason: game.completionReason,
  };
}

function projectionBase(
  source: RoomProjectionSource,
  viewer: ViewerContext,
): ProjectionBase {
  return {
    protocolVersion: PROTOCOL_VERSION,
    revision: source.revision,
    code: source.code,
    inviteUrl: source.inviteUrl,
    roomPhase: source.roomPhase,
    locked: source.locked,
    teamCount: source.teamCount,
    configuredTeams: [...source.configuredTeams],
    viewer: copyViewer(viewer),
    permissions: permissionsFor(source, viewer),
    seats: source.seats.map(copySeat),
    publicHistory: source.publicHistory.slice(-100).map(copyHistoryEntry),
    board: publicBoard(source.game),
  };
}

function ownershipKey(
  game: ClassicGameState | null,
): Record<CardId, Ownership> {
  const key: Record<CardId, Ownership> = Object.create(null);
  if (game === null) {
    return key;
  }

  for (const cardId of game.board.order) {
    if (!Object.hasOwn(game.board.cards, cardId)) {
      throw new Error(`Board order contains unknown card ID: ${cardId}`);
    }
    key[cardId] = game.board.cards[cardId]!.owner;
  }
  return key;
}

export function projectRoomForSeat(
  source: RoomProjectionSource,
  viewer: ViewerContext,
): ClientProjection {
  if (source.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported room protocol version: ${source.protocolVersion}`,
    );
  }

  const base = projectionBase(source, viewer);
  switch (viewer.role) {
    case "unassigned":
      return { ...base, viewRole: "unassigned" };
    case "operative":
      return { ...base, viewRole: "operative" };
    case "clue-giver":
      return {
        ...base,
        viewRole: "clue-giver",
        key: ownershipKey(source.game),
      };
    case "spectator":
      return { ...base, viewRole: "spectator" };
  }
}
