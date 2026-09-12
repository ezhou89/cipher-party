import type { BoardCard, ClassicBoard } from "./board";
import type { CardId, Ownership, PlayerId, TeamId } from "./domain";

export type PlayPhase =
  "clue" | "guess" | "challenged" | "paused" | "board_complete";

type ResumablePlayPhase = Exclude<PlayPhase, "paused" | "board_complete">;

export interface ClassicGameState {
  board: ClassicBoard;
  phase: PlayPhase;
  resumePhase: ResumablePlayPhase | null;
  activeTeam: TeamId;
  eliminatedTeams: TeamId[];
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

export interface GameTransitionEvent {
  type: "card_revealed";
  cardId: CardId;
  owner: Ownership;
  eliminatedTeam?: TeamId;
}

export interface GameTransition {
  state: ClassicGameState;
  event: GameTransitionEvent | null;
}

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
    eliminatedTeams: [],
    clue: null,
    guessesRemaining: 0,
    nomination: null,
    winner: null,
    completionReason: null,
  };
}

function activeTeams(state: ClassicGameState): TeamId[] {
  return state.board.configuredTeams.filter(
    (teamId) => !state.eliminatedTeams.includes(teamId),
  );
}

function nextActiveTeam(state: ClassicGameState): TeamId {
  const currentIndex = state.board.configuredTeams.indexOf(state.activeTeam);
  for (
    let offset = 1;
    offset <= state.board.configuredTeams.length;
    offset += 1
  ) {
    const teamId =
      state.board.configuredTeams[
        (currentIndex + offset) % state.board.configuredTeams.length
      ]!;
    if (!state.eliminatedTeams.includes(teamId)) {
      return teamId;
    }
  }
  return state.activeTeam;
}

function advanceTurn(state: ClassicGameState): ClassicGameState {
  return {
    ...state,
    phase: "clue",
    resumePhase: null,
    activeTeam: nextActiveTeam(state),
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
  if (
    teamId === state.activeTeam ||
    !state.board.configuredTeams.includes(teamId) ||
    state.eliminatedTeams.includes(teamId)
  ) {
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

function eliminateActiveTeam(state: ClassicGameState): ClassicGameState {
  const eliminatedTeam = state.activeTeam;
  const cards: Record<CardId, BoardCard> = Object.assign(
    Object.create(null),
    state.board.cards,
  );
  for (const [cardId, card] of Object.entries(cards)) {
    if (card.owner === eliminatedTeam && !card.revealed) {
      cards[cardId] = { ...card, owner: "neutral" };
    }
  }

  return {
    ...state,
    board: { ...state.board, cards },
    eliminatedTeams: state.eliminatedTeams.includes(eliminatedTeam)
      ? state.eliminatedTeams
      : [...state.eliminatedTeams, eliminatedTeam],
  };
}

function isConfiguredTeam(
  state: ClassicGameState,
  owner: Ownership,
): owner is TeamId {
  return (
    owner !== "neutral" &&
    owner !== "hazard" &&
    state.board.configuredTeams.includes(owner)
  );
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
): GameTransition {
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
  const event: GameTransitionEvent = {
    type: "card_revealed",
    cardId: action.cardId,
    owner: card.owner,
  };
  if (card.owner === "hazard") {
    if (state.board.teamCount === 2) {
      return {
        state: completeBoard(revealedState, nextActiveTeam(state), "hazard"),
        event,
      };
    }

    const eliminatedState = eliminateActiveTeam(revealedState);
    const remainingTeams = activeTeams(eliminatedState);
    return {
      state:
        remainingTeams.length === 1
          ? completeBoard(eliminatedState, remainingTeams[0]!, "hazard")
          : advanceTurn(eliminatedState),
      event: { ...event, eliminatedTeam: state.activeTeam },
    };
  }
  if (
    isConfiguredTeam(revealedState, card.owner) &&
    hasRevealedAllTargets(revealedState, card.owner)
  ) {
    return {
      state: completeBoard(revealedState, card.owner, "targets"),
      event,
    };
  }
  if (card.owner !== state.activeTeam || revealedState.guessesRemaining === 0) {
    return { state: advanceTurn(revealedState), event };
  }
  return { state: revealedState, event };
}

export function applyGameActionWithEvent(
  state: ClassicGameState,
  action: GameAction,
): GameTransition {
  if (state.phase === "board_complete") {
    throw new GameTransitionError("board_complete");
  }

  switch (action.type) {
    case "submit_clue":
      return { state: applySubmitClue(state, action), event: null };
    case "challenge_clue":
      requirePhase(state, "guess");
      requireOpposingTeam(state, action.teamId);
      return { state: { ...state, phase: "challenged" }, event: null };
    case "resolve_challenge":
      requirePhase(state, "challenged");
      return {
        state:
          action.decision === "accept"
            ? { ...state, phase: "guess" }
            : advanceTurn(state),
        event: null,
      };
    case "nominate_card": {
      requirePhase(state, "guess");
      requireActiveTeam(state, action.teamId);
      const card = requireCard(state, action.cardId);
      if (card.revealed) {
        throw new GameTransitionError("already_revealed");
      }
      return {
        state: {
          ...state,
          nomination: { playerId: action.playerId, cardId: action.cardId },
        },
        event: null,
      };
    }
    case "clear_nomination":
      requirePhase(state, "guess");
      requireActiveTeam(state, action.teamId);
      if (state.nomination === null) {
        throw new GameTransitionError("missing_nomination");
      }
      return { state: { ...state, nomination: null }, event: null };
    case "confirm_reveal":
      return applyConfirmReveal(state, action);
    case "end_turn":
      requirePhase(state, "guess");
      requireActiveTeam(state, action.teamId);
      return { state: advanceTurn(state), event: null };
    case "pause":
      if (
        state.phase !== "clue" &&
        state.phase !== "guess" &&
        state.phase !== "challenged"
      ) {
        throw new GameTransitionError("wrong_phase");
      }
      return {
        state: { ...state, phase: "paused", resumePhase: state.phase },
        event: null,
      };
    case "resume":
      requirePhase(state, "paused");
      if (state.resumePhase === null) {
        throw new GameTransitionError("wrong_phase");
      }
      return {
        state: { ...state, phase: state.resumePhase, resumePhase: null },
        event: null,
      };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function applyGameAction(
  state: ClassicGameState,
  action: GameAction,
): ClassicGameState {
  return applyGameActionWithEvent(state, action).state;
}
