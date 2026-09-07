import { useMemo, useState } from "react";
import type {
  CardId,
  ClientCommand,
  ClientProjection,
  PublicCard
} from "@cipher-party/protocol";
import type { RoomConnectionState } from "../../lib/room-socket";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import { BoardGrid } from "./BoardGrid";
import { BoardResult } from "./BoardResult";
import { CluePanel } from "./CluePanel";
import { GameHistory } from "./GameHistory";
import { GuessPanel } from "./GuessPanel";
import { PrivacyVeil } from "./PrivacyVeil";
import { TeamScore } from "./TeamScore";

export interface GameViewProps {
  projection: ClientProjection;
  connectionState: RoomConnectionState;
  onSendCommand: (command: ClientCommand) => void;
  isCommandPending?: boolean;
}

export function GameView({
  projection,
  connectionState,
  onSendCommand,
  isCommandPending = false
}: GameViewProps) {
  const [privacyVeilOpen, setPrivacyVeilOpen] = useState(false);

  const board = projection.board;
  const isClueGiver = projection.viewRole === "clue-giver";
  const permissions = projection.permissions;

  const cardsById = useMemo(() => {
    const map = new Map<CardId, PublicCard>();
    if (board?.cards) {
      for (const card of board.cards) {
        map.set(card.id, card);
      }
    }
    return map;
  }, [board?.cards]);

  if (!board) {
    return (
      <div className="game-container" role="status">
        <p>Loading game board...</p>
      </div>
    );
  }

  const nominatedCard = board.nomination
    ? cardsById.get(board.nomination.cardId)
    : undefined;

  // STRICT PRIVACY INVARIANT: key data is only read and passed when viewer is clue-giver AND privacy veil is open.
  const keyRecord = isClueGiver && privacyVeilOpen ? projection.key : undefined;

  function handleNominateCard(cardId: string) {
    if (permissions.nominate) {
      onSendCommand({
        type: "nominate_card",
        cardId
      });
    }
  }

  function handleSubmitClue(word: string, count: number) {
    onSendCommand({
      type: "submit_clue",
      word,
      count
    });
  }

  function handleChallengeClue() {
    onSendCommand({
      type: "challenge_clue"
    });
  }

  function handleResolveChallenge(decision: "accept" | "reject") {
    onSendCommand({
      type: "resolve_challenge",
      decision
    });
  }

  function handleConfirmReveal(cardId: string) {
    onSendCommand({
      type: "confirm_reveal",
      cardId
    });
  }

  function handleEndTurn() {
    onSendCommand({
      type: "end_turn"
    });
  }

  function handlePauseRoom() {
    onSendCommand({
      type: "pause_room"
    });
  }

  function handleResumeRoom() {
    onSendCommand({
      type: "resume_room"
    });
  }

  const isChallenged = board.phase === "challenged";
  const isPaused = board.phase === "paused";
  const isBoardComplete =
    projection.roomPhase === "complete" || board.phase === "board_complete";

  const liveAnnouncement = isBoardComplete
    ? `Game complete. ${board.winner === "red" ? "Ruby" : "Cobalt"} wins!`
    : isPaused
      ? "Game is paused."
      : isChallenged
        ? "Clue has been challenged."
        : `${board.activeTeam === "red" ? "Ruby" : "Cobalt"} team's turn, ${board.phase} phase.`;

  return (
    <div className="game-container">
      <header className="game-header">
        <div className="game-header-bar">
          <div className="game-header-info">
            <span className="eyebrow">Room Code</span>
            <h1 className="room-code">{projection.code}</h1>
          </div>
          <div className="game-header-actions">
            <ConnectionBadge state={connectionState} />
            {permissions.pause && !isPaused && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handlePauseRoom}
                disabled={isCommandPending}
              >
                Pause
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="game-main">
        {/* Accessible live announcements */}
        <div role="status" aria-live="polite" className="sr-only">
          {liveAnnouncement}
        </div>

        {/* Board Result Banner */}
        {isBoardComplete && (
          <BoardResult
            winner={board.winner}
            completionReason={board.completionReason}
          />
        )}

        {/* Challenged Phase Banner */}
        {isChallenged && (
          <div
            className="challenged-banner"
            role="alert"
            aria-label="Clue challenged"
          >
            <h3>
              Clue Challenged: "{board.clue?.word}" ({board.clue?.count})
            </h3>
            {permissions.resolveChallenge && (
              <div className="challenged-actions">
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={() => handleResolveChallenge("accept")}
                  disabled={isCommandPending}
                >
                  Accept Challenge
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleResolveChallenge("reject")}
                  disabled={isCommandPending}
                >
                  Reject Challenge
                </button>
              </div>
            )}
          </div>
        )}

        {/* Paused Phase Overlay */}
        {isPaused && (
          <div className="paused-banner" role="alert">
            <h2>Game Paused</h2>
            <p>The match has been paused by the host.</p>
            {permissions.resume && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleResumeRoom}
                disabled={isCommandPending}
              >
                Resume Game
              </button>
            )}
          </div>
        )}

        {/* Clue-Giver Privacy Veil Control */}
        {isClueGiver && (
          <PrivacyVeil
            isOpen={privacyVeilOpen}
            onToggle={() => setPrivacyVeilOpen((open) => !open)}
          />
        )}

        {/* Team Scores */}
        <TeamScore cards={board.cards} activeTeam={board.activeTeam} />

        {/* Guess and Turn Panel */}
        <GuessPanel
          activeTeam={board.activeTeam}
          phase={board.phase}
          clue={board.clue}
          guessesRemaining={board.guessesRemaining}
          nomination={board.nomination}
          {...(nominatedCard
            ? { nominatedCardLabel: nominatedCard.label }
            : {})}
          canNominate={permissions.nominate}
          canConfirmReveal={permissions.confirmReveal}
          canEndTurn={permissions.endTurn}
          onConfirmReveal={handleConfirmReveal}
          onEndTurn={handleEndTurn}
          isCommandPending={isCommandPending}
        />

        {/* Clue Submission / Challenge Panel */}
        <CluePanel
          activeTeam={board.activeTeam}
          phase={board.phase}
          canSubmitClue={permissions.submitClue}
          canChallengeClue={permissions.challengeClue}
          currentClue={board.clue}
          onSubmitClue={handleSubmitClue}
          onChallengeClue={handleChallengeClue}
          isCommandPending={isCommandPending}
        />

        {/* 5x5 Board Grid */}
        <BoardGrid
          cards={board.cards}
          order={board.order}
          {...(keyRecord !== undefined ? { keyRecord } : {})}
          nomination={board.nomination}
          canNominate={permissions.nominate}
          onNominate={handleNominateCard}
        />

        {/* Mission / Action History */}
        <GameHistory history={projection.publicHistory} cardsById={cardsById} />
      </main>
    </div>
  );
}
