import type { ClientProjection } from "@cipher-party/protocol";

import { TEAM_PRESENTATION } from "../../lib/team-presentation";

interface BoardResultProps {
  board: NonNullable<ClientProjection["board"]>;
}

export function BoardResult({ board }: BoardResultProps) {
  if (board.winner === null || board.completionReason === null) {
    return null;
  }
  const winner = TEAM_PRESENTATION[board.winner];

  return (
    <section className="board-result" aria-label="Board result">
      <p className="card-index">Board sealed</p>
      <h2>
        <span aria-hidden="true">{winner.symbol}</span> {winner.label} wins
      </h2>
      <p>
        {board.completionReason === "targets"
          ? "All of the winning team’s targets were revealed."
          : "The hazard ended the board."}
      </p>
    </section>
  );
}
