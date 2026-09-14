import type { ClientCommand, ClientProjection } from "@cipher-party/protocol";

interface GuessPanelProps {
  board: NonNullable<ClientProjection["board"]>;
  nominateAllowed: boolean;
  endTurnAllowed: boolean;
  disabled: boolean;
  send(command: ClientCommand): void;
  onRequestEndTurn(returnFocus: HTMLButtonElement): void;
}

export function GuessPanel({
  board,
  nominateAllowed,
  endTurnAllowed,
  disabled,
  send,
  onRequestEndTurn,
}: GuessPanelProps) {
  if (!nominateAllowed && !endTurnAllowed) {
    return null;
  }

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
          type="button"
          disabled={disabled}
          onClick={(event) => onRequestEndTurn(event.currentTarget)}
        >
          End turn
        </button>
      ) : null}
    </section>
  );
}
