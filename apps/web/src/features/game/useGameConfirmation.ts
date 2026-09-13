import type { ClientCommand, ClientProjection } from "@cipher-party/protocol";
import { useState } from "react";
import type { GameAvailability, GameBoard } from "./game-availability";

type ConfirmationIntent = {
  identity: string;
  returnFocus: HTMLElement | null;
} & (
  | { type: "reveal"; cardId: string }
  | {
      type: "end-turn";
      activeTeam: GameBoard["activeTeam"];
      guessesRemaining: number;
    }
);

interface ConfirmationProjection {
  identity: string;
  roomPhase: ClientProjection["roomPhase"];
  board: GameBoard;
  permissions: ClientProjection["permissions"];
}

interface GameConfirmationInput extends ConfirmationProjection {
  availability: GameAvailability;
  send(command: ClientCommand): void;
}

interface CurrentConfirmation {
  content: {
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
  };
  command: ClientCommand;
}

// Intent validity deliberately ignores transport: reconnect must leave Cancel usable.
function currentConfirmation(
  intent: ConfirmationIntent | null,
  { identity, roomPhase, board, permissions }: ConfirmationProjection,
): CurrentConfirmation | null {
  if (intent === null || intent.identity !== identity) return null;
  if (intent.type === "reveal") {
    if (
      board.phase !== "guess" ||
      !permissions.confirmReveal ||
      board.nomination?.cardId !== intent.cardId
    )
      return null;
    const card = board.cards.find(
      (card) => card.id === intent.cardId && !card.revealed,
    );
    if (card === undefined) return null;
    return {
      content: {
        title: `Confirm reveal of ${card.label}`,
        description: `Reveal ${card.label}? This cannot be undone.`,
        confirmLabel: "Confirm reveal",
        cancelLabel: "Cancel reveal",
      },
      command: { type: "confirm_reveal", cardId: card.id },
    };
  }
  if (
    roomPhase !== "playing" ||
    board.phase !== "guess" ||
    !permissions.endTurn ||
    board.guessesRemaining <= 0 ||
    board.activeTeam !== intent.activeTeam ||
    board.guessesRemaining !== intent.guessesRemaining
  )
    return null;
  return {
    content: {
      title: "Confirm end turn",
      description: `End the turn with ${board.guessesRemaining} guesses remaining?`,
      confirmLabel: "Confirm end turn",
      cancelLabel: "Keep guessing",
    },
    command: { type: "end_turn" },
  };
}

export function useGameConfirmation({
  identity,
  roomPhase,
  board,
  permissions,
  availability,
  send,
}: GameConfirmationInput) {
  const [confirmation, setConfirmation] = useState<ConfirmationIntent | null>(
    null,
  );
  const projection = { identity, roomPhase, board, permissions };
  const current = currentConfirmation(confirmation, projection);
  // Guarded same-component adjustment retires invalid intent before committing UI.
  // Merely hiding it would resurrect it if a later projection cycles back.
  if (confirmation !== null && current === null) setConfirmation(null);

  const handleCardAction = (cardId: string) => {
    const card = board.cards.find((candidate) => candidate.id === cardId);
    if (card === undefined || card.revealed || availability.gameActionsDisabled)
      return;
    if (
      availability.revealRequestEnabled &&
      board.nomination?.cardId === cardId
    ) {
      setConfirmation({
        type: "reveal",
        identity,
        cardId,
        returnFocus:
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
      });
    } else if (availability.nominationEnabled) {
      send({ type: "nominate_card", cardId });
    }
  };
  const requestEndTurn = (returnFocus: HTMLButtonElement) => {
    if (!availability.endTurnRequestEnabled) return;
    if (board.guessesRemaining > 0) {
      setConfirmation({
        type: "end-turn",
        identity,
        activeTeam: board.activeTeam,
        guessesRemaining: board.guessesRemaining,
        returnFocus,
      });
    } else {
      send({ type: "end_turn" });
    }
  };

  const dialog =
    current === null || confirmation === null
      ? null
      : {
          ...current.content,
          returnFocus: confirmation.returnFocus,
          confirmDisabled: availability.gameActionsDisabled,
          onCancel: () => setConfirmation(null),
          onConfirm: () => {
            const latest = currentConfirmation(confirmation, projection);
            if (latest !== null && !availability.gameActionsDisabled)
              send(latest.command);
            setConfirmation(null);
          },
        };
  return { dialog, handleCardAction, requestEndTurn };
}
