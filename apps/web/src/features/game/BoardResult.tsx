import type { TeamId } from "@cipher-party/protocol";

export interface BoardResultProps {
  winner: TeamId | null;
  completionReason: "targets" | "hazard" | null;
}

export function BoardResult({ winner, completionReason }: BoardResultProps) {
  if (!winner) return null;

  const teamTitle = winner === "red" ? "Red Team Wins!" : "Blue Team Wins!";
  const reasonText =
    completionReason === "targets"
      ? "All targets identified!"
      : "Opponent revealed the hazard!";

  return (
    <section
      className={`board-result-banner board-result--${winner}`}
      role="region"
      aria-label="Board result"
    >
      <div className="board-result-content">
        <h2 className="board-result-title">🏆 {teamTitle}</h2>
        <p className="board-result-reason">{reasonText}</p>
      </div>
    </section>
  );
}
