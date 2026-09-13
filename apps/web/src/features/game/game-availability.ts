import type { ClientProjection } from "@cipher-party/protocol";
import type { RoomConnectionState } from "../../lib/room-socket";

export type GameBoard = NonNullable<ClientProjection["board"]>;

interface GameAvailabilityInput {
  roomPhase: ClientProjection["roomPhase"];
  board: GameBoard;
  permissions: ClientProjection["permissions"];
  connection: RoomConnectionState;
  pending: boolean;
}

// UI availability follows the authoritative projection; it grants no authority.
export function deriveGameAvailability({
  roomPhase,
  board,
  permissions,
  connection,
  pending,
}: GameAvailabilityInput) {
  const transportDisabled = pending || connection !== "open";
  const gameActionsDisabled =
    transportDisabled ||
    board.phase === "paused" ||
    board.phase === "board_complete" ||
    roomPhase === "complete";
  return {
    transportDisabled,
    gameActionsDisabled,
    cardActionsAvailable: permissions.nominate || permissions.confirmReveal,
    nominationEnabled:
      !gameActionsDisabled && board.phase === "guess" && permissions.nominate,
    revealRequestEnabled:
      !gameActionsDisabled &&
      board.phase === "guess" &&
      permissions.confirmReveal,
    endTurnRequestEnabled:
      !gameActionsDisabled &&
      roomPhase === "playing" &&
      board.phase === "guess" &&
      permissions.endTurn,
  };
}

export type GameAvailability = ReturnType<typeof deriveGameAvailability>;
