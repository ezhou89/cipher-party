import type { ClassicBoard } from "./board";
import type { CardId, PlayerId, PlayPhase, TeamId } from "./domain";

export type { PlayPhase };

export interface ClassicGameState {
  board: ClassicBoard;
  phase: PlayPhase;
  resumePhase: Exclude<PlayPhase, "paused" | "board_complete"> | null;
  activeTeam: TeamId;
  clue: { word: string; count: number } | null;
  guessesRemaining: number;
  nomination: { playerId: PlayerId; cardId: CardId } | null;
  winner: TeamId | null;
  completionReason: "targets" | "hazard" | null;
}

export type GameAction =
  | { type: "submit_clue"; teamId: TeamId; word: string; count: number }
  | { type: "challenge_clue"; teamId: TeamId }
  | { type: "resolve_challenge"; decision: "accept" | "reject" }
  | {
      type: "nominate_card";
      teamId: TeamId;
      playerId: PlayerId;
      cardId: CardId;
    }
  | { type: "clear_nomination"; teamId: TeamId; playerId: PlayerId }
  | {
      type: "confirm_reveal";
      teamId: TeamId;
      playerId: PlayerId;
      cardId: CardId;
    }
  | { type: "end_turn"; teamId: TeamId }
  | { type: "pause" }
  | { type: "resume" };

export type GameTransitionReason =
  | "wrong_phase"
  | "wrong_team"
  | "invalid_count"
  | "unknown_card"
  | "missing_nomination"
  | "nomination_mismatch"
  | "already_revealed"
  | "board_complete";

export class GameTransitionError extends Error {
  readonly reason: GameTransitionReason;

  constructor(reason: GameTransitionReason, message?: string) {
    super(message ?? `Invalid game action: ${reason}`);
    this.name = "GameTransitionError";
    this.reason = reason;
  }
}

export function otherTeam(teamId: TeamId): TeamId {
  return teamId === "red" ? "blue" : "red";
}

export function advanceTurn(state: ClassicGameState): ClassicGameState {
  return {
    ...state,
    phase: "clue",
    resumePhase: null,
    activeTeam: otherTeam(state.activeTeam),
    clue: null,
    guessesRemaining: 0,
    nomination: null
  };
}

export function hasRevealedAllTargets(
  state: ClassicGameState,
  teamId: TeamId
): boolean {
  return Object.values(state.board.cards)
    .filter((card) => card.owner === teamId)
    .every((card) => card.revealed);
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
    completionReason: null
  };
}

export function applyGameAction(
  state: ClassicGameState,
  action: GameAction
): ClassicGameState {
  if (state.phase === "board_complete") {
    throw new GameTransitionError(
      "board_complete",
      "Cannot apply actions to a completed game board"
    );
  }

  switch (action.type) {
    case "submit_clue": {
      if (state.phase !== "clue") {
        throw new GameTransitionError(
          "wrong_phase",
          "Clues can only be submitted during clue phase"
        );
      }
      if (action.teamId !== state.activeTeam) {
        throw new GameTransitionError(
          "wrong_team",
          "Only the active team clue-giver can submit a clue"
        );
      }
      const remainingTargets = Object.values(state.board.cards).filter(
        (card) => card.owner === state.activeTeam && !card.revealed
      ).length;
      if (action.count < 1 || action.count > remainingTargets) {
        throw new GameTransitionError(
          "invalid_count",
          `Clue count must be between 1 and ${remainingTargets}`
        );
      }
      return {
        ...state,
        phase: "guess",
        clue: { word: action.word, count: action.count },
        guessesRemaining: action.count + 1,
        nomination: null
      };
    }

    case "challenge_clue": {
      if (state.phase !== "guess") {
        throw new GameTransitionError(
          "wrong_phase",
          "Clues can only be challenged during guess phase"
        );
      }
      if (action.teamId !== otherTeam(state.activeTeam)) {
        throw new GameTransitionError(
          "wrong_team",
          "Only opposing team can challenge a clue"
        );
      }
      return {
        ...state,
        phase: "challenged"
      };
    }

    case "resolve_challenge": {
      if (state.phase !== "challenged") {
        throw new GameTransitionError(
          "wrong_phase",
          "Can only resolve challenge during challenged phase"
        );
      }
      if (action.decision === "accept") {
        return {
          ...state,
          phase: "guess"
        };
      }
      return advanceTurn(state);
    }

    case "nominate_card": {
      if (state.phase !== "guess") {
        throw new GameTransitionError(
          "wrong_phase",
          "Can only nominate cards during guess phase"
        );
      }
      if (action.teamId !== state.activeTeam) {
        throw new GameTransitionError(
          "wrong_team",
          "Only active team operatives can nominate cards"
        );
      }
      const card = state.board.cards[action.cardId];
      if (!card) {
        throw new GameTransitionError("unknown_card", "Card does not exist");
      }
      if (card.revealed) {
        throw new GameTransitionError(
          "already_revealed",
          "Card has already been revealed"
        );
      }
      return {
        ...state,
        nomination: {
          playerId: action.playerId,
          cardId: action.cardId
        }
      };
    }

    case "clear_nomination": {
      if (state.phase !== "guess") {
        throw new GameTransitionError(
          "wrong_phase",
          "Can only clear nomination during guess phase"
        );
      }
      if (action.teamId !== state.activeTeam) {
        throw new GameTransitionError(
          "wrong_team",
          "Only active team can clear nomination"
        );
      }
      if (!state.nomination) {
        throw new GameTransitionError(
          "missing_nomination",
          "No active nomination to clear"
        );
      }
      return {
        ...state,
        nomination: null
      };
    }

    case "confirm_reveal": {
      if (state.phase !== "guess") {
        throw new GameTransitionError(
          "wrong_phase",
          "Can only confirm reveal during guess phase"
        );
      }
      if (action.teamId !== state.activeTeam) {
        throw new GameTransitionError(
          "wrong_team",
          "Only active team can confirm reveal"
        );
      }
      const card = state.board.cards[action.cardId];
      if (!card) {
        throw new GameTransitionError("unknown_card", "Card does not exist");
      }
      if (card.revealed) {
        throw new GameTransitionError(
          "already_revealed",
          "Card has already been revealed"
        );
      }
      if (!state.nomination) {
        throw new GameTransitionError(
          "missing_nomination",
          "No nomination exists to confirm"
        );
      }
      if (state.nomination.cardId !== action.cardId) {
        throw new GameTransitionError(
          "nomination_mismatch",
          "Confirmed card does not match nomination"
        );
      }

      const updatedCard = { ...card, revealed: true };
      const nextBoard: ClassicBoard = {
        ...state.board,
        cards: {
          ...state.board.cards,
          [action.cardId]: updatedCard
        }
      };

      const nextState: ClassicGameState = {
        ...state,
        board: nextBoard,
        nomination: null,
        guessesRemaining: state.guessesRemaining - 1
      };

      // 1. Hazard reveal
      if (card.owner === "hazard") {
        return {
          ...nextState,
          phase: "board_complete",
          winner: otherTeam(state.activeTeam),
          completionReason: "hazard"
        };
      }

      // 2. Active team target reveal
      if (card.owner === state.activeTeam) {
        if (hasRevealedAllTargets(nextState, state.activeTeam)) {
          return {
            ...nextState,
            phase: "board_complete",
            winner: state.activeTeam,
            completionReason: "targets"
          };
        }
        if (nextState.guessesRemaining <= 0) {
          return advanceTurn(nextState);
        }
        return nextState;
      }

      // 3. Opponent target reveal
      if (card.owner === otherTeam(state.activeTeam)) {
        if (hasRevealedAllTargets(nextState, otherTeam(state.activeTeam))) {
          return {
            ...nextState,
            phase: "board_complete",
            winner: otherTeam(state.activeTeam),
            completionReason: "targets"
          };
        }
        return advanceTurn(nextState);
      }

      // 4. Neutral reveal
      return advanceTurn(nextState);
    }

    case "end_turn": {
      if (state.phase !== "guess") {
        throw new GameTransitionError(
          "wrong_phase",
          "Can only end turn during guess phase"
        );
      }
      if (action.teamId !== state.activeTeam) {
        throw new GameTransitionError(
          "wrong_team",
          "Only active team can end turn"
        );
      }
      return advanceTurn(state);
    }

    case "pause": {
      if (state.phase === "paused") {
        throw new GameTransitionError(
          "wrong_phase",
          "Cannot pause when already paused"
        );
      }
      return {
        ...state,
        phase: "paused",
        resumePhase: state.phase
      };
    }

    case "resume": {
      if (state.phase !== "paused") {
        throw new GameTransitionError(
          "wrong_phase",
          "Can only resume when paused"
        );
      }
      return {
        ...state,
        phase: state.resumePhase ?? "clue",
        resumePhase: null
      };
    }

    default: {
      const _exhaustiveCheck: never = action;
      throw new Error(`Unhandled action: ${JSON.stringify(_exhaustiveCheck)}`);
    }
  }
}
