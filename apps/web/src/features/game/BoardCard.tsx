import type { Ownership, PublicCard } from "@cipher-party/protocol";

export interface BoardCardProps {
  card: PublicCard;
  keyOwner?: Ownership;
  nominated: boolean;
  disabled: boolean;
  onNominate?: (cardId: string) => void;
}

const OWNER_TEXT: Record<Ownership, string> = {
  red: "Ruby",
  blue: "Cobalt",
  neutral: "Neutral",
  hazard: "Hazard"
};

const OWNER_SYMBOL: Record<Ownership, string> = {
  red: "♥",
  blue: "✦",
  neutral: "—",
  hazard: "☠"
};

const OWNER_PATTERN_CLASS: Record<Ownership, string> = {
  red: "card--pattern-ruby",
  blue: "card--pattern-cobalt",
  neutral: "card--pattern-neutral",
  hazard: "card--pattern-hazard"
};

export function BoardCard({
  card,
  keyOwner,
  nominated,
  disabled,
  onNominate
}: BoardCardProps) {
  if (card.revealed && card.owner) {
    const owner = card.owner;
    const ownerText = OWNER_TEXT[owner];
    const symbol = OWNER_SYMBOL[owner];
    const patternClass = OWNER_PATTERN_CLASS[owner];

    return (
      <div
        className={`board-card card--revealed card--owner-${owner} ${patternClass}`}
        data-testid={`card-${card.id}`}
        aria-label={`Revealed ${card.label}, ${ownerText}`}
      >
        <span className="card-symbol" aria-hidden="true">
          {symbol}
        </span>
        <span className="card-word">{card.label}</span>
        <span className="card-owner-text">{ownerText}</span>
      </div>
    );
  }

  // Unrevealed card
  const classNames = ["board-card", "card--unrevealed"];
  if (nominated) {
    classNames.push("card--nominated");
  }
  if (keyOwner) {
    classNames.push(`card--key-${keyOwner}`);
  }

  return (
    <button
      type="button"
      className={classNames.join(" ")}
      data-testid={`card-${card.id}`}
      aria-label={`Card ${card.label}`}
      {...(nominated ? { "data-nominated": "true" } : {})}
      disabled={disabled}
      onClick={() => onNominate?.(card.id)}
    >
      <span className="card-word">{card.label}</span>
      {nominated && <span className="card-nomination-badge">Nominated</span>}
      {keyOwner && (
        <span className="card-key-indicator">
          {OWNER_TEXT[keyOwner]} {OWNER_SYMBOL[keyOwner]}
        </span>
      )}
    </button>
  );
}
