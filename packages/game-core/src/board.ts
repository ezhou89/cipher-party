import type { CardId, Ownership, TeamId, TextCard } from "./domain";
import { createSeededRandom, shuffled } from "./random";

export interface BoardCard extends TextCard {
  owner: Ownership;
  revealed: boolean;
}

export interface ClassicBoard {
  order: CardId[];
  cards: Record<CardId, BoardCard>;
  startingTeam: TeamId;
}

export function createClassicBoard(input: {
  cards: readonly TextCard[];
  seed: string;
  startingTeam: TeamId;
}): ClassicBoard {
  const cardIds = new Set(input.cards.map((card) => card.id));
  if (cardIds.size < 25) {
    throw new Error("Classic board requires at least 25 unique cards");
  }
  if (cardIds.size !== input.cards.length) {
    throw new Error("Classic board requires unique card IDs");
  }

  const selectedCards = shuffled(
    input.cards,
    createSeededRandom(input.seed),
  ).slice(0, 25);
  const otherTeam: TeamId = input.startingTeam === "red" ? "blue" : "red";
  const owners = shuffled<Ownership>(
    [
      ...Array<Ownership>(9).fill(input.startingTeam),
      ...Array<Ownership>(8).fill(otherTeam),
      ...Array<Ownership>(7).fill("neutral"),
      "hazard",
    ],
    createSeededRandom(`${input.seed}/ownership`),
  );
  const boardCards: Record<CardId, BoardCard> = Object.create(null);
  const order: CardId[] = [];

  for (const [index, card] of selectedCards.entries()) {
    const owner = owners[index]!;
    boardCards[card.id] = { ...card, owner, revealed: false };
    order.push(card.id);
  }

  return { order, cards: boardCards, startingTeam: input.startingTeam };
}

export function countOwnership(board: ClassicBoard): Record<Ownership, number> {
  const counts: Record<Ownership, number> = {
    red: 0,
    blue: 0,
    neutral: 0,
    hazard: 0,
  };

  for (const card of Object.values(board.cards)) {
    counts[card.owner] += 1;
  }

  return counts;
}
