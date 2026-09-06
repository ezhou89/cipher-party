import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyGameAction,
  createClassicBoard,
  createClassicGame,
  GameTransitionError,
  otherTeam,
  type ClassicBoard,
  type ClassicGameState,
  type GameAction,
  type Ownership,
  type TextCard
} from "./index";

function fixedBoard(): ClassicBoard {
  const cards: ClassicBoard["cards"] = {};
  const order: string[] = [];

  const addCards = (prefix: string, count: number, owner: Ownership) => {
    for (let i = 1; i <= count; i += 1) {
      const id = `${prefix}-${i}`;
      order.push(id);
      cards[id] = {
        id,
        label: `Word ${id}`,
        owner,
        revealed: false
      };
    }
  };

  addCards("red", 9, "red");
  addCards("blue", 8, "blue");
  addCards("neutral", 7, "neutral");
  addCards("hazard", 1, "hazard");

  return {
    order,
    cards,
    startingTeam: "red"
  };
}

describe("Classic Game Reducer", () => {
  it("continues after revealing the active team's target", () => {
    const game = createClassicGame(fixedBoard());
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Cosmic",
      count: 2
    });
    const afterNomination = applyGameAction(afterClue, {
      type: "nominate_card",
      teamId: "red",
      playerId: "red-operative",
      cardId: "red-1"
    });
    const afterReveal = applyGameAction(afterNomination, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "red-operative",
      cardId: "red-1"
    });

    expect(afterReveal.phase).toBe("guess");
    expect(afterReveal.guessesRemaining).toBe(2);
    expect(afterReveal.board.cards["red-1"]?.revealed).toBe(true);
    expect(afterReveal.nomination).toBeNull();
  });

  it("advances turn to blue clue phase on neutral reveal", () => {
    const game = createClassicGame(fixedBoard());
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Space",
      count: 1
    });
    const afterNom = applyGameAction(afterClue, {
      type: "nominate_card",
      teamId: "red",
      playerId: "op1",
      cardId: "neutral-1"
    });
    const afterReveal = applyGameAction(afterNom, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "op1",
      cardId: "neutral-1"
    });

    expect(afterReveal.board.cards["neutral-1"]?.revealed).toBe(true);
    expect(afterReveal.phase).toBe("clue");
    expect(afterReveal.activeTeam).toBe("blue");
    expect(afterReveal.guessesRemaining).toBe(0);
    expect(afterReveal.clue).toBeNull();
  });

  it("reveals blue target when chosen by red and advances turn", () => {
    const game = createClassicGame(fixedBoard());
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Oops",
      count: 1
    });
    const afterNom = applyGameAction(afterClue, {
      type: "nominate_card",
      teamId: "red",
      playerId: "op1",
      cardId: "blue-1"
    });
    const afterReveal = applyGameAction(afterNom, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "op2", // different operative on same team can confirm
      cardId: "blue-1"
    });

    expect(afterReveal.board.cards["blue-1"]?.revealed).toBe(true);
    expect(afterReveal.phase).toBe("clue");
    expect(afterReveal.activeTeam).toBe("blue");
  });

  it("awards immediate win to blue if red reveals blue's final target", () => {
    const board = fixedBoard();
    // Pre-reveal 7 of blue's 8 targets
    for (let i = 1; i <= 7; i += 1) {
      board.cards[`blue-${i}`]!.revealed = true;
    }
    const game = createClassicGame(board);
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Blunder",
      count: 1
    });
    const afterNom = applyGameAction(afterClue, {
      type: "nominate_card",
      teamId: "red",
      playerId: "op1",
      cardId: "blue-8"
    });
    const afterReveal = applyGameAction(afterNom, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "op1",
      cardId: "blue-8"
    });

    expect(afterReveal.phase).toBe("board_complete");
    expect(afterReveal.winner).toBe("blue");
    expect(afterReveal.completionReason).toBe("targets");
  });

  it("awards immediate win to blue if red reveals hazard", () => {
    const game = createClassicGame(fixedBoard());
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Danger",
      count: 1
    });
    const afterNom = applyGameAction(afterClue, {
      type: "nominate_card",
      teamId: "red",
      playerId: "op1",
      cardId: "hazard-1"
    });
    const afterReveal = applyGameAction(afterNom, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "op1",
      cardId: "hazard-1"
    });

    expect(afterReveal.phase).toBe("board_complete");
    expect(afterReveal.winner).toBe("blue");
    expect(afterReveal.completionReason).toBe("hazard");
  });

  it("awards immediate win to red if red reveals red's final target", () => {
    const board = fixedBoard();
    // Pre-reveal 8 of red's 9 targets
    for (let i = 1; i <= 8; i += 1) {
      board.cards[`red-${i}`]!.revealed = true;
    }
    const game = createClassicGame(board);
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Victory",
      count: 1
    });
    const afterNom = applyGameAction(afterClue, {
      type: "nominate_card",
      teamId: "red",
      playerId: "op1",
      cardId: "red-9"
    });
    const afterReveal = applyGameAction(afterNom, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "op1",
      cardId: "red-9"
    });

    expect(afterReveal.phase).toBe("board_complete");
    expect(afterReveal.winner).toBe("red");
    expect(afterReveal.completionReason).toBe("targets");
  });

  it("ends turn cleanly without reveal when end_turn is called", () => {
    const game = createClassicGame(fixedBoard());
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Pass",
      count: 1
    });
    const afterEnd = applyGameAction(afterClue, {
      type: "end_turn",
      teamId: "red"
    });

    expect(afterEnd.phase).toBe("clue");
    expect(afterEnd.activeTeam).toBe("blue");
    expect(afterEnd.clue).toBeNull();
    expect(afterEnd.guessesRemaining).toBe(0);
  });

  it("sets guessesRemaining to clue count plus one", () => {
    const game = createClassicGame(fixedBoard());
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Double",
      count: 2
    });
    expect(afterClue.guessesRemaining).toBe(3);
  });

  it("advances turn when all allowed guesses are exhausted", () => {
    const game = createClassicGame(fixedBoard());
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Single",
      count: 1 // 2 total guesses
    });

    // Guess 1
    let state = applyGameAction(afterClue, {
      type: "nominate_card",
      teamId: "red",
      playerId: "op1",
      cardId: "red-1"
    });
    state = applyGameAction(state, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "op1",
      cardId: "red-1"
    });
    expect(state.phase).toBe("guess");
    expect(state.guessesRemaining).toBe(1);

    // Guess 2 (exhausted)
    state = applyGameAction(state, {
      type: "nominate_card",
      teamId: "red",
      playerId: "op1",
      cardId: "red-2"
    });
    state = applyGameAction(state, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "op1",
      cardId: "red-2"
    });

    expect(state.phase).toBe("clue");
    expect(state.activeTeam).toBe("blue");
    expect(state.guessesRemaining).toBe(0);
  });

  it("handles challenges: accept restores guess, reject advances the challenged team", () => {
    const game = createClassicGame(fixedBoard());
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Controversial",
      count: 2
    });

    const challenged = applyGameAction(afterClue, {
      type: "challenge_clue",
      teamId: "blue"
    });
    expect(challenged.phase).toBe("challenged");

    // Accept restores guess
    const accepted = applyGameAction(challenged, {
      type: "resolve_challenge",
      decision: "accept"
    });
    expect(accepted.phase).toBe("guess");
    expect(accepted.guessesRemaining).toBe(3);

    // Rechallenge and reject advances turn
    const challenged2 = applyGameAction(accepted, {
      type: "challenge_clue",
      teamId: "blue"
    });
    const rejected = applyGameAction(challenged2, {
      type: "resolve_challenge",
      decision: "reject"
    });
    expect(rejected.phase).toBe("clue");
    expect(rejected.activeTeam).toBe("blue");
  });

  it("supports pause and resume restoring the exact prior playable phase", () => {
    const game = createClassicGame(fixedBoard());
    const pausedFromClue = applyGameAction(game, { type: "pause" });
    expect(pausedFromClue.phase).toBe("paused");
    expect(pausedFromClue.resumePhase).toBe("clue");

    const resumedClue = applyGameAction(pausedFromClue, { type: "resume" });
    expect(resumedClue.phase).toBe("clue");

    const afterClue = applyGameAction(resumedClue, {
      type: "submit_clue",
      teamId: "red",
      word: "Test",
      count: 1
    });
    const pausedFromGuess = applyGameAction(afterClue, { type: "pause" });
    expect(pausedFromGuess.phase).toBe("paused");
    expect(pausedFromGuess.resumePhase).toBe("guess");

    const resumedGuess = applyGameAction(pausedFromGuess, { type: "resume" });
    expect(resumedGuess.phase).toBe("guess");
    expect(resumedGuess.guessesRemaining).toBe(2);
  });

  it("throws GameTransitionError with stable reasons for invalid actions", () => {
    const game = createClassicGame(fixedBoard());

    const expectTransitionError = (fn: () => unknown, reason: string) => {
      try {
        fn();
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(GameTransitionError);
        expect((error as GameTransitionError).reason).toBe(reason);
      }
    };

    // Wrong team submitting clue
    expectTransitionError(
      () =>
        applyGameAction(game, {
          type: "submit_clue",
          teamId: "blue",
          word: "Hi",
          count: 1
        }),
      "wrong_team"
    );

    // Count above remaining targets (9 available)
    expectTransitionError(
      () =>
        applyGameAction(game, {
          type: "submit_clue",
          teamId: "red",
          word: "TooMany",
          count: 10
        }),
      "invalid_count"
    );

    // Wrong phase for nomination
    expectTransitionError(
      () =>
        applyGameAction(game, {
          type: "nominate_card",
          teamId: "red",
          playerId: "p1",
          cardId: "red-1"
        }),
      "wrong_phase"
    );

    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Valid",
      count: 2
    });

    // Unknown card
    expectTransitionError(
      () =>
        applyGameAction(afterClue, {
          type: "nominate_card",
          teamId: "red",
          playerId: "p1",
          cardId: "nonexistent"
        }),
      "unknown_card"
    );

    // Confirm without nomination
    expectTransitionError(
      () =>
        applyGameAction(afterClue, {
          type: "confirm_reveal",
          teamId: "red",
          playerId: "p1",
          cardId: "red-1"
        }),
      "missing_nomination"
    );

    // Nomination mismatch
    const afterNom = applyGameAction(afterClue, {
      type: "nominate_card",
      teamId: "red",
      playerId: "p1",
      cardId: "red-1"
    });
    expectTransitionError(
      () =>
        applyGameAction(afterNom, {
          type: "confirm_reveal",
          teamId: "red",
          playerId: "p1",
          cardId: "red-2"
        }),
      "nomination_mismatch"
    );

    // Already revealed card nomination
    const afterReveal = applyGameAction(afterNom, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "p1",
      cardId: "red-1"
    });
    expectTransitionError(
      () =>
        applyGameAction(afterReveal, {
          type: "nominate_card",
          teamId: "red",
          playerId: "p1",
          cardId: "red-1"
        }),
      "already_revealed"
    );
  });

  it("satisfies all invariants across random legal action sequences", () => {
    const sampleCards: TextCard[] = Array.from({ length: 40 }, (_, i) => ({
      id: `card-${i + 1}`,
      label: `Word ${i + 1}`
    }));

    function deepFreeze<T>(obj: T): T {
      if (obj === null || typeof obj !== "object") {
        return obj;
      }
      Object.freeze(obj);
      for (const key of Object.keys(obj)) {
        deepFreeze((obj as Record<string, unknown>)[key]);
      }
      return obj;
    }

    function getLegalActions(state: ClassicGameState): GameAction[] {
      if (state.phase === "board_complete") {
        return [];
      }
      if (state.phase === "paused") {
        return [{ type: "resume" }];
      }
      if (state.phase === "clue") {
        const remainingTargets = Object.values(state.board.cards).filter(
          (c) => c.owner === state.activeTeam && !c.revealed
        ).length;
        const actions: GameAction[] = [{ type: "pause" }];
        for (let count = 1; count <= remainingTargets; count += 1) {
          actions.push({
            type: "submit_clue",
            teamId: state.activeTeam,
            word: `Clue-${count}`,
            count
          });
        }
        return actions;
      }
      if (state.phase === "challenged") {
        return [
          { type: "pause" },
          { type: "resolve_challenge", decision: "accept" },
          { type: "resolve_challenge", decision: "reject" }
        ];
      }
      if (state.phase === "guess") {
        const actions: GameAction[] = [
          { type: "pause" },
          { type: "end_turn", teamId: state.activeTeam },
          { type: "challenge_clue", teamId: otherTeam(state.activeTeam) }
        ];

        const unrevealedCards = Object.values(state.board.cards).filter(
          (c) => !c.revealed
        );
        for (const card of unrevealedCards) {
          actions.push({
            type: "nominate_card",
            teamId: state.activeTeam,
            playerId: "op1",
            cardId: card.id
          });
        }

        if (state.nomination !== null) {
          actions.push({
            type: "clear_nomination",
            teamId: state.activeTeam,
            playerId: "op1"
          });
          actions.push({
            type: "confirm_reveal",
            teamId: state.activeTeam,
            playerId: "op2",
            cardId: state.nomination.cardId
          });
        }

        return actions;
      }
      return [];
    }

    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom("red", "blue" as const),
        fc.array(fc.integer({ min: 0, max: 1000 }), {
          minLength: 1,
          maxLength: 60
        }),
        (seed, startingTeam, choices) => {
          const board = createClassicBoard({
            cards: sampleCards,
            seed,
            startingTeam
          });
          let state = createClassicGame(board);

          for (const choice of choices) {
            if (state.phase === "board_complete") {
              break;
            }
            const legal = getLegalActions(state);
            if (legal.length === 0) {
              break;
            }
            const action = legal[choice % legal.length]!;

            const beforeJson = JSON.stringify(state);
            deepFreeze(state);

            const nextState = applyGameAction(state, action);

            // Invariant 1: No revealed card becomes unrevealed
            for (const card of Object.values(state.board.cards)) {
              if (card.revealed) {
                expect(nextState.board.cards[card.id]?.revealed).toBe(true);
              }
            }

            // Invariant 2: guessesRemaining never drops below 0
            expect(nextState.guessesRemaining).toBeGreaterThanOrEqual(0);

            // Invariant 3: board_complete always has non-null winner and completionReason
            if (nextState.phase === "board_complete") {
              expect(nextState.winner).not.toBeNull();
              expect(["red", "blue"]).toContain(nextState.winner);
              expect(["targets", "hazard"]).toContain(
                nextState.completionReason
              );
            }

            // Invariant 4: Non-complete states have null winner and completionReason
            if (nextState.phase !== "board_complete") {
              expect(nextState.winner).toBeNull();
              expect(nextState.completionReason).toBeNull();
            }

            // Invariant 5: The input state remains unchanged after every action
            expect(JSON.stringify(state)).toBe(beforeJson);

            state = nextState;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
