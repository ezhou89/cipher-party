import type { ClientProjection } from "@cipher-party/protocol";

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
      <strong className={board.activeTeam === "red" ? "is-current" : ""}>
        ◆ Red revealed targets {redRevealed}
      </strong>
      <strong className={board.activeTeam === "blue" ? "is-current" : ""}>
        ● Blue revealed targets {blueRevealed}
      </strong>
    </section>
  );
}
