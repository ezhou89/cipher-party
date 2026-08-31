import type {
  ClientProjection,
  PublicHistoryEntry,
} from "@cipher-party/protocol";

const TEAM = {
  red: { label: "Red", symbol: "◆" },
  blue: { label: "Blue", symbol: "●" },
} as const;

const OWNER = {
  red: { label: "Red", symbol: "◆" },
  blue: { label: "Blue", symbol: "●" },
  neutral: { label: "Neutral", symbol: "◇" },
  hazard: { label: "Hazard", symbol: "✦" },
} as const;

function unreachable(entry: never): never {
  void entry;
  throw new Error("Unsupported public history variant");
}

export function historyEntryText(
  entry: PublicHistoryEntry,
  cardLabels: ReadonlyMap<string, string>,
): string {
  switch (entry.type) {
    case "clue_submitted": {
      const team = TEAM[entry.teamId];
      return `${team.symbol} ${team.label} submitted ${entry.word} for ${entry.count}.`;
    }
    case "clue_challenged": {
      const team = TEAM[entry.teamId];
      return `${team.symbol} ${team.label}’s clue was challenged.`;
    }
    case "challenge_resolved":
      return `The clue challenge was ${entry.decision === "accept" ? "accepted" : "rejected"}.`;
    case "card_revealed": {
      const team = TEAM[entry.teamId];
      const owner = OWNER[entry.owner];
      const label = cardLabels.get(entry.cardId) ?? "A board card";
      return `${label} was revealed as ${owner.symbol} ${owner.label} by ${team.label}.`;
    }
    case "turn_ended": {
      const team = TEAM[entry.teamId];
      return `${team.symbol} ${team.label} ended its turn.`;
    }
    case "room_paused":
      return "The room was paused.";
    case "room_resumed":
      return "The room resumed.";
    default:
      return unreachable(entry);
  }
}

interface GameHistoryProps {
  entries: PublicHistoryEntry[];
  cards: NonNullable<ClientProjection["board"]>["cards"];
}

export function GameHistory({ entries, cards }: GameHistoryProps) {
  const cardLabels = new Map(cards.map((card) => [card.id, card.label]));

  return (
    <section className="game-history" aria-label="Public game history">
      <p className="card-index">Public record</p>
      <h2>Game history</h2>
      {entries.length === 0 ? (
        <p className="empty-history">No public actions yet.</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={`${entry.revision}-${entry.type}`}>
              {historyEntryText(entry, cardLabels)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
