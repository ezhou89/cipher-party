import type { PublicCard } from "@cipher-party/protocol";

type PublicOwner = Extract<PublicCard, { revealed: true }>["owner"];

export interface BoardCardProps {
  card: PublicCard;
  keyOwner?: PublicOwner;
  nominated: boolean;
  disabled: boolean;
  onNominate?: (cardId: string) => void;
}

const OWNER_PRESENTATION: Record<
  PublicOwner,
  { label: string; symbol: string }
> = {
  red: { label: "Red", symbol: "◆" },
  blue: { label: "Blue", symbol: "●" },
  neutral: { label: "Neutral", symbol: "◇" },
  hazard: { label: "Hazard", symbol: "✦" },
};

function CardContents({
  card,
  keyOwner,
  nominated,
}: Pick<BoardCardProps, "card" | "keyOwner" | "nominated">) {
  const publicOwner = card.revealed ? OWNER_PRESENTATION[card.owner] : null;
  const secretOwner =
    !card.revealed && keyOwner !== undefined
      ? OWNER_PRESENTATION[keyOwner]
      : null;

  return (
    <>
      <span className="board-card-label">{card.label}</span>
      {nominated && !card.revealed ? (
        <span className="nomination-marker">Nominated</span>
      ) : null}
      {publicOwner === null ? null : (
        <span className="public-owner">
          <span aria-hidden="true">{publicOwner.symbol}</span>{" "}
          {publicOwner.label} revealed
        </span>
      )}
      {secretOwner === null ? null : (
        <span className={`key-owner owner-${keyOwner}`}>
          <span aria-hidden="true">{secretOwner.symbol}</span>{" "}
          {secretOwner.label} key
        </span>
      )}
    </>
  );
}

export function BoardCard({
  card,
  keyOwner,
  nominated,
  disabled,
  onNominate,
}: BoardCardProps) {
  const ownerClass = card.revealed ? ` owner-${card.owner}` : "";
  const className = `board-card${card.revealed ? " is-revealed" : ""}${ownerClass}${nominated && !card.revealed ? " is-nominated" : ""}`;
  const contents = (
    <CardContents
      card={card}
      nominated={nominated}
      {...(keyOwner === undefined ? {} : { keyOwner })}
    />
  );

  if (!card.revealed && onNominate !== undefined) {
    return (
      <button
        className={className}
        type="button"
        aria-label={`${card.label}${nominated ? ", nominated" : ""}`}
        aria-pressed={nominated}
        disabled={disabled}
        onClick={() => onNominate(card.id)}
      >
        {contents}
      </button>
    );
  }

  return <article className={className}>{contents}</article>;
}
