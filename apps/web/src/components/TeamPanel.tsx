import type { ClientProjection } from "@cipher-party/protocol";

import type { TeamId } from "../lib/team-presentation";

export interface TeamPanelIdentity {
  id: TeamId | "waiting";
  label: string;
  symbol: string;
  callsign?: string;
  pattern?: string;
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
      {...(identity.pattern === undefined
        ? {}
        : { "data-team-pattern": identity.pattern })}
    >
      <header className="team-panel-heading">
        <div>
          {identity.callsign === undefined ? null : (
            <p className="team-callsign">{identity.callsign}</p>
          )}
          <h2 id={headingId}>
            <span>{identity.symbol}</span> {identity.label}
          </h2>
        </div>
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
