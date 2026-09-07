import type {
  CardId,
  ClassicGameState,
  Ownership,
  PlayerId,
  PlayPhase,
  SeatRole,
  TeamId
} from "@cipher-party/game-core";
import { z } from "zod";

export type {
  CardId,
  ClassicGameState,
  Ownership,
  PlayerId,
  PlayPhase,
  SeatRole,
  TeamId
};

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
  | { revision: number; at: string; type: "clue_challenged"; teamId: TeamId }
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
    }
  | { revision: number; at: string; type: "turn_ended"; teamId: TeamId }
  | { revision: number; at: string; type: "room_paused" | "room_resumed" };

export interface RoomProjectionSource {
  protocolVersion: number;
  code: string;
  inviteUrl: string;
  revision: number;
  roomPhase: "lobby" | "playing" | "complete";
  locked: boolean;
  seats: SeatSummary[];
  publicHistory: PublicHistoryEntry[];
  game: ClassicGameState | null;
}

export interface PublicCard {
  id: CardId;
  label: string;
  revealed: boolean;
  owner?: Ownership | undefined;
}

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

export interface PublicBoardProjection {
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

export interface ProjectionBase {
  protocolVersion: 1;
  revision: number;
  code: string;
  inviteUrl: string;
  roomPhase: "lobby" | "playing" | "complete";
  locked: boolean;
  viewer: ViewerContext;
  permissions: ProjectionPermissions;
  seats: SeatSummary[];
  publicHistory: PublicHistoryEntry[];
  board: PublicBoardProjection | null;
}

export interface OperativeProjection extends ProjectionBase {
  viewRole: "operative";
}

export interface ClueGiverProjection extends ProjectionBase {
  viewRole: "clue-giver";
  key: Record<CardId, Ownership>;
}

export interface SpectatorProjection extends ProjectionBase {
  viewRole: "spectator";
}

export interface UnassignedProjection extends ProjectionBase {
  viewRole: "unassigned";
}

export type PublicProjection = SpectatorProjection;

export type ClientProjection =
  | OperativeProjection
  | ClueGiverProjection
  | SpectatorProjection
  | UnassignedProjection;

export const SeatSummarySchema = z
  .object({
    playerId: z.string().min(1),
    displayName: z.string().min(1),
    teamId: z.enum(["red", "blue"]).nullable(),
    role: z.enum(["unassigned", "clue-giver", "operative", "spectator"]),
    connected: z.boolean()
  })
  .strict();

export const PublicHistoryEntrySchema = z.discriminatedUnion("type", [
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string().min(1),
      type: z.literal("clue_submitted"),
      teamId: z.enum(["red", "blue"]),
      word: z.string().min(1),
      count: z.number().int().min(1).max(9)
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string().min(1),
      type: z.literal("clue_challenged"),
      teamId: z.enum(["red", "blue"])
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string().min(1),
      type: z.literal("challenge_resolved"),
      decision: z.enum(["accept", "reject"])
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string().min(1),
      type: z.literal("card_revealed"),
      teamId: z.enum(["red", "blue"]),
      cardId: z.string().min(1),
      owner: z.enum(["red", "blue", "neutral", "hazard"])
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string().min(1),
      type: z.literal("turn_ended"),
      teamId: z.enum(["red", "blue"])
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string().min(1),
      type: z.literal("room_paused")
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      at: z.string().min(1),
      type: z.literal("room_resumed")
    })
    .strict()
]);

export const ViewerContextSchema = z
  .object({
    playerId: z.string().min(1),
    teamId: z.enum(["red", "blue"]).nullable(),
    role: z.enum(["unassigned", "clue-giver", "operative", "spectator"]),
    isHost: z.boolean()
  })
  .strict();

export const ProjectionPermissionsSchema = z
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
    resume: z.boolean()
  })
  .strict();

export const PublicCardSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    revealed: z.boolean(),
    owner: z.enum(["red", "blue", "neutral", "hazard"]).optional()
  })
  .strict();

export const PublicBoardProjectionSchema = z
  .object({
    order: z.array(z.string().min(1)),
    cards: z.array(PublicCardSchema),
    activeTeam: z.enum(["red", "blue"]),
    phase: z.enum(["clue", "guess", "challenged", "paused", "board_complete"]),
    clue: z
      .object({
        word: z.string().min(1),
        count: z.number().int().min(1)
      })
      .nullable(),
    guessesRemaining: z.number().int().nonnegative(),
    nomination: z
      .object({
        playerId: z.string().min(1),
        cardId: z.string().min(1)
      })
      .nullable(),
    winner: z.enum(["red", "blue"]).nullable(),
    completionReason: z.enum(["targets", "hazard"]).nullable()
  })
  .strict();

const baseProjectionShape = {
  protocolVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  code: z.string().min(1),
  inviteUrl: z.string().min(1),
  roomPhase: z.enum(["lobby", "playing", "complete"]),
  locked: z.boolean(),
  viewer: ViewerContextSchema,
  permissions: ProjectionPermissionsSchema,
  seats: z.array(SeatSummarySchema),
  publicHistory: z.array(PublicHistoryEntrySchema).max(100),
  board: PublicBoardProjectionSchema.nullable()
};

export const OperativeProjectionSchema = z
  .object({
    ...baseProjectionShape,
    viewRole: z.literal("operative")
  })
  .strict();

export const ClueGiverProjectionSchema = z
  .object({
    ...baseProjectionShape,
    viewRole: z.literal("clue-giver"),
    key: z.record(z.string(), z.enum(["red", "blue", "neutral", "hazard"]))
  })
  .strict();

export const SpectatorProjectionSchema = z
  .object({
    ...baseProjectionShape,
    viewRole: z.literal("spectator")
  })
  .strict();

export const UnassignedProjectionSchema = z
  .object({
    ...baseProjectionShape,
    viewRole: z.literal("unassigned")
  })
  .strict();

export const ClientProjectionSchema = z.discriminatedUnion("viewRole", [
  OperativeProjectionSchema,
  ClueGiverProjectionSchema,
  SpectatorProjectionSchema,
  UnassignedProjectionSchema
]);

export const PublicProjectionSchema = SpectatorProjectionSchema;

export function projectRoomForSeat(
  source: RoomProjectionSource,
  viewer: ViewerContext
): ClientProjection {
  const viewerSeat = source.seats.find((s) => s.playerId === viewer.playerId);
  const isConnected = viewerSeat ? viewerSeat.connected : true;
  const isPlaying = source.roomPhase === "playing" && source.game !== null;
  const game = source.game;

  const permissions: ProjectionPermissions = {
    configure: viewer.isHost,
    moderate: viewer.isHost,
    submitClue: Boolean(
      isConnected &&
      isPlaying &&
      game?.phase === "clue" &&
      viewer.role === "clue-giver" &&
      viewer.teamId !== null &&
      viewer.teamId === game.activeTeam
    ),
    challengeClue: Boolean(
      isConnected &&
      isPlaying &&
      game?.phase === "guess" &&
      viewer.role === "clue-giver" &&
      viewer.teamId !== null &&
      viewer.teamId !== game.activeTeam
    ),
    nominate: Boolean(
      isConnected &&
      isPlaying &&
      game?.phase === "guess" &&
      viewer.role === "operative" &&
      viewer.teamId !== null &&
      viewer.teamId === game.activeTeam
    ),
    confirmReveal: Boolean(
      isConnected &&
      isPlaying &&
      game?.phase === "guess" &&
      viewer.role === "operative" &&
      viewer.teamId !== null &&
      viewer.teamId === game.activeTeam &&
      game.nomination !== null
    ),
    endTurn: Boolean(
      isConnected &&
      isPlaying &&
      game?.phase === "guess" &&
      viewer.role === "operative" &&
      viewer.teamId !== null &&
      viewer.teamId === game.activeTeam
    ),
    resolveChallenge: Boolean(
      viewer.isHost && isPlaying && game?.phase === "challenged"
    ),
    pause: Boolean(
      viewer.isHost &&
      isPlaying &&
      game?.phase !== "paused" &&
      game?.phase !== "board_complete"
    ),
    resume: Boolean(viewer.isHost && isPlaying && game?.phase === "paused")
  };

  const recentHistory = source.publicHistory.slice(-100);
  const publicHistory: PublicHistoryEntry[] = recentHistory.map((entry) => {
    switch (entry.type) {
      case "clue_submitted":
        return {
          revision: entry.revision,
          at: entry.at,
          type: "clue_submitted",
          teamId: entry.teamId,
          word: entry.word,
          count: entry.count
        };
      case "clue_challenged":
        return {
          revision: entry.revision,
          at: entry.at,
          type: "clue_challenged",
          teamId: entry.teamId
        };
      case "challenge_resolved":
        return {
          revision: entry.revision,
          at: entry.at,
          type: "challenge_resolved",
          decision: entry.decision
        };
      case "card_revealed":
        return {
          revision: entry.revision,
          at: entry.at,
          type: "card_revealed",
          teamId: entry.teamId,
          cardId: entry.cardId,
          owner: entry.owner
        };
      case "turn_ended":
        return {
          revision: entry.revision,
          at: entry.at,
          type: "turn_ended",
          teamId: entry.teamId
        };
      case "room_paused":
      case "room_resumed":
        return {
          revision: entry.revision,
          at: entry.at,
          type: entry.type
        };
    }
  });

  let board: PublicBoardProjection | null = null;
  if (game) {
    const cards: PublicCard[] = game.board.order.map((cardId) => {
      const card = game.board.cards[cardId];
      if (!card) {
        throw new Error(`Card ${cardId} missing in game board`);
      }
      if (card.revealed) {
        return {
          id: card.id,
          label: card.label,
          revealed: true,
          owner: card.owner
        };
      }
      return {
        id: card.id,
        label: card.label,
        revealed: false
      };
    });

    board = {
      order: [...game.board.order],
      cards,
      activeTeam: game.activeTeam,
      phase: game.phase,
      clue: game.clue ? { word: game.clue.word, count: game.clue.count } : null,
      guessesRemaining: game.guessesRemaining,
      nomination: game.nomination
        ? {
            playerId: game.nomination.playerId,
            cardId: game.nomination.cardId
          }
        : null,
      winner: game.winner,
      completionReason: game.completionReason
    };
  }

  const base: ProjectionBase = {
    protocolVersion: 1,
    revision: source.revision,
    code: source.code,
    inviteUrl: source.inviteUrl,
    roomPhase: source.roomPhase,
    locked: source.locked,
    viewer: {
      playerId: viewer.playerId,
      teamId: viewer.teamId,
      role: viewer.role,
      isHost: viewer.isHost
    },
    permissions,
    seats: source.seats.map((s) => ({
      playerId: s.playerId,
      displayName: s.displayName,
      teamId: s.teamId,
      role: s.role,
      connected: s.connected
    })),
    publicHistory,
    board
  };

  switch (viewer.role) {
    case "clue-giver": {
      const key: Record<CardId, Ownership> = {};
      if (game) {
        for (const cardId of game.board.order) {
          const card = game.board.cards[cardId];
          if (card) {
            key[card.id] = card.owner;
          }
        }
      }
      return {
        ...base,
        viewRole: "clue-giver",
        key
      };
    }

    case "operative": {
      return {
        ...base,
        viewRole: "operative"
      };
    }

    case "spectator": {
      return {
        ...base,
        viewRole: "spectator"
      };
    }

    case "unassigned": {
      return {
        ...base,
        viewRole: "unassigned"
      };
    }
  }
}
