import { useMemo } from "react";
import type { CardId, Ownership, PublicCard } from "@cipher-party/protocol";
import { BoardCard } from "./BoardCard";

export interface BoardGridProps {
  cards: PublicCard[];
  order: CardId[];
  keyRecord?: Record<CardId, Ownership> | undefined;
  nomination: { playerId: string; cardId: string } | null;
  canNominate: boolean;
  onNominate?: (cardId: string) => void;
}

export function BoardGrid({
  cards,
  order,
  keyRecord,
  nomination,
  canNominate,
  onNominate
}: BoardGridProps) {
  const cardsById = useMemo(() => {
    const map = new Map<CardId, PublicCard>();
    for (const c of cards) {
      map.set(c.id, c);
    }
    return map;
  }, [cards]);

  return (
    <section
      className="board-grid-section"
      role="region"
      aria-label="Game board"
    >
      <div className="board-grid">
        {order.map((cardId) => {
          const card = cardsById.get(cardId);
          if (!card) return null;

          const isNominated = nomination?.cardId === cardId;
          const isDisabled = !canNominate || card.revealed;
          const keyOwner = keyRecord ? keyRecord[cardId] : undefined;

          return (
            <BoardCard
              key={card.id}
              card={card}
              {...(keyOwner !== undefined ? { keyOwner } : {})}
              nominated={isNominated}
              disabled={isDisabled}
              {...(onNominate !== undefined ? { onNominate } : {})}
            />
          );
        })}
      </div>
    </section>
  );
}
