import type {
  CardId,
  PublicCard,
  PublicHistoryEntry
} from "@cipher-party/protocol";

export interface GameHistoryProps {
  history: PublicHistoryEntry[];
  cardsById: Map<CardId, PublicCard>;
}

const OWNER_NAMES: Record<string, string> = {
  red: "Ruby (Red)",
  blue: "Cobalt (Blue)",
  neutral: "Neutral",
  hazard: "Hazard"
};

export function GameHistory({ history, cardsById }: GameHistoryProps) {
  return (
    <section
      className="game-history-panel"
      role="region"
      aria-label="Game history"
    >
      <h3 className="history-panel-title">Mission Log</h3>
      {history.length === 0 ? (
        <p className="history-empty">No actions recorded yet.</p>
      ) : (
        <ol className="history-list">
          {history.map((entry) => {
            const key = `${entry.revision}-${entry.type}-${entry.at}`;
            switch (entry.type) {
              case "clue_submitted":
                return (
                  <li key={key} className="history-item history-item-clue">
                    <span className="history-action">Clue submitted:</span>{" "}
                    <strong>{entry.word}</strong> ({entry.count}) by{" "}
                    {entry.teamId === "red" ? "Ruby" : "Cobalt"}
                  </li>
                );
              case "card_revealed": {
                const card = cardsById.get(entry.cardId);
                const label = card ? card.label : entry.cardId;
                const ownerName = OWNER_NAMES[entry.owner] ?? entry.owner;
                return (
                  <li key={key} className="history-item history-item-reveal">
                    <span className="history-action">Card revealed:</span>{" "}
                    <strong>{label}</strong> ({ownerName})
                  </li>
                );
              }
              case "clue_challenged":
                return (
                  <li key={key} className="history-item history-item-challenge">
                    <span className="history-action">Clue challenged</span> by{" "}
                    {entry.teamId === "red" ? "Ruby" : "Cobalt"}
                  </li>
                );
              case "challenge_resolved":
                return (
                  <li key={key} className="history-item history-item-resolved">
                    <span className="history-action">
                      Challenge{" "}
                      {entry.decision === "accept" ? "accepted" : "rejected"}
                    </span>
                  </li>
                );
              case "turn_ended":
                return (
                  <li key={key} className="history-item history-item-turn">
                    <span className="history-action">Turn ended</span> for{" "}
                    {entry.teamId === "red" ? "Ruby" : "Cobalt"}
                  </li>
                );
              case "room_paused":
                return (
                  <li key={key} className="history-item history-item-pause">
                    <span className="history-action">Game paused</span>
                  </li>
                );
              case "room_resumed":
                return (
                  <li key={key} className="history-item history-item-resume">
                    <span className="history-action">Game resumed</span>
                  </li>
                );
              default:
                return null;
            }
          })}
        </ol>
      )}
    </section>
  );
}
