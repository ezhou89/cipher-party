import type { SeatRole, SeatSummary, TeamId } from "@cipher-party/protocol";

export interface TeamPanelProps {
  teamId: TeamId | null;
  title: string;
  seats: SeatSummary[];
  viewerId: string;
  isHost: boolean;
  disabled?: boolean;
  onAssignTeam?: (playerId: string, teamId: TeamId | null) => void;
  onAssignRole?: (playerId: string, role: SeatRole) => void;
}

export function TeamPanel({
  teamId,
  title,
  seats,
  viewerId,
  isHost,
  disabled = false,
  onAssignTeam,
  onAssignRole
}: TeamPanelProps) {
  const panelClass =
    teamId === "red"
      ? "team-panel-red"
      : teamId === "blue"
        ? "team-panel-blue"
        : "team-panel-spectator";

  return (
    <section
      role="region"
      aria-label={title}
      className={`team-panel ${panelClass}`}
    >
      <div className="team-panel-header">
        <h3 className="team-title">{title}</h3>
        <span className="team-count" aria-label={`${seats.length} players`}>
          ({seats.length})
        </span>
      </div>

      <div className="team-player-list">
        {seats.length === 0 ? (
          <p className="empty-team-msg">No players assigned</p>
        ) : (
          seats.map((seat) => {
            const isMe = seat.playerId === viewerId;
            return (
              <div
                key={seat.playerId}
                className={`player-card ${isMe ? "player-card-me" : ""}`}
              >
                <div className="player-info">
                  <div className="player-name-row">
                    <span className="player-name">
                      {seat.displayName}
                      {isMe && <span className="you-tag"> (You)</span>}
                    </span>
                    <span
                      className={`seat-status-dot ${seat.connected ? "online" : "offline"}`}
                      title={seat.connected ? "Online" : "Offline"}
                      aria-label={seat.connected ? "Online" : "Offline"}
                    >
                      {seat.connected ? "Online" : "Offline"}
                    </span>
                  </div>
                  <div className="player-role-badge">
                    Role: <span className="role-name">{seat.role}</span>
                  </div>
                </div>

                {isHost && (
                  <div className="host-seat-controls">
                    {teamId !== null && onAssignRole && (
                      <select
                        aria-label={`Role for ${seat.displayName}`}
                        value={seat.role}
                        disabled={disabled}
                        onChange={(e) =>
                          onAssignRole(
                            seat.playerId,
                            e.target.value as SeatRole
                          )
                        }
                        className="role-select"
                      >
                        <option value="operative">Operative</option>
                        <option value="clue-giver">Clue-Giver</option>
                      </select>
                    )}

                    {onAssignTeam && (
                      <div className="team-move-buttons">
                        {teamId !== "red" && (
                          <button
                            type="button"
                            className="btn-move btn-move-red"
                            disabled={disabled}
                            onClick={() => onAssignTeam(seat.playerId, "red")}
                            aria-label={`Move ${seat.displayName} to Red`}
                          >
                            → Red
                          </button>
                        )}
                        {teamId !== "blue" && (
                          <button
                            type="button"
                            className="btn-move btn-move-blue"
                            disabled={disabled}
                            onClick={() => onAssignTeam(seat.playerId, "blue")}
                            aria-label={`Move ${seat.displayName} to Blue`}
                          >
                            → Blue
                          </button>
                        )}
                        {teamId !== null && (
                          <button
                            type="button"
                            className="btn-move btn-move-spectator"
                            disabled={disabled}
                            onClick={() => onAssignTeam(seat.playerId, null)}
                            aria-label={`Move ${seat.displayName} to Spectators`}
                          >
                            → Spec
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
