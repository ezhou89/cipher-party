import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  countOwnership,
  createClassicBoard,
  type TeamId,
  type TextCard,
} from "./index";

const cards: TextCard[] = Array.from({ length: 40 }, (_, index) => ({
  id: `card-${index}`,
  label: `Word ${index}`,
}));

function otherTeam(teamId: TeamId): TeamId {
  return teamId === "red" ? "blue" : "red";
}

describe("createClassicBoard", () => {
  it("creates the approved 9/8/7/1 distribution for a red starter", () => {
    const board = createClassicBoard({
      cards,
      seed: "campaign-a/board-0",
      startingTeam: "red",
    });

    expect(board.order).toHaveLength(25);
    expect(new Set(board.order).size).toBe(25);
    expect(countOwnership(board)).toEqual({
      red: 9,
      blue: 8,
      neutral: 7,
      hazard: 1,
    });
    expect(Object.values(board.cards)).toEqual(
      expect.arrayContaining([expect.objectContaining({ revealed: false })]),
    );
    expect(Object.values(board.cards).every((card) => !card.revealed)).toBe(
      true,
    );
  });

  it("gives blue the ninth target when blue starts", () => {
    const board = createClassicBoard({
      cards,
      seed: "campaign-a/board-1",
      startingTeam: "blue",
    });

    expect(countOwnership(board)).toEqual({
      red: 8,
      blue: 9,
      neutral: 7,
      hazard: 1,
    });
  });

  it("returns the same board for the same seed", () => {
    expect(
      createClassicBoard({ cards, seed: "same", startingTeam: "blue" }),
    ).toEqual(
      createClassicBoard({ cards, seed: "same", startingTeam: "blue" }),
    );
  });

  it("replays card membership, grid order, and ownership from independent streams", () => {
    const board = createClassicBoard({
      cards,
      seed: "independent-streams",
      startingTeam: "red",
    });
    // Fixed vectors for /cards, then /grid-order, and the existing /ownership
    // stream. Reusing one stream or arranging the whole pool before selection
    // must not change either the selected membership or its spatial order.
    const selected = [
      31, 11, 4, 33, 13, 36, 18, 25, 21, 28, 14, 10, 39, 22, 12, 38, 24, 0, 9,
      34, 17, 7, 6, 2, 16,
    ].map((index) => `card-${index}`);
    const ordered = [
      33, 4, 25, 34, 2, 0, 11, 31, 17, 16, 10, 7, 18, 14, 28, 22, 6, 24, 12, 38,
      21, 39, 9, 36, 13,
    ].map((index) => `card-${index}`);

    expect([...board.order].sort()).toEqual([...selected].sort());
    expect(board.order).toEqual(ordered);
    expect(board.order).not.toEqual(selected);
    expect(board.order.map((id) => board.cards[id]?.owner)).toEqual([
      "blue",
      "blue",
      "red",
      "blue",
      "red",
      "blue",
      "hazard",
      "neutral",
      "red",
      "red",
      "blue",
      "blue",
      "blue",
      "neutral",
      "red",
      "red",
      "red",
      "neutral",
      "neutral",
      "neutral",
      "red",
      "neutral",
      "blue",
      "neutral",
      "red",
    ]);
  });

  it("varies the board for distinct known seeds", () => {
    const first = createClassicBoard({
      cards,
      seed: "seed-a",
      startingTeam: "red",
    });
    const second = createClassicBoard({
      cards,
      seed: "seed-b",
      startingTeam: "red",
    });

    expect(second).not.toEqual(first);
  });

  it("keeps each ordered card consistent with its supplied source card", () => {
    const board = createClassicBoard({
      cards,
      seed: "consistent-order",
      startingTeam: "red",
    });
    const suppliedById = new Map(cards.map((card) => [card.id, card]));

    for (const cardId of board.order) {
      const boardCard = board.cards[cardId];
      expect(boardCard).toBeDefined();
      expect(boardCard).toMatchObject({
        id: cardId,
        label: suppliedById.get(cardId)?.label,
        revealed: false,
      });
    }
    expect(Object.keys(board.cards).sort()).toEqual([...board.order].sort());
  });

  it("does not mutate the source cards", () => {
    const before = cards.map((card) => ({ ...card }));

    createClassicBoard({ cards, seed: "immutable", startingTeam: "red" });

    expect(cards).toEqual(before);
  });

  it("creates no shared mutable output objects", () => {
    const first = createClassicBoard({
      cards,
      seed: "isolated",
      startingTeam: "red",
    });
    const second = createClassicBoard({
      cards,
      seed: "isolated",
      startingTeam: "red",
    });
    const firstCardId = first.order[0]!;

    first.order.reverse();
    first.cards[firstCardId]!.label = "Changed";

    expect(second.order).not.toEqual(first.order);
    expect(second.cards[firstCardId]?.label).not.toBe("Changed");
    expect(cards.find((card) => card.id === firstCardId)?.label).not.toBe(
      "Changed",
    );
  });

  it("rejects fewer than 25 unique cards", () => {
    expect(() =>
      createClassicBoard({
        cards: cards.slice(0, 24),
        seed: "short",
        startingTeam: "red",
      }),
    ).toThrow("Classic board requires at least 25 unique cards");
  });

  it("rejects duplicate IDs anywhere in the supplied pool", () => {
    const cardsWithDuplicate = cards.map((card) => ({ ...card }));
    cardsWithDuplicate[39] = { ...cardsWithDuplicate[0]! };

    expect(() =>
      createClassicBoard({
        cards: cardsWithDuplicate,
        seed: "duplicate",
        startingTeam: "red",
      }),
    ).toThrow("Classic board requires unique card IDs");
  });

  it("keeps prototype-like card IDs as own board-card properties", () => {
    const prototypeCardPool: TextCard[] = [
      { id: "__proto__", label: "Prototype" },
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `ordinary-${index}`,
        label: `Ordinary ${index}`,
      })),
    ];

    const board = createClassicBoard({
      cards: prototypeCardPool,
      seed: "prototype-card",
      startingTeam: "red",
    });

    expect(board.order).toContain("__proto__");
    expect(
      board.order.every((cardId) => Object.hasOwn(board.cards, cardId)),
    ).toBe(true);
    expect(Object.keys(board.cards)).toHaveLength(25);
    expect(countOwnership(board)).toEqual({
      red: 9,
      blue: 8,
      neutral: 7,
      hazard: 1,
    });
  });

  it("preserves exact ownership and immutability invariants for generated seeds", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom<TeamId>("red", "blue"),
        (seed, startingTeam) => {
          const sourceCards = cards.map((card) => ({ ...card }));
          const before = sourceCards.map((card) => ({ ...card }));
          const board = createClassicBoard({
            cards: sourceCards,
            seed,
            startingTeam,
          });
          const counts = countOwnership(board);

          expect(board.order).toHaveLength(25);
          expect(new Set(board.order).size).toBe(25);
          expect(counts.hazard).toBe(1);
          expect(counts.neutral).toBe(7);
          expect(counts[startingTeam]).toBe(9);
          expect(counts[otherTeam(startingTeam)]).toBe(8);
          expect(sourceCards).toEqual(before);
        },
      ),
      { numRuns: 60, seed: 20_260_830 },
    );
  });
});
