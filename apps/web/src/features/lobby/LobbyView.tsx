import type { ClientCommand, ClientProjection } from "@cipher-party/protocol";
import { useState } from "react";

import { ConnectionBadge } from "../../components/ConnectionBadge";
import { CopyInviteButton } from "../../components/CopyInviteButton";
import { TeamPanel, type TeamPanelIdentity } from "../../components/TeamPanel";
import type { RoomConnectionState } from "../../lib/room-socket";

interface LobbyViewProps {
  projection: ClientProjection;
  connection: RoomConnectionState;
  pending: boolean;
  send(command: ClientCommand): void;
}

const RED_TEAM: TeamPanelIdentity = {
  id: "red",
  label: "Red team",
  symbol: "◆",
};
const BLUE_TEAM: TeamPanelIdentity = {
  id: "blue",
  label: "Blue team",
  symbol: "●",
};
const WAITING_TEAM: TeamPanelIdentity = {
  id: "waiting",
  label: "Waiting & spectators",
  symbol: "◇",
};

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
    projection.viewer.teamId === "red"
      ? "Red"
      : projection.viewer.teamId === "blue"
        ? "Blue"
        : "Waiting";
  return `You are ${team} · ${roleLabel(projection.viewer.role)}`;
}

function startReadiness(projection: ClientProjection): {
  ready: boolean;
  message: string;
} {
  const active = projection.seats.filter((seat) => seat.role !== "spectator");
  if (
    active.some(
      (seat) =>
        !seat.connected || seat.teamId === null || seat.role === "unassigned",
    )
  ) {
    return {
      ready: false,
      message: "Every active seat must be online and fully assigned.",
    };
  }
  const red = active.filter((seat) => seat.teamId === "red");
  const blue = active.filter((seat) => seat.teamId === "blue");
  if (Math.abs(red.length - blue.length) > 1) {
    return {
      ready: false,
      message: "Red and Blue team sizes must differ by no more than one.",
    };
  }
  for (const team of [red, blue]) {
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
  const redSeats = projection.seats.filter(
    (seat) => seat.teamId === "red" && seat.role !== "spectator",
  );
  const blueSeats = projection.seats.filter(
    (seat) => seat.teamId === "blue" && seat.role !== "spectator",
  );
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
          <p className="eyebrow">Private archive table</p>
          <h1>Room {projection.code}</h1>
        </div>
        <div className="identity-status">
          <strong>{viewerAssignment(projection)}</strong>
          <ConnectionBadge connection={connection} />
        </div>
      </header>

      <section className="invite-strip" aria-labelledby="invite-heading">
        <div>
          <p className="card-index">Invite file</p>
          <h2 id="invite-heading">Bring your crew to the table</h2>
        </div>
        <CopyInviteButton inviteUrl={projection.inviteUrl} />
      </section>

      <section className="lobby-table" aria-labelledby="lobby-heading">
        <header className="section-heading">
          <div>
            <p className="card-index">Seat manifest</p>
            <h2 id="lobby-heading">Teams at a glance</h2>
          </div>
          <span className="lock-status">
            {projection.locked ? "Entry locked" : "Entry open"}
          </span>
        </header>
        <div className="team-grid">
          <TeamPanel identity={RED_TEAM} seats={redSeats} />
          <TeamPanel identity={BLUE_TEAM} seats={blueSeats} />
          <TeamPanel identity={WAITING_TEAM} seats={waitingSeats} />
        </div>
      </section>

      {showHostControls ? (
        <fieldset className="host-controls" aria-label="Host controls">
          <legend>Host controls</legend>
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
                              : (event.currentTarget.value as "red" | "blue"),
                        })
                      }
                    >
                      <option value="">Waiting</option>
                      <option value="red">Red</option>
                      <option value="blue">Blue</option>
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
