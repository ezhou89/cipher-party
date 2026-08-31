import {
  createSeededRandom,
  type ClassicGameState,
  type PlayerId,
  type RoomCode,
  type SeatRole,
  type TeamId,
} from "@cipher-party/game-core";
import type { CommandResult, PublicHistoryEntry } from "@cipher-party/protocol";

export interface RoomSeat {
  playerId: PlayerId;
  displayName: string;
  seatClass: "active" | "spectator";
  teamId: TeamId | null;
  role: SeatRole;
  connected: boolean;
  seatTokenHash: string;
}

export interface RoomState {
  schemaVersion: 1;
  protocolVersion: 1;
  code: RoomCode;
  inviteUrl: string;
  revision: number;
  phase: "lobby" | "playing" | "complete";
  locked: boolean;
  createdAt: string;
  lastActivity: string;
  boardSeed: string;
  startingTeam: TeamId;
  hostPlayerId: PlayerId;
  hostTokenHash: string;
  seats: RoomSeat[];
  game: ClassicGameState | null;
  publicHistory: PublicHistoryEntry[];
  connectionTickets: Array<{
    ticketHash: string;
    playerId: PlayerId;
    hostAuthority: boolean;
    expiresAt: number;
  }>;
  processedCommands: Array<{
    commandId: string;
    payloadDigest: string;
    result: CommandResult;
  }>;
}

export interface RoomActor {
  playerId: PlayerId;
  hostAuthority: boolean;
}

export interface CreateLobbyStateInput {
  code: RoomCode;
  inviteUrl: string;
  boardSeed: string;
  hostPlayerId: PlayerId;
  displayName: string;
  seatTokenHash: string;
  hostTokenHash: string;
  createdAt: string;
}

export function createLobbyState(input: CreateLobbyStateInput): RoomState {
  const startingTeam: TeamId =
    createSeededRandom(`${input.boardSeed}/starting-team`)() < 0.5
      ? "red"
      : "blue";

  return {
    schemaVersion: 1,
    protocolVersion: 1,
    code: input.code,
    inviteUrl: input.inviteUrl,
    revision: 0,
    phase: "lobby",
    locked: false,
    createdAt: input.createdAt,
    lastActivity: input.createdAt,
    boardSeed: input.boardSeed,
    startingTeam,
    hostPlayerId: input.hostPlayerId,
    hostTokenHash: input.hostTokenHash,
    seats: [
      {
        playerId: input.hostPlayerId,
        displayName: input.displayName,
        seatClass: "active",
        teamId: null,
        role: "unassigned",
        connected: false,
        seatTokenHash: input.seatTokenHash,
      },
    ],
    game: null,
    publicHistory: [],
    connectionTickets: [],
    processedCommands: [],
  };
}
