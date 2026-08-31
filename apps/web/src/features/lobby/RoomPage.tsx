import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import type { SeatStore } from "../../lib/seat-store";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import { LobbyView } from "./LobbyView";
import { useRoom, type RoomSocketClient } from "./useRoom";

interface RoomPageProps {
  seatStore: SeatStore;
  createRoomSocket?: () => RoomSocketClient;
}

export function RoomPage({ seatStore, createRoomSocket }: RoomPageProps) {
  const room = useRoom({
    seatStore,
    ...(createRoomSocket === undefined ? {} : { createRoomSocket }),
  });
  const errorRef = useRef<HTMLDivElement>(null);
  const [asSpectator, setAsSpectator] = useState(false);

  useEffect(() => {
    if (room.error !== null) {
      errorRef.current?.focus();
    }
  }, [room.error]);

  const submitJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void room.join(String(form.get("display-name") ?? ""), asSpectator);
  };

  if (room.code === null) {
    return (
      <main className="app-shell room-shell room-message">
        <p className="eyebrow">Invite unavailable</p>
        <h1>That room code is not valid</h1>
        <div
          className="error-summary"
          role="alert"
          ref={errorRef}
          tabIndex={-1}
        >
          Room codes use six ASCII letters or numbers.
        </div>
        <Link className="text-link" to="/">
          Return home
        </Link>
      </main>
    );
  }

  if (room.credentialStatus === "loading") {
    return (
      <main className="app-shell room-shell room-message">
        <p className="eyebrow">Private room</p>
        <h1>Room {room.code}</h1>
        <ConnectionBadge connection="idle" />
        <p>Checking this device for your saved seat…</p>
      </main>
    );
  }

  if (room.credentialStatus === "invalid") {
    return (
      <main className="app-shell room-shell room-message">
        <p className="eyebrow">Seat recovery</p>
        <h1>Saved seat needs attention</h1>
        {room.error === null ? null : (
          <div
            className="error-summary"
            role="alert"
            ref={errorRef}
            tabIndex={-1}
          >
            {room.error}
          </div>
        )}
        <p>
          This device cannot use its saved room credential. Remove it to join as
          a new seat; the host can coordinate recovery separately.
        </p>
        <button
          type="button"
          disabled={room.pending}
          onClick={() => void room.discardCredentials()}
        >
          Forget saved seat and rejoin
        </button>
      </main>
    );
  }

  if (room.credentialStatus === "missing") {
    return (
      <main className="app-shell room-shell join-shell">
        <header className="room-identity-strip">
          <div>
            <p className="eyebrow">Private invitation</p>
            <h1>Room {room.code}</h1>
          </div>
          <Link className="text-link" to="/">
            Use another code
          </Link>
        </header>
        {room.error === null ? null : (
          <div
            className="error-summary"
            role="alert"
            ref={errorRef}
            tabIndex={-1}
          >
            {room.error}
          </div>
        )}
        <form
          className="entry-card invite-join-card"
          aria-label={`Join room ${room.code}`}
          onSubmit={submitJoin}
        >
          <div>
            <p className="card-index">Seat request</p>
            <h2>Choose how you will join</h2>
            <p>Your private seat credential will stay on this device.</p>
          </div>
          <label htmlFor="display-name">Display name</label>
          <input
            id="display-name"
            name="display-name"
            autoComplete="nickname"
            required
          />
          <fieldset className="join-role-choice">
            <legend>Seat type</legend>
            <label>
              <input
                type="radio"
                name="seat-type"
                checked={!asSpectator}
                onChange={() => setAsSpectator(false)}
              />
              Join as player
            </label>
            <label>
              <input
                type="radio"
                name="seat-type"
                aria-label="Join as spectator"
                checked={asSpectator}
                onChange={() => setAsSpectator(true)}
              />
              Join as spectator
            </label>
          </fieldset>
          <button type="submit" disabled={room.pending}>
            {room.pending ? "Joining room…" : "Join this room"}
          </button>
        </form>
      </main>
    );
  }

  if (room.projection === null) {
    return (
      <main className="app-shell room-shell room-message">
        <p className="eyebrow">Private room</p>
        <h1>Room {room.code}</h1>
        <ConnectionBadge connection={room.connection} />
        {room.error === null ? null : (
          <div
            className="error-summary"
            role="alert"
            ref={errorRef}
            tabIndex={-1}
          >
            {room.error}
          </div>
        )}
        <p>Synchronizing the latest public room state…</p>
        {room.connection === "closed" ? (
          <button
            type="button"
            disabled={room.pending}
            onClick={() => void room.discardCredentials()}
          >
            Forget saved seat and rejoin
          </button>
        ) : null}
      </main>
    );
  }

  if (room.projection.roomPhase === "lobby") {
    return (
      <>
        {room.error === null ? null : (
          <div
            className="floating-error error-summary"
            role="alert"
            ref={errorRef}
            tabIndex={-1}
          >
            {room.error}
          </div>
        )}
        <LobbyView
          projection={room.projection}
          connection={room.connection}
          pending={room.pending}
          send={room.send}
        />
      </>
    );
  }

  return (
    <main className="app-shell room-shell game-route-placeholder">
      <p className="eyebrow">Room {room.projection.code}</p>
      <h1>
        {room.projection.roomPhase === "complete"
          ? "Board complete"
          : "Game in progress"}
      </h1>
      <ConnectionBadge connection={room.connection} />
      <section aria-label="Game table status">
        <p>The authoritative game table is synchronized for this seat.</p>
      </section>
    </main>
  );
}
