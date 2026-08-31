import type { PublicCard } from "@cipher-party/protocol";

import { BoardCard } from "./BoardCard";

type PublicOwner = Extract<PublicCard, { revealed: true }>["owner"];

interface BoardGridProps {
  cards: PublicCard[];
  order: string[];
  nominatedCardId: string | null;
  disabled: boolean;
  onNominate?: (cardId: string) => void;
  keyOwnerForCard?: (cardId: string) => PublicOwner | undefined;
}

export function BoardGrid({
  cards,
  order,
  nominatedCardId,
  disabled,
  onNominate,
  keyOwnerForCard,
}: BoardGridProps) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));

  return (
    <section className="board-region" aria-label="Classic board">
      <ol className="board-grid">
        {order.map((cardId) => {
          const card = cardsById.get(cardId);
          if (card === undefined) {
            return null;
          }
          const keyOwner = keyOwnerForCard?.(cardId);
          return (
            <li key={cardId}>
              <BoardCard
                card={card}
                nominated={nominatedCardId === cardId}
                disabled={disabled}
                {...(onNominate === undefined ? {} : { onNominate })}
                {...(keyOwner === undefined ? {} : { keyOwner })}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
