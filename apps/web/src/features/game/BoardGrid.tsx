import type { PublicCard } from "@cipher-party/protocol";
import { useId, type CSSProperties } from "react";

import { BoardCard } from "./BoardCard";

type PublicOwner = Extract<PublicCard, { revealed: true }>["owner"];

interface BoardGridProps {
  cards: PublicCard[];
  order: string[];
  rows: 5 | 6;
  columns: 5 | 6;
  nominatedCardId: string | null;
  disabled: boolean;
  onNominate?: (cardId: string) => void;
  keyOwnerForCard?: (cardId: string) => PublicOwner | undefined;
}

export function BoardGrid({
  cards,
  order,
  rows,
  columns,
  nominatedCardId,
  disabled,
  onNominate,
  keyOwnerForCard,
}: BoardGridProps) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const navigationHintId = useId();
  const scrollable = columns > 5;

  return (
    <section
      className={`board-region${scrollable ? " is-scrollable" : ""}`}
      aria-label="Classic board"
      {...(scrollable
        ? { "aria-describedby": navigationHintId, tabIndex: 0 }
        : {})}
    >
      {scrollable ? (
        <p className="board-navigation-hint" id={navigationHintId}>
          {columns} columns by {rows} rows. Scroll or arrow keys to explore.
        </p>
      ) : null}
      <ol
        className="board-grid"
        style={
          {
            "--board-columns": String(columns),
            "--board-rows": String(rows),
          } as CSSProperties
        }
      >
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
