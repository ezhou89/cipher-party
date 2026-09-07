import type { PublicCard, TeamId } from "@cipher-party/protocol";

export interface TeamScoreProps {
  cards: PublicCard[];
  activeTeam: TeamId;
}

export function TeamScore({ cards, activeTeam }: TeamScoreProps) {
  const redRevealed = cards.filter(
    (c) => c.revealed && c.owner === "red"
  ).length;
  const blueRevealed = cards.filter(
    (c) => c.revealed && c.owner === "blue"
  ).length;

  return (
    <div
      className="team-scores-container"
      role="region"
      aria-label="Team scores"
    >
      <div
        className={`team-score-card team-score-red ${activeTeam === "red" ? "team-score--active" : ""}`}
      >
        <span className="team-score-symbol" aria-hidden="true">
          ♥
        </span>
        <div className="team-score-info">
          <span className="team-score-name">Ruby (Red)</span>
          <span className="team-score-count">{redRevealed} Revealed</span>
        </div>
      </div>

      <div
        className={`team-score-card team-score-blue ${activeTeam === "blue" ? "team-score--active" : ""}`}
      >
        <span className="team-score-symbol" aria-hidden="true">
          ✦
        </span>
        <div className="team-score-info">
          <span className="team-score-name">Cobalt (Blue)</span>
          <span className="team-score-count">{blueRevealed} Revealed</span>
        </div>
      </div>
    </div>
  );
}
