import type { ClientCommand, ClientProjection } from "@cipher-party/protocol";
import { useRef, useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";

interface GuessPanelProps {
  board: NonNullable<ClientProjection["board"]>;
  nominateAllowed: boolean;
  endTurnAllowed: boolean;
  disabled: boolean;
  send(command: ClientCommand): void;
}

export function GuessPanel({
  board,
  nominateAllowed,
  endTurnAllowed,
  disabled,
  send,
}: GuessPanelProps) {
  const [confirmingEndTurn, setConfirmingEndTurn] = useState(false);
  const endTurnButtonRef = useRef<HTMLButtonElement>(null);

  if (!nominateAllowed && !endTurnAllowed) {
    return null;
  }

  const endTurn = () => {
    if (board.guessesRemaining > 0) {
      setConfirmingEndTurn(true);
      return;
    }
    send({ type: "end_turn" });
  };

  return (
    <section className="game-control-panel" aria-label="Guess controls">
      <p className="card-index">Operative desk</p>
      {nominateAllowed && board.nomination !== null ? (
        <button
          className="button-secondary"
          type="button"
          disabled={disabled}
          onClick={() => send({ type: "clear_nomination" })}
        >
          Clear nomination
        </button>
      ) : null}
      {endTurnAllowed ? (
        <button
          ref={endTurnButtonRef}
          type="button"
          disabled={disabled}
          onClick={endTurn}
        >
          End turn
        </button>
      ) : null}
      {confirmingEndTurn ? (
        <ConfirmDialog
          title="Confirm end turn"
          description={`End the turn with ${board.guessesRemaining} guesses remaining?`}
          confirmLabel="Confirm end turn"
          cancelLabel="Keep guessing"
          disabled={disabled}
          returnFocus={endTurnButtonRef.current}
          onCancel={() => setConfirmingEndTurn(false)}
          onConfirm={() => {
            if (endTurnAllowed && board.guessesRemaining > 0 && !disabled) {
              send({ type: "end_turn" });
            }
            setConfirmingEndTurn(false);
          }}
        />
      ) : null}
    </section>
  );
}
