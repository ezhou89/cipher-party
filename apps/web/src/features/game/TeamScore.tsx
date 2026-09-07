import type { ClientProjection } from "@cipher-party/protocol";

import { TEAM_PRESENTATION } from "../../lib/team-presentation";

interface TeamScoreProps {
  board: NonNullable<ClientProjection["board"]>;
}

export function TeamScore({ board }: TeamScoreProps) {
  let redRevealed = 0;
  let blueRevealed = 0;
  for (const card of board.cards) {
    if (!card.revealed) {
      continue;
    }
    if (card.owner === "red") {
      redRevealed += 1;
    } else if (card.owner === "blue") {
      blueRevealed += 1;
    }
  }

  return (
    <section className="team-score" aria-label="Team progress">
      <strong
        className={`team-score-red${board.activeTeam === "red" ? " is-current" : ""}`}
      >
        <span className="team-callsign">{TEAM_PRESENTATION.red.callsign}</span>
        <span>
          {TEAM_PRESENTATION.red.symbol} {TEAM_PRESENTATION.red.label} revealed
          targets {redRevealed}
        </span>
      </strong>
      <strong
        className={`team-score-blue${board.activeTeam === "blue" ? " is-current" : ""}`}
      >
        <span className="team-callsign">{TEAM_PRESENTATION.blue.callsign}</span>
        <span>
          {TEAM_PRESENTATION.blue.symbol} {TEAM_PRESENTATION.blue.label}{" "}
          revealed targets {blueRevealed}
        </span>
      </strong>
    </section>
  );
}
