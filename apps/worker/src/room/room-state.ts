import {
  createSeededRandom,
  type ClassicGameState,
  type PlayerId,
  type RoomCode,
  type SeatRole,
  type TeamId
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
  hostPlayerId: PlayerId;
  hostDisplayName: string;
  hostTokenHash: string;
  seatTokenHash: string;
  boardSeed: string;
  inviteUrl: string;
  now: Date;
}

export function createLobbyState(input: CreateLobbyStateInput): RoomState {
  const random = createSeededRandom(input.boardSeed + "/starting-team");
  const startingTeam: TeamId = random() < 0.5 ? "red" : "blue";
  const nowIso = input.now.toISOString();

  const hostSeat: RoomSeat = {
    playerId: input.hostPlayerId,
    displayName: input.hostDisplayName,
    seatClass: "active",
    teamId: null,
    role: "unassigned",
    connected: true,
    seatTokenHash: input.seatTokenHash
  };

  return {
    schemaVersion: 1,
    protocolVersion: 1,
    code: input.code,
    inviteUrl: input.inviteUrl,
    revision: 0,
    phase: "lobby",
    locked: false,
    createdAt: nowIso,
    lastActivity: nowIso,
    boardSeed: input.boardSeed,
    startingTeam,
    hostPlayerId: input.hostPlayerId,
    hostTokenHash: input.hostTokenHash,
    seats: [hostSeat],
    game: null,
    publicHistory: [],
    connectionTickets: [],
    processedCommands: []
  };
}
