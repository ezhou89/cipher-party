import type { BoardCard, ClassicBoard } from "./board";
import type { CardId, PlayerId, TeamId } from "./domain";

export type PlayPhase =
  "clue" | "guess" | "challenged" | "paused" | "board_complete";

type ResumablePlayPhase = Exclude<PlayPhase, "paused" | "board_complete">;

export interface ClassicGameState {
  board: ClassicBoard;
  phase: PlayPhase;
  resumePhase: ResumablePlayPhase | null;
  activeTeam: TeamId;
  clue: { word: string; count: number } | null;
  guessesRemaining: number;
  nomination: { playerId: PlayerId; cardId: CardId } | null;
  winner: TeamId | null;
  completionReason: "targets" | "hazard" | null;
}

export type GameAction =
  | {
      type: "submit_clue";
      teamId: TeamId;
      word: string;
      count: number;
    }
  | { type: "challenge_clue"; teamId: TeamId }
  | { type: "resolve_challenge"; decision: "accept" | "reject" }
  | {
      type: "nominate_card";
      teamId: TeamId;
      playerId: PlayerId;
      cardId: CardId;
    }
  | {
      type: "clear_nomination";
      teamId: TeamId;
      playerId: PlayerId;
    }
  | {
      type: "confirm_reveal";
      teamId: TeamId;
      playerId: PlayerId;
      cardId: CardId;
    }
  | { type: "end_turn"; teamId: TeamId }
  | { type: "pause" }
  | { type: "resume" };

export type GameTransitionErrorReason =
  | "wrong_phase"
  | "wrong_team"
  | "invalid_count"
  | "unknown_card"
  | "missing_nomination"
  | "nomination_mismatch"
  | "already_revealed"
  | "board_complete";

export class GameTransitionError extends Error {
  readonly reason: GameTransitionErrorReason;

  constructor(reason: GameTransitionErrorReason) {
    super(reason);
    this.name = "GameTransitionError";
    this.reason = reason;
  }
}

export function createClassicGame(board: ClassicBoard): ClassicGameState {
  return {
    board,
    phase: "clue",
    resumePhase: null,
    activeTeam: board.startingTeam,
    clue: null,
    guessesRemaining: 0,
    nomination: null,
    winner: null,
    completionReason: null,
  };
}

function otherTeam(teamId: TeamId): TeamId {
  return teamId === "red" ? "blue" : "red";
}

function advanceTurn(state: ClassicGameState): ClassicGameState {
  return {
    ...state,
    phase: "clue",
    resumePhase: null,
    activeTeam: otherTeam(state.activeTeam),
    clue: null,
    guessesRemaining: 0,
    nomination: null,
  };
}

function hasRevealedAllTargets(
  state: ClassicGameState,
  teamId: TeamId,
): boolean {
  return Object.values(state.board.cards)
    .filter((card) => card.owner === teamId)
    .every((card) => card.revealed);
}

function unrevealedTargetCount(
  state: ClassicGameState,
  teamId: TeamId,
): number {
  return Object.values(state.board.cards).filter(
    (card) => card.owner === teamId && !card.revealed,
  ).length;
}

function requirePhase(state: ClassicGameState, phase: PlayPhase): void {
  if (state.phase !== phase) {
    throw new GameTransitionError("wrong_phase");
  }
}

function requireActiveTeam(state: ClassicGameState, teamId: TeamId): void {
  if (teamId !== state.activeTeam) {
    throw new GameTransitionError("wrong_team");
  }
}

function requireOpposingTeam(state: ClassicGameState, teamId: TeamId): void {
  if (teamId !== otherTeam(state.activeTeam)) {
    throw new GameTransitionError("wrong_team");
  }
}

function requireCard(state: ClassicGameState, cardId: CardId): BoardCard {
  if (!Object.hasOwn(state.board.cards, cardId)) {
    throw new GameTransitionError("unknown_card");
  }
  return state.board.cards[cardId]!;
}

function revealCard(
  state: ClassicGameState,
  cardId: CardId,
  card: BoardCard,
): ClassicGameState {
  const cards: Record<CardId, BoardCard> = Object.assign(
    Object.create(null),
    state.board.cards,
  );
  cards[cardId] = { ...card, revealed: true };

  return {
    ...state,
    board: { ...state.board, cards },
    guessesRemaining: state.guessesRemaining - 1,
    nomination: null,
  };
}

function completeBoard(
  state: ClassicGameState,
  winner: TeamId,
  completionReason: "targets" | "hazard",
): ClassicGameState {
  return {
    ...state,
    phase: "board_complete",
    resumePhase: null,
    nomination: null,
    winner,
    completionReason,
  };
}

function applySubmitClue(
  state: ClassicGameState,
  action: Extract<GameAction, { type: "submit_clue" }>,
): ClassicGameState {
  requirePhase(state, "clue");
  requireActiveTeam(state, action.teamId);
  const remainingTargets = unrevealedTargetCount(state, state.activeTeam);
  if (
    !Number.isInteger(action.count) ||
    action.count <= 0 ||
    action.count > remainingTargets
  ) {
    throw new GameTransitionError("invalid_count");
  }
  return {
    ...state,
    phase: "guess",
    clue: { word: action.word, count: action.count },
    guessesRemaining: action.count + 1,
    nomination: null,
  };
}

function applyConfirmReveal(
  state: ClassicGameState,
  action: Extract<GameAction, { type: "confirm_reveal" }>,
): ClassicGameState {
  requirePhase(state, "guess");
  requireActiveTeam(state, action.teamId);
  const card = requireCard(state, action.cardId);
  if (card.revealed) {
    throw new GameTransitionError("already_revealed");
  }
  if (state.nomination === null) {
    throw new GameTransitionError("missing_nomination");
  }
  if (state.nomination.cardId !== action.cardId) {
    throw new GameTransitionError("nomination_mismatch");
  }

  const revealedState = revealCard(state, action.cardId, card);
  if (card.owner === "hazard") {
    return completeBoard(revealedState, otherTeam(state.activeTeam), "hazard");
  }
  if (
    (card.owner === "red" || card.owner === "blue") &&
    hasRevealedAllTargets(revealedState, card.owner)
  ) {
    return completeBoard(revealedState, card.owner, "targets");
  }
  if (card.owner !== state.activeTeam || revealedState.guessesRemaining === 0) {
    return advanceTurn(revealedState);
  }
  return revealedState;
}

export function applyGameAction(
  state: ClassicGameState,
  action: GameAction,
): ClassicGameState {
  if (state.phase === "board_complete") {
    throw new GameTransitionError("board_complete");
  }

  switch (action.type) {
    case "submit_clue":
      return applySubmitClue(state, action);
    case "challenge_clue":
      requirePhase(state, "guess");
      requireOpposingTeam(state, action.teamId);
      return { ...state, phase: "challenged" };
    case "resolve_challenge":
      requirePhase(state, "challenged");
      return action.decision === "accept"
        ? { ...state, phase: "guess" }
        : advanceTurn(state);
    case "nominate_card": {
      requirePhase(state, "guess");
      requireActiveTeam(state, action.teamId);
      const card = requireCard(state, action.cardId);
      if (card.revealed) {
        throw new GameTransitionError("already_revealed");
      }
      return {
        ...state,
        nomination: { playerId: action.playerId, cardId: action.cardId },
      };
    }
    case "clear_nomination":
      requirePhase(state, "guess");
      requireActiveTeam(state, action.teamId);
      if (state.nomination === null) {
        throw new GameTransitionError("missing_nomination");
      }
      return { ...state, nomination: null };
    case "confirm_reveal":
      return applyConfirmReveal(state, action);
    case "end_turn":
      requirePhase(state, "guess");
      requireActiveTeam(state, action.teamId);
      return advanceTurn(state);
    case "pause":
      if (
        state.phase !== "clue" &&
        state.phase !== "guess" &&
        state.phase !== "challenged"
      ) {
        throw new GameTransitionError("wrong_phase");
      }
      return { ...state, phase: "paused", resumePhase: state.phase };
    case "resume":
      requirePhase(state, "paused");
      if (state.resumePhase === null) {
        throw new GameTransitionError("wrong_phase");
      }
      return { ...state, phase: state.resumePhase, resumePhase: null };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
