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
  const uniqueCardIds = new Set(input.cards.map((c) => c.id));
  if (input.cards.length < 25 || uniqueCardIds.size < 25) {
    throw new Error("Classic board requires at least 25 unique cards");
  }

  // Tier 1: Pool sampling
  const sampledCards = shuffled(
    input.cards,
    createSeededRandom(input.seed + "/cards")
  ).slice(0, 25);

  // Tier 2: Grid permutation
  const orderedCards = shuffled(
    sampledCards,
    createSeededRandom(input.seed + "/grid-order")
  );

  // Tier 3: Keycard ownership decoupling
  const opposingTeam: TeamId = input.startingTeam === "red" ? "blue" : "red";
  const ownerships: Ownership[] = [
    ...Array<Ownership>(9).fill(input.startingTeam),
    ...Array<Ownership>(8).fill(opposingTeam),
    ...Array<Ownership>(7).fill("neutral"),
    "hazard"
  ];

  const shuffledOwnerships = shuffled(
    ownerships,
    createSeededRandom(input.seed + "/ownership")
  );

  const order: CardId[] = orderedCards.map((c) => c.id);
  const cards: Record<CardId, BoardCard> = {};

  for (let index = 0; index < 25; index += 1) {
    const card = orderedCards[index]!;
    const owner = shuffledOwnerships[index]!;
    cards[card.id] = {
      id: card.id,
      label: card.label,
      owner,
      revealed: false
    };
  }

  return {
    order,
    cards,
    startingTeam: input.startingTeam
  };
}

export function countOwnership(board: ClassicBoard): Record<Ownership, number> {
  const counts: Record<Ownership, number> = {
    red: 0,
    blue: 0,
    neutral: 0,
    hazard: 0
  };
  for (const card of Object.values(board.cards)) {
    counts[card.owner] += 1;
  }
  return counts;
}
