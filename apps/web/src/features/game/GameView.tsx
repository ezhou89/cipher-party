import type {
  ClientCommand,
  ClientProjection,
  PublicHistoryEntry,
} from "@cipher-party/protocol";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import type { RoomConnectionState } from "../../lib/room-socket";
import { BoardGrid } from "./BoardGrid";
import { BoardResult } from "./BoardResult";
import { CluePanel } from "./CluePanel";
import { GameHistory } from "./GameHistory";
import { GuessPanel } from "./GuessPanel";
import { PrivacyVeil } from "./PrivacyVeil";
import { TeamScore } from "./TeamScore";

type GameBoard = NonNullable<ClientProjection["board"]>;
type PublicOwner = Extract<
  GameBoard["cards"][number],
  { revealed: true }
>["owner"];
type PublicProjection = Exclude<ClientProjection, { viewRole: "clue-giver" }>;
type ClueGiverProjection = Extract<
  ClientProjection,
  { viewRole: "clue-giver" }
>;

export interface GameViewProps {
  projection: ClientProjection;
  connection: RoomConnectionState;
  pending: boolean;
  send(command: ClientCommand): void;
}

const TEAM = {
  red: { label: "Red", symbol: "◆" },
  blue: { label: "Blue", symbol: "●" },
} as const;

const OWNER = {
  red: { label: "Red", symbol: "◆" },
  blue: { label: "Blue", symbol: "●" },
  neutral: { label: "Neutral", symbol: "◇" },
  hazard: { label: "Hazard", symbol: "✦" },
} as const;

function roleLabel(role: ClientProjection["viewRole"]): string {
  switch (role) {
    case "clue-giver":
      return "Clue-giver";
    case "operative":
      return "Operative";
    case "spectator":
      return "Spectator";
    case "unassigned":
      return "Unassigned";
  }
}

function phaseLabel(phase: GameBoard["phase"]): string {
  switch (phase) {
    case "clue":
      return "Clue phase";
    case "guess":
      return "Guessing phase";
    case "challenged":
      return "Clue challenged";
    case "paused":
      return "Paused";
    case "board_complete":
      return "Board complete";
  }
}

function eventAnnouncement(
  entry: PublicHistoryEntry,
  cardLabels: ReadonlyMap<string, string>,
): string {
  switch (entry.type) {
    case "card_revealed": {
      const owner = OWNER[entry.owner];
      return `${cardLabels.get(entry.cardId) ?? "A board card"} was revealed as ${owner.symbol} ${owner.label}.`;
    }
    case "turn_ended":
      return `${TEAM[entry.teamId].label} ended its turn.`;
    case "room_paused":
      return "The room was paused.";
    case "room_resumed":
      return "The room resumed.";
    case "clue_submitted":
      return `${TEAM[entry.teamId].label} submitted a clue.`;
    case "clue_challenged":
      return `${TEAM[entry.teamId].label}’s clue was challenged.`;
    case "challenge_resolved":
      return `The clue challenge was ${entry.decision === "accept" ? "accepted" : "rejected"}.`;
  }
}

interface GameEventAnnouncerProps {
  projection: ClientProjection;
  board: GameBoard;
}

interface AnnouncementSnapshot {
  identity: string;
  latestEvent: string;
  phase: GameBoard["phase"];
  activeTeam: GameBoard["activeTeam"];
}

function GameEventAnnouncer({ projection, board }: GameEventAnnouncerProps) {
  const previousRef = useRef<AnnouncementSnapshot | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const latest = projection.publicHistory.at(-1);
    const current: AnnouncementSnapshot = {
      identity: `${projection.code}\u0000${projection.viewer.playerId}\u0000${board.order.join("\u0000")}`,
      latestEvent:
        latest === undefined ? "" : `${latest.revision}\u0000${latest.type}`,
      phase: board.phase,
      activeTeam: board.activeTeam,
    };
    const previous = previousRef.current;
    previousRef.current = current;
    if (previous === null || previous.identity !== current.identity) {
      setAnnouncement("");
      return;
    }

    if (latest !== undefined && previous.latestEvent !== current.latestEvent) {
      const labels = new Map(board.cards.map((card) => [card.id, card.label]));
      setAnnouncement(eventAnnouncement(latest, labels));
      return;
    }
    if (
      previous.phase !== current.phase ||
      previous.activeTeam !== current.activeTeam
    ) {
      setAnnouncement(
        `${TEAM[board.activeTeam].label} team. ${phaseLabel(board.phase)}.`,
      );
    }
  }, [
    board,
    projection.code,
    projection.publicHistory,
    projection.viewer.playerId,
  ]);

  return (
    <span
      className="visually-hidden"
      role="status"
      aria-label="Game updates"
      aria-live="polite"
      aria-atomic="true"
    >
      {announcement}
    </span>
  );
}

interface GameStatusProps {
  board: GameBoard;
}

function GameStatus({ board }: GameStatusProps) {
  const team = TEAM[board.activeTeam];
  return (
    <section className="game-status-strip" aria-label="Turn status">
      <TeamScore board={board} />
      <div className="turn-status">
        <strong>
          <span aria-hidden="true">{team.symbol}</span> {team.label} team’s turn
        </strong>
        <span>{phaseLabel(board.phase)}</span>
        <span>
          {board.clue === null
            ? "No clue submitted"
            : `${board.clue.word} · ${board.clue.count}`}
        </span>
        <span>
          {board.guessesRemaining}{" "}
          {board.guessesRemaining === 1 ? "guess" : "guesses"} remaining
        </span>
      </div>
    </section>
  );
}

interface ModerationPanelProps {
  projection: ClientProjection;
  board: GameBoard;
  transportDisabled: boolean;
  send(command: ClientCommand): void;
}

function ModerationPanel({
  projection,
  board,
  transportDisabled,
  send,
}: ModerationPanelProps) {
  const showPanel =
    board.phase === "challenged" ||
    board.phase === "paused" ||
    projection.permissions.resolveChallenge ||
    projection.permissions.pause ||
    projection.permissions.resume;
  if (!showPanel) {
    return null;
  }

  return (
    <section
      className="game-control-panel moderation-panel"
      aria-label="Room controls"
    >
      <p className="card-index">Table control</p>
      {board.phase === "challenged" && board.clue !== null ? (
        <p className="disputed-clue">
          Disputed clue: {board.clue.word} · {board.clue.count}
        </p>
      ) : null}
      {board.phase === "paused" ? <p>Game actions are paused.</p> : null}
      {projection.permissions.resolveChallenge ? (
        <div className="control-row">
          <button
            type="button"
            disabled={transportDisabled}
            onClick={() =>
              send({ type: "resolve_challenge", decision: "accept" })
            }
          >
            Accept clue
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={transportDisabled}
            onClick={() =>
              send({ type: "resolve_challenge", decision: "reject" })
            }
          >
            Reject clue
          </button>
        </div>
      ) : null}
      {projection.permissions.pause ? (
        <button
          className="button-secondary"
          type="button"
          disabled={transportDisabled}
          onClick={() => send({ type: "pause_room" })}
        >
          Pause room
        </button>
      ) : null}
      {projection.permissions.resume ? (
        <button
          type="button"
          disabled={transportDisabled}
          onClick={() => send({ type: "resume_room" })}
        >
          Resume room
        </button>
      ) : null}
    </section>
  );
}

interface GameWorkspaceProps {
  projection: ClientProjection;
  board: GameBoard;
  connection: RoomConnectionState;
  pending: boolean;
  privacyControl?: ReactNode;
  keyOwnerForCard?: (cardId: string) => PublicOwner | undefined;
  maxClueCount?: number;
  ownTeam?: "red" | "blue";
  send(command: ClientCommand): void;
}

function GameWorkspace({
  projection,
  board,
  connection,
  pending,
  privacyControl,
  keyOwnerForCard,
  maxClueCount,
  ownTeam,
  send,
}: GameWorkspaceProps) {
  const [revealCardId, setRevealCardId] = useState<string | null>(null);
  const [revealReturnFocus, setRevealReturnFocus] =
    useState<HTMLElement | null>(null);
  const transportDisabled = pending || connection !== "open";
  const gameActionsDisabled =
    transportDisabled ||
    board.phase === "paused" ||
    board.phase === "board_complete" ||
    projection.roomPhase === "complete";
  const revealCard =
    revealCardId !== null &&
    board.phase === "guess" &&
    projection.permissions.confirmReveal &&
    board.nomination?.cardId === revealCardId
      ? (board.cards.find(
          (card) => card.id === revealCardId && card.revealed === false,
        ) ?? null)
      : null;

  useEffect(() => {
    if (revealCardId !== null && revealCard === null) {
      setRevealCardId(null);
    }
  }, [revealCard, revealCardId]);

  const cardActionsAvailable =
    projection.permissions.nominate || projection.permissions.confirmReveal;
  const handleCardAction = (cardId: string) => {
    const card = board.cards.find((candidate) => candidate.id === cardId);
    if (card === undefined || card.revealed || gameActionsDisabled) {
      return;
    }
    if (
      projection.permissions.confirmReveal &&
      board.phase === "guess" &&
      board.nomination?.cardId === cardId
    ) {
      setRevealReturnFocus(
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      );
      setRevealCardId(cardId);
      return;
    }
    if (projection.permissions.nominate && board.phase === "guess") {
      send({ type: "nominate_card", cardId });
    }
  };

  return (
    <>
      <GameEventAnnouncer projection={projection} board={board} />
      <GameStatus board={board} />
      {board.phase === "board_complete" ||
      projection.roomPhase === "complete" ? (
        <BoardResult board={board} />
      ) : null}
      <div className="game-layout">
        <div className="board-column">
          {privacyControl}
          <BoardGrid
            cards={board.cards}
            order={board.order}
            nominatedCardId={board.nomination?.cardId ?? null}
            disabled={gameActionsDisabled}
            {...(cardActionsAvailable ? { onNominate: handleCardAction } : {})}
            {...(keyOwnerForCard === undefined ? {} : { keyOwnerForCard })}
          />
        </div>
        <aside
          className="game-side-panel"
          aria-label="Game context and actions"
        >
          <CluePanel
            board={board}
            submitAllowed={projection.permissions.submitClue}
            challengeAllowed={projection.permissions.challengeClue}
            disabled={gameActionsDisabled}
            send={send}
            {...(maxClueCount === undefined ? {} : { maxCount: maxClueCount })}
            {...(ownTeam === undefined ? {} : { ownTeam })}
          />
          <GuessPanel
            board={board}
            nominateAllowed={projection.permissions.nominate}
            endTurnAllowed={projection.permissions.endTurn}
            disabled={gameActionsDisabled}
            send={send}
          />
          <ModerationPanel
            projection={projection}
            board={board}
            transportDisabled={transportDisabled}
            send={send}
          />
          <GameHistory entries={projection.publicHistory} cards={board.cards} />
        </aside>
      </div>
      {revealCard === null ? null : (
        <ConfirmDialog
          title={`Confirm reveal of ${revealCard.label}`}
          description={`Reveal ${revealCard.label}? This cannot be undone.`}
          confirmLabel="Confirm reveal"
          cancelLabel="Cancel reveal"
          disabled={gameActionsDisabled}
          returnFocus={revealReturnFocus}
          onCancel={() => setRevealCardId(null)}
          onConfirm={() => {
            const currentCard = board.cards.find(
              (card) => card.id === revealCard.id,
            );
            if (
              !gameActionsDisabled &&
              projection.permissions.confirmReveal &&
              board.phase === "guess" &&
              board.nomination?.cardId === revealCard.id &&
              currentCard?.revealed === false
            ) {
              send({ type: "confirm_reveal", cardId: revealCard.id });
            }
            setRevealCardId(null);
          }}
        />
      )}
    </>
  );
}

interface PublicWorkspaceProps {
  projection: PublicProjection;
  board: GameBoard;
  connection: RoomConnectionState;
  pending: boolean;
  send(command: ClientCommand): void;
}

function PublicWorkspace(props: PublicWorkspaceProps) {
  return <GameWorkspace {...props} />;
}

interface ClueGiverWorkspaceProps {
  projection: ClueGiverProjection;
  board: GameBoard;
  connection: RoomConnectionState;
  pending: boolean;
  send(command: ClientCommand): void;
}

function ClueGiverWorkspace({
  projection,
  board,
  connection,
  pending,
  send,
}: ClueGiverWorkspaceProps) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const ownTeam = projection.viewer.teamId;
  let maxClueCount: number | undefined;
  if (ownTeam !== null) {
    const revealedById = new Map(
      board.cards.map((card) => [card.id, card.revealed]),
    );
    maxClueCount = 0;
    for (const cardId of board.order) {
      if (
        projection.key[cardId] === ownTeam &&
        revealedById.get(cardId) === false
      ) {
        maxClueCount += 1;
      }
    }
  }
  const gameActionsDisabled =
    pending ||
    connection !== "open" ||
    board.phase === "paused" ||
    board.phase === "board_complete" ||
    projection.roomPhase === "complete";

  return (
    <GameWorkspace
      projection={projection}
      board={board}
      connection={connection}
      pending={pending}
      send={send}
      privacyControl={
        <PrivacyVeil
          open={privacyOpen}
          disabled={!privacyOpen && gameActionsDisabled}
          onToggle={() => setPrivacyOpen((open) => !open)}
        />
      }
      {...(privacyOpen
        ? {
            keyOwnerForCard: (cardId: string) => projection.key[cardId],
          }
        : {})}
      {...(maxClueCount === undefined ? {} : { maxClueCount })}
      {...(ownTeam === null ? {} : { ownTeam })}
    />
  );
}

export function GameView({
  projection,
  connection,
  pending,
  send,
}: GameViewProps) {
  const board = projection.board;
  const viewerTeam = projection.viewer.teamId;
  const assignment =
    viewerTeam === null
      ? roleLabel(projection.viewRole)
      : `${TEAM[viewerTeam].label} · ${roleLabel(projection.viewRole)}`;

  return (
    <main className="app-shell room-shell game-shell">
      <header className="room-identity-strip game-header">
        <div>
          <p className="eyebrow">Private archive table</p>
          <h1>Room {projection.code} · Classic</h1>
        </div>
        <div className="identity-status">
          <strong>You are {assignment}</strong>
          <ConnectionBadge connection={connection} />
        </div>
      </header>
      {board === null ? (
        <section className="game-empty" aria-label="Game table status">
          Waiting for the authoritative board…
        </section>
      ) : projection.viewRole === "clue-giver" ? (
        <ClueGiverWorkspace
          key={`${projection.code}\u0000${projection.viewer.playerId}\u0000${board.order.join("\u0000")}`}
          projection={projection}
          board={board}
          connection={connection}
          pending={pending}
          send={send}
        />
      ) : (
        <PublicWorkspace
          projection={projection}
          board={board}
          connection={connection}
          pending={pending}
          send={send}
        />
      )}
    </main>
  );
}
