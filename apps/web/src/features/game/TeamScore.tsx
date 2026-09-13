import type { ClientProjection } from "@cipher-party/protocol";
import type { CSSProperties } from "react";

import { TEAM_PRESENTATION } from "../../lib/team-presentation";

interface TeamScoreProps {
  board: NonNullable<ClientProjection["board"]>;
}

export function TeamScore({ board }: TeamScoreProps) {
  const summaries = new Map(
    board.teamSummaries.map((summary) => [summary.teamId, summary]),
  );

  return (
    <section
      className="team-score"
      aria-label="Team progress"
      style={{ "--team-count": String(board.teamCount) } as CSSProperties}
    >
      {board.configuredTeams.map((teamId) => {
        const presentation = TEAM_PRESENTATION[teamId];
        const summary = summaries.get(teamId);
        const eliminated = summary?.eliminated ?? false;
        return (
          <strong
            key={teamId}
            className={`team-score-${teamId}${board.activeTeam === teamId ? " is-current" : ""}${eliminated ? " is-eliminated" : ""}`}
            data-team-pattern={presentation.pattern}
          >
            <span className="team-callsign">{presentation.callsign}</span>
            <span>
              {presentation.symbol} {presentation.label} revealed targets{" "}
              {summary?.revealedTargets ?? 0}
            </span>
            {eliminated ? (
              <>
                {" "}
                <span className="team-state">Eliminated</span>
              </>
            ) : null}
          </strong>
        );
      })}
    </section>
  );
}
