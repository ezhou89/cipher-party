import { useState } from "react";
import type { PlayPhase, TeamId } from "@cipher-party/protocol";
import { ConfirmDialog } from "../../components/ConfirmDialog";

export interface GuessPanelProps {
  activeTeam: TeamId;
  phase: PlayPhase;
  clue: { word: string; count: number } | null;
  guessesRemaining: number;
  nomination: { playerId: string; cardId: string } | null;
  nominatedCardLabel?: string | undefined;
  canNominate: boolean;
  canConfirmReveal: boolean;
  canEndTurn: boolean;
  onConfirmReveal: (cardId: string) => void;
  onEndTurn: () => void;
  isCommandPending?: boolean;
}

export function GuessPanel({
  activeTeam,
  phase,
  clue,
  guessesRemaining,
  nomination,
  nominatedCardLabel,
  canConfirmReveal,
  canEndTurn,
  onConfirmReveal,
  onEndTurn,
  isCommandPending = false
}: GuessPanelProps) {
  const [showRevealConfirm, setShowRevealConfirm] = useState(false);
  const [showEndTurnConfirm, setShowEndTurnConfirm] = useState(false);

  function handleOpenRevealDialog() {
    if (nomination && canConfirmReveal) {
      setShowRevealConfirm(true);
    }
  }

  function handleConfirmRevealAction() {
    setShowRevealConfirm(false);
    if (nomination) {
      onConfirmReveal(nomination.cardId);
    }
  }

  function handleEndTurnClick() {
    if (guessesRemaining > 0) {
      setShowEndTurnConfirm(true);
    } else {
      onEndTurn();
    }
  }

  function handleConfirmEndTurn() {
    setShowEndTurnConfirm(false);
    onEndTurn();
  }

  return (
    <div className="guess-panel">
      <div className="guess-status-bar">
        <div className="status-item">
          <span className="status-label">Turn:</span>
          <span
            className={`status-value team-text-${activeTeam}`}
            data-testid="active-team-indicator"
          >
            {activeTeam === "red" ? "Ruby (Red)" : "Cobalt (Blue)"}
          </span>
        </div>

        <div className="status-item">
          <span className="status-label">Phase:</span>
          <span className="status-value" data-testid="game-phase-indicator">
            {phase.toUpperCase()}
          </span>
        </div>

        {clue && (
          <div className="status-item status-clue-display">
            <span className="status-label">Clue:</span>
            <span className="status-clue-badge">
              <strong data-testid="current-clue-word">{clue.word}</strong>
              <span
                className="clue-count-pill"
                data-testid="current-clue-count"
              >
                {clue.count}
              </span>
            </span>
          </div>
        )}

        <div className="status-item">
          <span className="status-label">Guesses Left:</span>
          <span className="status-value" data-testid="guesses-remaining">
            {guessesRemaining}
          </span>
        </div>
      </div>

      <div className="guess-actions-row">
        {nomination && canConfirmReveal && (
          <button
            type="button"
            className="btn btn-primary btn-reveal-action"
            onClick={handleOpenRevealDialog}
            disabled={isCommandPending}
          >
            Reveal {nominatedCardLabel ?? "Nominated Card"}
          </button>
        )}

        {canEndTurn && (
          <button
            type="button"
            className="btn btn-secondary btn-end-turn"
            onClick={handleEndTurnClick}
            disabled={isCommandPending}
          >
            End Turn
          </button>
        )}
      </div>

      {nomination && (
        <ConfirmDialog
          open={showRevealConfirm}
          title="Confirm Reveal"
          description={
            <p>
              Are you sure you want to reveal card{" "}
              <strong>{nominatedCardLabel ?? nomination.cardId}</strong>?
            </p>
          }
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          onConfirm={handleConfirmRevealAction}
          onCancel={() => setShowRevealConfirm(false)}
        />
      )}

      <ConfirmDialog
        open={showEndTurnConfirm}
        title="End Turn"
        description={<p>End turn with {guessesRemaining} guesses remaining?</p>}
        confirmLabel="End Turn"
        cancelLabel="Cancel"
        onConfirm={handleConfirmEndTurn}
        onCancel={() => setShowEndTurnConfirm(false)}
        isConfirmDestructive
      />
    </div>
  );
}
