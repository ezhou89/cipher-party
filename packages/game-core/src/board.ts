import type { CardId, Ownership, TeamId, TextCard } from "./domain";
import { createSeededRandom, shuffled } from "./random";
import {
  classicBoardSpec,
  configuredTeams,
  type TeamCount,
} from "./team-rules";

export interface BoardCard extends TextCard {
  owner: Ownership;
  revealed: boolean;
}

export interface ClassicBoard {
  teamCount: TeamCount;
  configuredTeams: TeamId[];
  rows: 5 | 6;
  columns: 5 | 6;
  order: CardId[];
  cards: Record<CardId, BoardCard>;
  startingTeam: TeamId;
}

export function createClassicBoard(input: {
  cards: readonly TextCard[];
  seed: string;
  startingTeam: TeamId;
  teamCount?: TeamCount;
}): ClassicBoard {
  const teamCount = input.teamCount ?? 2;
  const spec = classicBoardSpec(teamCount);
  const teams = configuredTeams(teamCount);
  const cardIds = new Set(input.cards.map((card) => card.id));
  if (cardIds.size < spec.cardCount) {
    throw new Error(
      `Classic board requires at least ${spec.cardCount} unique cards`,
    );
  }
  if (cardIds.size !== input.cards.length) {
    throw new Error("Classic board requires unique card IDs");
  }

  const selectedCards = shuffled(
    input.cards,
    createSeededRandom(`${input.seed}/cards`),
  ).slice(0, spec.cardCount);
  const orderedCards = shuffled(
    selectedCards,
    createSeededRandom(`${input.seed}/grid-order`),
  );
  const owners = shuffled<Ownership>(
    [
      ...Array<Ownership>(spec.startingTargets).fill(input.startingTeam),
      ...teams
        .filter((teamId) => teamId !== input.startingTeam)
        .flatMap((teamId) => Array<Ownership>(spec.otherTargets).fill(teamId)),
      ...Array<Ownership>(spec.neutralCards).fill("neutral"),
      "hazard",
    ],
    createSeededRandom(`${input.seed}/ownership`),
  );
  const boardCards: Record<CardId, BoardCard> = Object.create(null);
  const order: CardId[] = [];

  for (const [index, card] of orderedCards.entries()) {
    const owner = owners[index]!;
    boardCards[card.id] = { ...card, owner, revealed: false };
    order.push(card.id);
  }

  return {
    teamCount,
    configuredTeams: [...teams],
    rows: spec.rows,
    columns: spec.columns,
    order,
    cards: boardCards,
    startingTeam: input.startingTeam,
  };
}

export function countOwnership(board: ClassicBoard): Record<Ownership, number> {
  const counts: Record<Ownership, number> = {
    red: 0,
    blue: 0,
    green: 0,
    yellow: 0,
    neutral: 0,
    hazard: 0,
  };

  for (const card of Object.values(board.cards)) {
    counts[card.owner] += 1;
  }

  return counts;
}
