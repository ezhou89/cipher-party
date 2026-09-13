import type { ClientCommand, ClientProjection } from "@cipher-party/protocol";
import { useEffect, useRef, useState } from "react";

import { ConnectionBadge } from "../../components/ConnectionBadge";
import { CopyInviteButton } from "../../components/CopyInviteButton";
import { TeamPanel, type TeamPanelIdentity } from "../../components/TeamPanel";
import type { RoomConnectionState } from "../../lib/room-socket";
import { TEAM_PRESENTATION, type TeamId } from "../../lib/team-presentation";

interface LobbyViewProps {
  projection: ClientProjection;
  connection: RoomConnectionState;
  pending: boolean;
  send(command: ClientCommand): void;
}

const WAITING_TEAM: TeamPanelIdentity = {
  id: "waiting",
  label: "Waiting & spectators",
  symbol: "◇",
};

function teamPanelIdentity(teamId: TeamId): TeamPanelIdentity {
  const presentation = TEAM_PRESENTATION[teamId];
  return {
    ...presentation,
    id: teamId,
    label: `${presentation.label} team`,
  };
}

interface SeatPresenceAnnouncerProps {
  roomCode: string;
  seats: ClientProjection["seats"];
  viewerPlayerId: string;
}

interface SeatPresenceSnapshot {
  roomCode: string;
  viewerPlayerId: string;
  connectedByPlayer: Map<string, boolean>;
}

function SeatPresenceAnnouncer({
  roomCode,
  seats,
  viewerPlayerId,
}: SeatPresenceAnnouncerProps) {
  const previousRef = useRef<SeatPresenceSnapshot | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const current: SeatPresenceSnapshot = {
      roomCode,
      viewerPlayerId,
      connectedByPlayer: new Map(
        seats.map((seat) => [seat.playerId, seat.connected]),
      ),
    };
    const previous = previousRef.current;
    previousRef.current = current;
    if (
      previous === null ||
      previous.roomCode !== roomCode ||
      previous.viewerPlayerId !== viewerPlayerId
    ) {
      setAnnouncement("");
      return;
    }
    const changes = seats.flatMap((seat) => {
      if (seat.playerId === viewerPlayerId) {
        return [];
      }
      const wasConnected = previous.connectedByPlayer.get(seat.playerId);
      if (wasConnected === undefined || wasConnected === seat.connected) {
        return [];
      }
      return [
        seat.connected
          ? `${seat.displayName} reconnected.`
          : `${seat.displayName} went offline.`,
      ];
    });
    if (changes.length > 0) {
      setAnnouncement(changes.join(" "));
    }
  }, [roomCode, seats, viewerPlayerId]);

  return (
    <span
      className="visually-hidden"
      role="status"
      aria-label="Seat connection updates"
      aria-live="polite"
      aria-atomic="true"
    >
      {announcement}
    </span>
  );
}

function roleLabel(role: ClientProjection["viewer"]["role"]): string {
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

function viewerAssignment(projection: ClientProjection): string {
  if (projection.viewer.role === "spectator") {
    return "You are a Spectator";
  }
  const team =
    projection.viewer.teamId === null
      ? "Waiting"
      : TEAM_PRESENTATION[projection.viewer.teamId].label;
  return `You are ${team} · ${roleLabel(projection.viewer.role)}`;
}

function startReadiness(projection: ClientProjection): {
  ready: boolean;
  message: string;
} {
  const active = projection.seats.filter((seat) => seat.role !== "spectator");
  const minimumPlayers = projection.teamCount * 2;
  if (active.length < minimumPlayers) {
    return {
      ready: false,
      message: `At least ${minimumPlayers} active players are required for ${projection.teamCount} teams.`,
    };
  }
  if (
    active.some(
      (seat) =>
        !seat.connected ||
        seat.teamId === null ||
        !projection.configuredTeams.includes(seat.teamId) ||
        seat.role === "unassigned",
    )
  ) {
    return {
      ready: false,
      message: "Every active seat must be online and fully assigned.",
    };
  }
  const teams = projection.configuredTeams.map((teamId) =>
    active.filter((seat) => seat.teamId === teamId),
  );
  const sizes = teams.map((team) => team.length);
  if (Math.max(...sizes) - Math.min(...sizes) > 1) {
    const labels = projection.configuredTeams.map(
      (teamId) => TEAM_PRESENTATION[teamId].label,
    );
    const teamList =
      labels.length === 2
        ? labels.join(" and ")
        : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
    return {
      ready: false,
      message: `${teamList} team sizes must differ by no more than one.`,
    };
  }
  for (const team of teams) {
    const clueGivers = team.filter((seat) => seat.role === "clue-giver").length;
    const operatives = team.filter((seat) => seat.role === "operative").length;
    if (clueGivers !== 1 || operatives < 1) {
      return {
        ready: false,
        message:
          "Each team needs exactly one clue-giver and at least one operative.",
      };
    }
  }
  return {
    ready: true,
    message: "Ready: each team has one clue-giver and at least one operative.",
  };
}

export function LobbyView({
  projection,
  connection,
  pending,
  send,
}: LobbyViewProps) {
  const [confirmRandomize, setConfirmRandomize] = useState(false);
  const waitingSeats = projection.seats.filter(
    (seat) => seat.teamId === null || seat.role === "spectator",
  );
  const readiness = startReadiness(projection);
  const controlsDisabled = pending || connection !== "open";
  const showHostControls =
    projection.permissions.configure || projection.permissions.moderate;

  return (
    <main className="app-shell room-shell">
      <header className="room-identity-strip">
        <div>
          <p className="eyebrow">Private arcade · Lobby</p>
          <h1>Room {projection.code}</h1>
        </div>
        <div className="identity-status">
          <strong>{viewerAssignment(projection)}</strong>
          <ConnectionBadge connection={connection} />
        </div>
      </header>

      <section className="invite-strip" aria-labelledby="invite-heading">
        <div>
          <p className="card-index">Squad invite</p>
          <h2 id="invite-heading">Bring your crew to the table</h2>
        </div>
        <CopyInviteButton inviteUrl={projection.inviteUrl} />
      </section>

      <section className="lobby-table" aria-labelledby="lobby-heading">
        <SeatPresenceAnnouncer
          roomCode={projection.code}
          seats={projection.seats}
          viewerPlayerId={projection.viewer.playerId}
        />
        <header className="section-heading">
          <div>
            <p className="card-index">Player select</p>
            <h2 id="lobby-heading">Teams at a glance</h2>
          </div>
          <span className="lock-status">
            {projection.locked ? "Entry locked" : "Entry open"}
          </span>
        </header>
        <div className="team-grid" data-team-count={projection.teamCount}>
          {projection.configuredTeams.map((teamId) => (
            <TeamPanel
              key={teamId}
              identity={teamPanelIdentity(teamId)}
              seats={projection.seats.filter(
                (seat) => seat.teamId === teamId && seat.role !== "spectator",
              )}
            />
          ))}
          <TeamPanel identity={WAITING_TEAM} seats={waitingSeats} />
        </div>
      </section>

      {showHostControls ? (
        <fieldset className="host-controls" aria-label="Host controls">
          <legend>Host controls</legend>
          {projection.permissions.configure ? (
            <div className="team-count-control">
              <label htmlFor="team-count">Number of teams</label>
              <select
                id="team-count"
                value={String(projection.teamCount)}
                disabled={controlsDisabled || projection.locked}
                onChange={(event) =>
                  send({
                    type: "set_team_count",
                    teamCount: Number(event.currentTarget.value) as 2 | 3 | 4,
                  })
                }
              >
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
              <span>Minimum active players: {projection.teamCount * 2}</span>
            </div>
          ) : null}
          <div className="assignment-list">
            {projection.seats.map((seat) => {
              const spectator = seat.role === "spectator";
              return (
                <div className="assignment-row" key={seat.playerId}>
                  <strong>{seat.displayName}</strong>
                  <label>
                    <span>Team for {seat.displayName}</span>
                    <select
                      aria-label={`Team for ${seat.displayName}`}
                      value={seat.teamId ?? ""}
                      disabled={controlsDisabled || spectator}
                      onChange={(event) =>
                        send({
                          type: "assign_seat",
                          playerId: seat.playerId,
                          teamId:
                            event.currentTarget.value === ""
                              ? null
                              : (event.currentTarget.value as TeamId),
                        })
                      }
                    >
                      <option value="">Waiting</option>
                      {projection.configuredTeams.map((teamId) => (
                        <option key={teamId} value={teamId}>
                          {TEAM_PRESENTATION[teamId].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Role for {seat.displayName}</span>
                    <select
                      aria-label={`Role for ${seat.displayName}`}
                      value={seat.role}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        send({
                          type: "set_role",
                          playerId: seat.playerId,
                          role: event.currentTarget.value as
                            | "unassigned"
                            | "clue-giver"
                            | "operative"
                            | "spectator",
                        })
                      }
                    >
                      <option value="unassigned">Unassigned</option>
                      <option value="clue-giver">Clue-giver</option>
                      <option value="operative">Operative</option>
                      <option value="spectator">Spectator</option>
                    </select>
                  </label>
                </div>
              );
            })}
          </div>

          <div className="host-action-bar">
            {confirmRandomize ? (
              <div
                className="confirm-inline"
                role="group"
                aria-label="Confirm random team assignment"
              >
                <span>Replace every active team assignment?</span>
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => {
                    setConfirmRandomize(false);
                    send({ type: "randomize_teams" });
                  }}
                >
                  Confirm randomize teams
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => setConfirmRandomize(false)}
                >
                  Cancel randomize
                </button>
              </div>
            ) : (
              <button
                className="button-secondary"
                type="button"
                disabled={controlsDisabled}
                onClick={() => setConfirmRandomize(true)}
              >
                Randomize teams
              </button>
            )}
            <button
              className="button-secondary"
              type="button"
              disabled={controlsDisabled}
              onClick={() =>
                send({ type: "lock_room", locked: !projection.locked })
              }
            >
              {projection.locked ? "Unlock room" : "Lock room"}
            </button>
            <div className="start-control">
              <button
                type="button"
                aria-describedby="start-readiness"
                disabled={controlsDisabled || !readiness.ready}
                onClick={() => send({ type: "start_board" })}
              >
                Start board
              </button>
              <p id="start-readiness">{readiness.message}</p>
            </div>
          </div>
        </fieldset>
      ) : null}
    </main>
  );
}
