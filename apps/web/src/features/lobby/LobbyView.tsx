import type {
  ClientCommand,
  ClientProjection,
  SeatRole,
  TeamId
} from "@cipher-party/protocol";
import type { RoomConnectionState } from "../../lib/room-socket";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import { CopyInviteButton } from "../../components/CopyInviteButton";
import { TeamPanel } from "../../components/TeamPanel";

export interface LobbyViewProps {
  projection: ClientProjection;
  connectionState: RoomConnectionState;
  onSendCommand: (command: ClientCommand) => void;
  isCommandPending?: boolean;
}

export function LobbyView({
  projection,
  connectionState,
  onSendCommand,
  isCommandPending = false
}: LobbyViewProps) {
  const isHost = projection.viewer.isHost;

  const redSeats = projection.seats.filter((s) => s.teamId === "red");
  const blueSeats = projection.seats.filter((s) => s.teamId === "blue");
  const spectatorSeats = projection.seats.filter((s) => s.teamId === null);

  const redClueGivers = redSeats.filter((s) => s.role === "clue-giver").length;
  const redOperatives = redSeats.filter((s) => s.role === "operative").length;
  const blueClueGivers = blueSeats.filter(
    (s) => s.role === "clue-giver"
  ).length;
  const blueOperatives = blueSeats.filter((s) => s.role === "operative").length;

  const canStart =
    redClueGivers >= 1 &&
    redOperatives >= 1 &&
    blueClueGivers >= 1 &&
    blueOperatives >= 1;

  function handleAssignTeam(playerId: string, teamId: TeamId | null) {
    onSendCommand({
      type: "assign_seat",
      playerId,
      teamId
    });
  }

  function handleAssignRole(playerId: string, role: SeatRole) {
    onSendCommand({
      type: "set_role",
      playerId,
      role
    });
  }

  function handleRandomizeTeams() {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const confirmed = window.confirm(
        "Randomize teams? This will shuffle current assignments."
      );
      if (!confirmed) {
        return;
      }
    }
    onSendCommand({
      type: "randomize_teams"
    });
  }

  function handleToggleLock() {
    onSendCommand({
      type: "lock_room",
      locked: !projection.locked
    });
  }

  function handleStartBoard() {
    onSendCommand({
      type: "start_board"
    });
  }

  return (
    <div className="lobby-container">
      <header className="lobby-header">
        <div className="lobby-title-bar">
          <div>
            <span className="eyebrow">Room Code</span>
            <h1 className="room-code">{projection.code}</h1>
          </div>
          <div className="lobby-header-actions">
            <ConnectionBadge state={connectionState} />
            <CopyInviteButton inviteUrl={projection.inviteUrl} />
          </div>
        </div>

        {projection.locked && (
          <div className="lobby-alert-locked" role="status">
            🔒 Room is locked. New players cannot join.
          </div>
        )}
      </header>

      <main className="lobby-main">
        <div className="teams-grid">
          <TeamPanel
            teamId="red"
            title="Red Team (Ruby)"
            seats={redSeats}
            viewerId={projection.viewer.playerId}
            isHost={isHost}
            disabled={isCommandPending}
            onAssignTeam={handleAssignTeam}
            onAssignRole={handleAssignRole}
          />

          <TeamPanel
            teamId="blue"
            title="Blue Team (Cobalt)"
            seats={blueSeats}
            viewerId={projection.viewer.playerId}
            isHost={isHost}
            disabled={isCommandPending}
            onAssignTeam={handleAssignTeam}
            onAssignRole={handleAssignRole}
          />

          <TeamPanel
            teamId={null}
            title="Spectators & Unassigned"
            seats={spectatorSeats}
            viewerId={projection.viewer.playerId}
            isHost={isHost}
            disabled={isCommandPending}
            onAssignTeam={handleAssignTeam}
            onAssignRole={handleAssignRole}
          />
        </div>

        {isHost && (
          <section className="host-controls-card" aria-label="Host Controls">
            <h2 className="host-controls-title">Host Operations</h2>
            <div className="host-buttons">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isCommandPending}
                onClick={handleRandomizeTeams}
              >
                Randomize Teams
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isCommandPending}
                onClick={handleToggleLock}
              >
                {projection.locked ? "Unlock Room" : "Lock Room"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-start"
                disabled={!canStart || isCommandPending}
                onClick={handleStartBoard}
              >
                Start Game
              </button>
            </div>
            {!canStart && (
              <p className="start-requirement-hint" role="note">
                Each team must have at least one clue-giver and one operative to
                start.
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
