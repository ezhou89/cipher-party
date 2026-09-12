import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  chooseStartingTeam,
  configuredTeams,
  countOwnership,
  createClassicBoard,
  type TeamCount,
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
  it.each([
    [2, 5, 5, 25, 9, 8, 7],
    [3, 5, 6, 30, 8, 7, 7],
    [4, 6, 6, 36, 8, 7, 6],
  ] as const)(
    "creates the exact %d-team board distribution",
    (
      teamCount,
      rows,
      columns,
      cardCount,
      startingTargets,
      otherTargets,
      neutralCards,
    ) => {
      const startingTeam = chooseStartingTeam(teamCount, "distribution");
      const board = createClassicBoard({
        cards,
        seed: "distribution",
        startingTeam,
        teamCount,
      });
      const counts = countOwnership(board);

      expect(board).toMatchObject({
        teamCount,
        configuredTeams: configuredTeams(teamCount),
        rows,
        columns,
        startingTeam,
      });
      expect(board.order).toHaveLength(cardCount);
      expect(Object.keys(board.cards)).toHaveLength(cardCount);
      expect(counts[startingTeam]).toBe(startingTargets);
      for (const teamId of configuredTeams(teamCount)) {
        expect(counts[teamId]).toBe(
          teamId === startingTeam ? startingTargets : otherTargets,
        );
      }
      expect(counts.neutral).toBe(neutralCards);
      expect(counts.hazard).toBe(1);
    },
  );

  it.each([2, 3, 4] as const)(
    "replays the same %d-team board for the same seed",
    (teamCount) => {
      const startingTeam = chooseStartingTeam(teamCount, "replay");
      const input = { cards, seed: "replay", startingTeam, teamCount };

      expect(createClassicBoard(input)).toEqual(createClassicBoard(input));
    },
  );

  it.each([2, 3, 4] as const)(
    "selects every eligible starting-team slot for %d teams",
    (teamCount) => {
      const observed = new Set<TeamId>();
      for (let index = 0; index < 1_000; index += 1) {
        observed.add(chooseStartingTeam(teamCount, `starter-${index}`));
      }

      expect([...observed].sort()).toEqual(
        [...configuredTeams(teamCount)].sort(),
      );
    },
  );

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
      green: 0,
      yellow: 0,
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
      green: 0,
      yellow: 0,
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

  it.each([
    [3, 29, "Classic board requires at least 30 unique cards"],
    [4, 35, "Classic board requires at least 36 unique cards"],
  ] as const)(
    "rejects fewer than the required unique cards for %d teams",
    (teamCount, cardCount, expectedMessage) => {
      expect(() =>
        createClassicBoard({
          cards: cards.slice(0, cardCount),
          seed: "short",
          startingTeam: "red",
          teamCount,
        }),
      ).toThrow(expectedMessage);
    },
  );

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

  it.each([2, 3, 4] as const)(
    "rejects duplicate IDs for a %d-team board",
    (teamCount) => {
      const cardsWithDuplicate = cards.map((card) => ({ ...card }));
      cardsWithDuplicate[39] = { ...cardsWithDuplicate[0]! };

      expect(() =>
        createClassicBoard({
          cards: cardsWithDuplicate,
          seed: "duplicate-by-team-count",
          startingTeam: "red",
          teamCount,
        }),
      ).toThrow("Classic board requires unique card IDs");
    },
  );

  it.each([2, 3, 4] as const)(
    "returns isolated configured-team metadata for %d teams",
    (teamCount: TeamCount) => {
      const first = createClassicBoard({
        cards,
        seed: "metadata-copy",
        startingTeam: "red",
        teamCount,
      });
      const second = createClassicBoard({
        cards,
        seed: "metadata-copy",
        startingTeam: "red",
        teamCount,
      });

      first.configuredTeams.reverse();

      expect(second.configuredTeams).toEqual(configuredTeams(teamCount));
    },
  );

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
      green: 0,
      yellow: 0,
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
