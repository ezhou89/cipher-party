import type { ClientProjection } from "@cipher-party/protocol";

export interface TeamPanelIdentity {
  id: "red" | "blue" | "waiting";
  label: string;
  symbol: string;
}

interface TeamPanelProps {
  identity: TeamPanelIdentity;
  seats: ClientProjection["seats"];
}

function roleLabel(role: ClientProjection["seats"][number]["role"]): string {
  switch (role) {
    case "clue-giver":
      return "Clue-giver";
    case "operative":
      return "Operative";
    case "spectator":
      return "Spectator";
    case "unassigned":
      return "Unassigned";
  }
}

export function TeamPanel({ identity, seats }: TeamPanelProps) {
  const headingId = `${identity.id}-team-heading`;
  return (
    <section
      className={`team-panel team-panel-${identity.id}`}
      aria-labelledby={headingId}
    >
      <header className="team-panel-heading">
        <h2 id={headingId}>
          <span>{identity.symbol}</span> {identity.label}
        </h2>
        <span>{seats.length}</span>
      </header>
      {seats.length === 0 ? (
        <p className="empty-team">No seats assigned</p>
      ) : (
        <ul className="seat-list">
          {seats.map((seat) => (
            <li key={seat.playerId} className="seat-row">
              <span className="seat-name">{seat.displayName}</span>
              <span className="seat-role">{roleLabel(seat.role)}</span>
              <span className={seat.connected ? "seat-online" : "seat-offline"}>
                <span aria-hidden="true">{seat.connected ? "●" : "○"}</span>{" "}
                {seat.connected ? "Online" : "Offline"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
