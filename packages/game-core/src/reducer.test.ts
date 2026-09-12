import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyGameAction,
  createClassicGame,
  GameTransitionError,
  type BoardCard,
  type CardId,
  type ClassicBoard,
  type ClassicGameState,
  type GameAction,
  type TeamId,
} from "./index";

function fixedBoard(): ClassicBoard {
  const cards: Record<CardId, BoardCard> = Object.create(null);
  const fixtures: BoardCard[] = [
    { id: "red-1", label: "Red One", owner: "red", revealed: false },
    { id: "red-2", label: "Red Two", owner: "red", revealed: false },
    { id: "blue-1", label: "Blue One", owner: "blue", revealed: false },
    { id: "blue-2", label: "Blue Two", owner: "blue", revealed: false },
    {
      id: "neutral-1",
      label: "Neutral One",
      owner: "neutral",
      revealed: false,
    },
    {
      id: "hazard-1",
      label: "Hazard One",
      owner: "hazard",
      revealed: false,
    },
    {
      id: "__proto__",
      label: "Prototype",
      owner: "red",
      revealed: false,
    },
  ];

  for (const card of fixtures) {
    cards[card.id] = card;
  }

  return {
    teamCount: 2,
    configuredTeams: ["red", "blue"],
    rows: 5,
    columns: 5,
    order: fixtures.map((card) => card.id),
    cards,
    startingTeam: "red",
  };
}

function withRevealed(board: ClassicBoard, ...cardIds: CardId[]): ClassicBoard {
  const cards: Record<CardId, BoardCard> = Object.assign(
    Object.create(null),
    board.cards,
  );
  for (const cardId of cardIds) {
    cards[cardId] = { ...cards[cardId]!, revealed: true };
  }
  return { ...board, cards };
}

function guessingState(
  board: ClassicBoard = fixedBoard(),
  count = 2,
): ClassicGameState {
  return applyGameAction(createClassicGame(board), {
    type: "submit_clue",
    teamId: "red",
    word: "Cosmic",
    count,
  });
}

function reveal(
  state: ClassicGameState,
  cardId: CardId,
  confirmer = "red-confirmer",
): ClassicGameState {
  const nominated = applyGameAction(state, {
    type: "nominate_card",
    teamId: state.activeTeam,
    playerId: "red-nominator",
    cardId,
  });
  return applyGameAction(nominated, {
    type: "confirm_reveal",
    teamId: state.activeTeam,
    playerId: confirmer,
    cardId,
  });
}

function snapshotState(state: ClassicGameState): ClassicGameState {
  const cards: Record<CardId, BoardCard> = Object.create(null);
  for (const [cardId, card] of Object.entries(state.board.cards)) {
    cards[cardId] = { ...card };
  }
  return {
    ...state,
    board: { ...state.board, order: [...state.board.order], cards },
    clue: state.clue === null ? null : { ...state.clue },
    nomination: state.nomination === null ? null : { ...state.nomination },
  };
}

function expectTransitionError(
  state: ClassicGameState,
  action: GameAction,
  reason: GameTransitionError["reason"],
): void {
  const stateBefore = snapshotState(state);
  const actionBefore: GameAction = { ...action };

  try {
    applyGameAction(state, action);
    throw new Error("Expected applyGameAction to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(GameTransitionError);
    expect(error).toMatchObject({ reason });
  }

  expect(state).toEqual(stateBefore);
  expect(action).toEqual(actionBefore);
}

describe("Classic game reducer", () => {
  it("creates the initial clue state from the board's starting team", () => {
    const board = { ...fixedBoard(), startingTeam: "blue" as const };

    expect(createClassicGame(board)).toEqual({
      board,
      phase: "clue",
      resumePhase: null,
      activeTeam: "blue",
      clue: null,
      guessesRemaining: 0,
      nomination: null,
      winner: null,
      completionReason: null,
    });
  });

  it("continues after revealing the active team's target", () => {
    const game = createClassicGame(fixedBoard());
    const afterClue = applyGameAction(game, {
      type: "submit_clue",
      teamId: "red",
      word: "Cosmic",
      count: 2,
    });
    const afterNomination = applyGameAction(afterClue, {
      type: "nominate_card",
      teamId: "red",
      playerId: "red-operative",
      cardId: "red-1",
    });
    const afterReveal = applyGameAction(afterNomination, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "another-red-operative",
      cardId: "red-1",
    });

    expect(afterReveal.phase).toBe("guess");
    expect(afterReveal.guessesRemaining).toBe(2);
    expect(afterReveal.board.cards["red-1"]?.revealed).toBe(true);
    expect(afterReveal.nomination).toBeNull();
  });

  it("grants the clue count plus one guesses", () => {
    const state = guessingState();

    expect(state.clue).toEqual({ word: "Cosmic", count: 2 });
    expect(state.guessesRemaining).toBe(3);
  });

  it.each([
    { cardId: "neutral-1", owner: "neutral" },
    { cardId: "blue-1", owner: "blue" },
  ])("reveals an $owner card and advances the turn", ({ cardId }) => {
    const state = reveal(guessingState(), cardId);

    expect(state.board.cards[cardId]?.revealed).toBe(true);
    expect(state).toMatchObject({
      phase: "clue",
      activeTeam: "blue",
      clue: null,
      guessesRemaining: 0,
      nomination: null,
      winner: null,
      completionReason: null,
    });
  });

  it("awards blue the board when red reveals blue's final target", () => {
    const board = withRevealed(fixedBoard(), "blue-1");
    const state = reveal(guessingState(board), "blue-2");

    expect(state.board.cards["blue-2"]?.revealed).toBe(true);
    expect(state).toMatchObject({
      phase: "board_complete",
      winner: "blue",
      completionReason: "targets",
      nomination: null,
    });
  });

  it("awards blue the board when red reveals the hazard", () => {
    const state = reveal(guessingState(), "hazard-1");

    expect(state.board.cards["hazard-1"]?.revealed).toBe(true);
    expect(state).toMatchObject({
      phase: "board_complete",
      winner: "blue",
      completionReason: "hazard",
      nomination: null,
    });
  });

  it("awards red the board when red reveals its final target", () => {
    const board = withRevealed(fixedBoard(), "red-1", "red-2");
    const state = reveal(guessingState(board, 1), "__proto__");

    expect(Object.hasOwn(state.board.cards, "__proto__")).toBe(true);
    expect(state.board.cards["__proto__"]?.revealed).toBe(true);
    expect(state).toMatchObject({
      phase: "board_complete",
      winner: "red",
      completionReason: "targets",
      nomination: null,
    });
  });

  it("advances when the active team ends its turn", () => {
    const state = applyGameAction(guessingState(), {
      type: "end_turn",
      teamId: "red",
    });

    expect(state).toMatchObject({
      phase: "clue",
      activeTeam: "blue",
      clue: null,
      guessesRemaining: 0,
      nomination: null,
    });
  });

  it("advances after the final allowed correct guess", () => {
    const firstReveal = reveal(guessingState(fixedBoard(), 1), "red-1");
    const state = reveal(firstReveal, "red-2");

    expect(state.board.cards["red-2"]?.revealed).toBe(true);
    expect(state).toMatchObject({
      phase: "clue",
      activeTeam: "blue",
      guessesRemaining: 0,
      winner: null,
    });
  });

  it("keeps one shared nomination and lets the active team clear it", () => {
    const guessed = guessingState();
    const first = applyGameAction(guessed, {
      type: "nominate_card",
      teamId: "red",
      playerId: "operative-one",
      cardId: "red-1",
    });
    const replaced = applyGameAction(first, {
      type: "nominate_card",
      teamId: "red",
      playerId: "operative-two",
      cardId: "blue-1",
    });
    const cleared = applyGameAction(replaced, {
      type: "clear_nomination",
      teamId: "red",
      playerId: "operative-three",
    });

    expect(first.nomination).toEqual({
      playerId: "operative-one",
      cardId: "red-1",
    });
    expect(replaced.nomination).toEqual({
      playerId: "operative-two",
      cardId: "blue-1",
    });
    expect(cleared.nomination).toBeNull();
  });

  it("preserves clue and guesses through an accepted challenge", () => {
    const guessed = guessingState();
    const challenged = applyGameAction(guessed, {
      type: "challenge_clue",
      teamId: "blue",
    });
    const accepted = applyGameAction(challenged, {
      type: "resolve_challenge",
      decision: "accept",
    });

    expect(challenged).toMatchObject({
      phase: "challenged",
      clue: { word: "Cosmic", count: 2 },
      guessesRemaining: 3,
      activeTeam: "red",
    });
    expect(accepted).toMatchObject({
      phase: "guess",
      clue: { word: "Cosmic", count: 2 },
      guessesRemaining: 3,
      activeTeam: "red",
    });
  });

  it("advances the challenged team after a rejected challenge", () => {
    const challenged = applyGameAction(guessingState(), {
      type: "challenge_clue",
      teamId: "blue",
    });
    const rejected = applyGameAction(challenged, {
      type: "resolve_challenge",
      decision: "reject",
    });

    expect(rejected).toMatchObject({
      phase: "clue",
      activeTeam: "blue",
      clue: null,
      guessesRemaining: 0,
    });
  });

  it.each(["clue", "guess", "challenged"] as const)(
    "pauses and resumes the exact %s phase",
    (phase) => {
      let state = createClassicGame(fixedBoard());
      if (phase !== "clue") {
        state = guessingState();
      }
      if (phase === "challenged") {
        state = applyGameAction(state, {
          type: "challenge_clue",
          teamId: "blue",
        });
      }

      const paused = applyGameAction(state, { type: "pause" });
      const resumed = applyGameAction(paused, { type: "resume" });

      expect(paused.phase).toBe("paused");
      expect(paused.resumePhase).toBe(phase);
      expect(resumed.phase).toBe(phase);
      expect(resumed.resumePhase).toBeNull();
      expect(resumed.clue).toEqual(state.clue);
      expect(resumed.guessesRemaining).toBe(state.guessesRemaining);
      expect(resumed.nomination).toEqual(state.nomination);
    },
  );

  it.each(["accept", "reject"] as const)(
    "can %s a challenge after pausing and resuming it",
    (decision) => {
      const challenged = applyGameAction(guessingState(), {
        type: "challenge_clue",
        teamId: "blue",
      });
      const paused = applyGameAction(challenged, { type: "pause" });
      const resumed = applyGameAction(paused, { type: "resume" });
      const resolved = applyGameAction(resumed, {
        type: "resolve_challenge",
        decision,
      });

      expect(resolved.phase).toBe(decision === "accept" ? "guess" : "clue");
      expect(resolved.activeTeam).toBe(decision === "accept" ? "red" : "blue");
    },
  );

  it("clones only changed board layers and the revealed card", () => {
    const guessed = guessingState();
    const nominated = applyGameAction(guessed, {
      type: "nominate_card",
      teamId: "red",
      playerId: "red-operative",
      cardId: "red-1",
    });
    const before = snapshotState(nominated);
    const revealed = applyGameAction(nominated, {
      type: "confirm_reveal",
      teamId: "red",
      playerId: "another-red-operative",
      cardId: "red-1",
    });

    expect(nominated).toEqual(before);
    expect(revealed).not.toBe(nominated);
    expect(revealed.board).not.toBe(nominated.board);
    expect(revealed.board.cards).not.toBe(nominated.board.cards);
    expect(revealed.board.cards["red-1"]).not.toBe(
      nominated.board.cards["red-1"],
    );
    expect(revealed.board.cards["blue-1"]).toBe(
      nominated.board.cards["blue-1"],
    );
    expect(revealed.board.order).toBe(nominated.board.order);
  });

  describe("invalid transitions", () => {
    it("prioritizes wrong_phase for a compound-invalid clue", () => {
      expectTransitionError(
        guessingState(),
        { type: "submit_clue", teamId: "blue", word: "Invalid", count: -1 },
        "wrong_phase",
      );
    });
    it("prioritizes already_revealed over a missing nomination", () => {
      expectTransitionError(
        guessingState(withRevealed(fixedBoard(), "red-1")),
        {
          type: "confirm_reveal",
          teamId: "red",
          playerId: "red-op",
          cardId: "red-1",
        },
        "already_revealed",
      );
    });
    it("prioritizes wrong_team over an unknown reveal card", () => {
      expectTransitionError(
        guessingState(),
        {
          type: "confirm_reveal",
          teamId: "blue",
          playerId: "blue-op",
          cardId: "unknown",
        },
        "wrong_team",
      );
    });
    const wrongPhaseCases: Array<{
      name: string;
      state: () => ClassicGameState;
      action: GameAction;
    }> = [
      {
        name: "submit clue",
        state: guessingState,
        action: { type: "submit_clue", teamId: "red", word: "Late", count: 1 },
      },
      {
        name: "challenge clue",
        state: () => createClassicGame(fixedBoard()),
        action: { type: "challenge_clue", teamId: "blue" },
      },
      {
        name: "nominate card",
        state: () => createClassicGame(fixedBoard()),
        action: {
          type: "nominate_card",
          teamId: "red",
          playerId: "operative",
          cardId: "red-1",
        },
      },
      {
        name: "clear nomination",
        state: () => createClassicGame(fixedBoard()),
        action: {
          type: "clear_nomination",
          teamId: "red",
          playerId: "operative",
        },
      },
      {
        name: "confirm reveal",
        state: () => createClassicGame(fixedBoard()),
        action: {
          type: "confirm_reveal",
          teamId: "red",
          playerId: "operative",
          cardId: "red-1",
        },
      },
      {
        name: "end turn",
        state: () => createClassicGame(fixedBoard()),
        action: { type: "end_turn", teamId: "red" },
      },
      {
        name: "resolve challenge",
        state: guessingState,
        action: { type: "resolve_challenge", decision: "accept" },
      },
      {
        name: "resume",
        state: () => createClassicGame(fixedBoard()),
        action: { type: "resume" },
      },
      {
        name: "pause twice",
        state: () =>
          applyGameAction(createClassicGame(fixedBoard()), { type: "pause" }),
        action: { type: "pause" },
      },
    ];

    it.each(wrongPhaseCases)(
      "rejects $name in the wrong phase",
      ({ state, action }) => {
        expectTransitionError(state(), action, "wrong_phase");
      },
    );

    const wrongTeamCases: Array<{
      name: string;
      state: () => ClassicGameState;
      action: GameAction;
    }> = [
      {
        name: "submit clue",
        state: () => createClassicGame(fixedBoard()),
        action: {
          type: "submit_clue",
          teamId: "blue",
          word: "Wrong",
          count: 1,
        },
      },
      {
        name: "challenge clue",
        state: guessingState,
        action: { type: "challenge_clue", teamId: "red" },
      },
      {
        name: "nominate card",
        state: guessingState,
        action: {
          type: "nominate_card",
          teamId: "blue",
          playerId: "operative",
          cardId: "red-1",
        },
      },
      {
        name: "clear nomination",
        state: guessingState,
        action: {
          type: "clear_nomination",
          teamId: "blue",
          playerId: "operative",
        },
      },
      {
        name: "confirm reveal",
        state: guessingState,
        action: {
          type: "confirm_reveal",
          teamId: "blue",
          playerId: "operative",
          cardId: "red-1",
        },
      },
      {
        name: "end turn",
        state: guessingState,
        action: { type: "end_turn", teamId: "blue" },
      },
    ];

    it.each(wrongTeamCases)(
      "rejects the wrong team for $name",
      ({ state, action }) => {
        expectTransitionError(state(), action, "wrong_team");
      },
    );

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects invalid clue count %s",
      (count) => {
        expectTransitionError(
          createClassicGame(fixedBoard()),
          { type: "submit_clue", teamId: "red", word: "Count", count },
          "invalid_count",
        );
      },
    );

    it("rejects a clue count above the active team's unrevealed targets", () => {
      expectTransitionError(
        createClassicGame(withRevealed(fixedBoard(), "red-1", "red-2")),
        { type: "submit_clue", teamId: "red", word: "Count", count: 2 },
        "invalid_count",
      );
    });

    it("rejects unknown nomination and confirmation card IDs", () => {
      const guessed = guessingState();
      expectTransitionError(
        guessed,
        {
          type: "nominate_card",
          teamId: "red",
          playerId: "operative",
          cardId: "toString",
        },
        "unknown_card",
      );

      const nominated = applyGameAction(guessed, {
        type: "nominate_card",
        teamId: "red",
        playerId: "operative",
        cardId: "red-1",
      });
      expectTransitionError(
        nominated,
        {
          type: "confirm_reveal",
          teamId: "red",
          playerId: "operative",
          cardId: "toString",
        },
        "unknown_card",
      );
    });

    it("rejects clearing or confirming without a nomination", () => {
      const guessed = guessingState();
      expectTransitionError(
        guessed,
        {
          type: "clear_nomination",
          teamId: "red",
          playerId: "operative",
        },
        "missing_nomination",
      );
      expectTransitionError(
        guessed,
        {
          type: "confirm_reveal",
          teamId: "red",
          playerId: "operative",
          cardId: "red-1",
        },
        "missing_nomination",
      );
    });

    it("rejects a confirmation that does not match the nominated card", () => {
      const nominated = applyGameAction(guessingState(), {
        type: "nominate_card",
        teamId: "red",
        playerId: "operative",
        cardId: "red-1",
      });

      expectTransitionError(
        nominated,
        {
          type: "confirm_reveal",
          teamId: "red",
          playerId: "another-operative",
          cardId: "red-2",
        },
        "nomination_mismatch",
      );
    });

    it("rejects nominating or confirming an already-revealed card", () => {
      const guessed = guessingState(withRevealed(fixedBoard(), "red-1"));
      expectTransitionError(
        guessed,
        {
          type: "nominate_card",
          teamId: "red",
          playerId: "operative",
          cardId: "red-1",
        },
        "already_revealed",
      );

      const staleNomination: ClassicGameState = {
        ...guessed,
        nomination: { playerId: "operative", cardId: "red-1" },
      };
      expectTransitionError(
        staleNomination,
        {
          type: "confirm_reveal",
          teamId: "red",
          playerId: "another-operative",
          cardId: "red-1",
        },
        "already_revealed",
      );
    });

    it.each<GameAction>([
      { type: "submit_clue", teamId: "red", word: "Done", count: 1 },
      { type: "challenge_clue", teamId: "blue" },
      { type: "resolve_challenge", decision: "accept" },
      {
        type: "nominate_card",
        teamId: "red",
        playerId: "operative",
        cardId: "red-1",
      },
      {
        type: "clear_nomination",
        teamId: "red",
        playerId: "operative",
      },
      {
        type: "confirm_reveal",
        teamId: "red",
        playerId: "operative",
        cardId: "red-1",
      },
      { type: "end_turn", teamId: "red" },
      { type: "pause" },
      { type: "resume" },
    ])("rejects $type against a complete board", (action) => {
      const complete = reveal(guessingState(), "hazard-1");
      expectTransitionError(complete, action, "board_complete");
    });
  });

  it("preserves reducer invariants across generated legal action sequences", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 80 }),
        (selectors) => {
          let state = createClassicGame(fixedBoard());

          for (const selector of selectors) {
            if (state.phase === "board_complete") {
              break;
            }

            const action = legalAction(state, selector);
            const stateBefore = snapshotState(state);
            const actionBefore: GameAction = { ...action };
            const next = applyGameAction(state, action);

            expect(state).toEqual(stateBefore);
            expect(action).toEqual(actionBefore);
            for (const cardId of state.board.order) {
              if (state.board.cards[cardId]?.revealed) {
                expect(next.board.cards[cardId]?.revealed).toBe(true);
              }
            }
            expect(next.guessesRemaining).toBeGreaterThanOrEqual(0);
            if (next.phase === "board_complete") {
              expect(next.winner).not.toBeNull();
              expect(next.completionReason).not.toBeNull();
            } else {
              expect(next.winner).toBeNull();
              expect(next.completionReason).toBeNull();
            }

            state = next;
          }
        },
      ),
      { numRuns: 100, seed: 20_260_830 },
    );
  });
});

function legalAction(state: ClassicGameState, selector: number): GameAction {
  switch (state.phase) {
    case "clue":
      return selector % 4 === 0
        ? { type: "pause" }
        : {
            type: "submit_clue",
            teamId: state.activeTeam,
            word: "Legal",
            count: 1,
          };
    case "guess": {
      const unrevealedCardId = state.board.order.find(
        (cardId) => !state.board.cards[cardId]?.revealed,
      )!;
      const choices: GameAction[] = [
        { type: "challenge_clue", teamId: otherTeam(state.activeTeam) },
        {
          type: "nominate_card",
          teamId: state.activeTeam,
          playerId: "operative-a",
          cardId: unrevealedCardId,
        },
        { type: "end_turn", teamId: state.activeTeam },
        { type: "pause" },
      ];
      if (state.nomination) {
        choices.push(
          {
            type: "clear_nomination",
            teamId: state.activeTeam,
            playerId: "operative-b",
          },
          {
            type: "confirm_reveal",
            teamId: state.activeTeam,
            playerId: "operative-b",
            cardId: state.nomination.cardId,
          },
        );
      }
      return choices[selector % choices.length]!;
    }
    case "challenged":
      if (selector % 3 === 0) {
        return { type: "pause" };
      }
      return {
        type: "resolve_challenge",
        decision: selector % 2 === 0 ? "accept" : "reject",
      };
    case "paused":
      return { type: "resume" };
    case "board_complete":
      throw new Error("A complete board has no legal actions");
    default: {
      const exhaustive: never = state.phase;
      return exhaustive;
    }
  }
}

function otherTeam(teamId: TeamId): TeamId {
  return teamId === "red" ? "blue" : "red";
}
