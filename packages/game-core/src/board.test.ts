import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  countOwnership,
  createClassicBoard,
  type TeamId,
  type TextCard
} from "./index";

const cards: TextCard[] = Array.from({ length: 40 }, (_, index) => ({
  id: "card-" + index,
  label: "Word " + index
}));

describe("createClassicBoard", () => {
  it("creates the approved 9/8/7/1 distribution", () => {
    const board = createClassicBoard({
      cards,
      seed: "campaign-a/board-0",
      startingTeam: "red"
    });
    const counts = Object.values(board.cards).reduce<Record<string, number>>(
      (result, card) => {
        result[card.owner] = (result[card.owner] ?? 0) + 1;
        return result;
      },
      {}
    );
    expect(board.order).toHaveLength(25);
    expect(new Set(board.order).size).toBe(25);
    expect(counts).toEqual({ red: 9, blue: 8, neutral: 7, hazard: 1 });
  });

  it("returns the same board for the same seed", () => {
    expect(
      createClassicBoard({ cards, seed: "same", startingTeam: "blue" })
    ).toEqual(
      createClassicBoard({ cards, seed: "same", startingTeam: "blue" })
    );
  });

  it("does not mutate the source cards", () => {
    const before = structuredClone(cards);
    createClassicBoard({ cards, seed: "immutable", startingTeam: "red" });
    expect(cards).toEqual(before);
  });

  it("rejects fewer than 25 unique cards", () => {
    expect(() =>
      createClassicBoard({
        cards: cards.slice(0, 24),
        seed: "short",
        startingTeam: "red"
      })
    ).toThrow("Classic board requires at least 25 unique cards");
  });

  it("rejects duplicate card IDs", () => {
    const duplicates = [...cards.slice(0, 24), cards[0]!];
    expect(() =>
      createClassicBoard({
        cards: duplicates,
        seed: "dups",
        startingTeam: "red"
      })
    ).toThrow("Classic board requires at least 25 unique cards");
  });

  it("satisfies countOwnership helper", () => {
    const board = createClassicBoard({
      cards,
      seed: "counts",
      startingTeam: "blue"
    });
    const counts = countOwnership(board);
    expect(counts).toEqual({ red: 8, blue: 9, neutral: 7, hazard: 1 });
  });
});

describe("createClassicBoard property invariants", () => {
  it("satisfies all board invariants across arbitrary seeds and teams", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom<TeamId>("red", "blue"),
        (seed, startingTeam) => {
          const inputCards = cards.map((c) => ({ ...c }));
          const original = structuredClone(inputCards);
          const board = createClassicBoard({
            cards: inputCards,
            seed,
            startingTeam
          });

          // Invariant 1: No mutation of input
          expect(inputCards).toEqual(original);

          // Invariant 2: 25 unique card IDs in order
          expect(board.order).toHaveLength(25);
          expect(new Set(board.order).size).toBe(25);

          // Invariant 3: All cards in cards map have revealed: false
          const boardCards = Object.values(board.cards);
          expect(boardCards).toHaveLength(25);
          for (const card of boardCards) {
            expect(card.revealed).toBe(false);
            expect(board.order).toContain(card.id);
          }

          // Invariant 4: Exact 9/8/7/1 ownership distribution
          const otherTeam = startingTeam === "red" ? "blue" : "red";
          const counts = countOwnership(board);
          expect(counts[startingTeam]).toBe(9);
          expect(counts[otherTeam]).toBe(8);
          expect(counts.neutral).toBe(7);
          expect(counts.hazard).toBe(1);

          // Invariant 5: startingTeam on board matches input
          expect(board.startingTeam).toBe(startingTeam);
        }
      ),
      { numRuns: 100 }
    );
  });
});
