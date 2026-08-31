import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  createRoom,
  joinRoom,
  normalizeRoomCodeInput,
} from "../../lib/api";
import type { SeatStore } from "../../lib/seat-store";

interface HomePageProps {
  seatStore: SeatStore;
}

type PendingAction = "create" | "join" | null;

function publicMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Cipher Party could not complete that request. Please try again.";
}

export function HomePage({ seatStore }: HomePageProps) {
  const navigate = useNavigate();
  const errorRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  const showError = (message: string) => {
    setError(message);
    window.setTimeout(() => errorRef.current?.focus(), 0);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending !== null) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("create-display-name") ?? "").trim();
    if (displayName === "") {
      showError("Enter a display name to create a room.");
      return;
    }
    setError(null);
    setPending("create");
    try {
      const room = await createRoom(displayName);
      await seatStore.put({
        code: room.code,
        playerId: room.playerId,
        seatToken: room.seatToken,
        hostToken: room.hostToken,
      });
      await navigate(`/room/${room.code}`);
    } catch (requestError) {
      showError(publicMessage(requestError));
    } finally {
      setPending(null);
    }
  };

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending !== null) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const code = normalizeRoomCodeInput(String(form.get("room-code") ?? ""));
    const displayName = String(form.get("join-display-name") ?? "").trim();
    if (code === null) {
      showError("Room codes use six ASCII letters or numbers.");
      return;
    }
    if (displayName === "") {
      showError("Enter a display name to join the room.");
      return;
    }
    setError(null);
    setPending("join");
    try {
      const room = await joinRoom(code, displayName, false);
      await seatStore.put({
        code: room.code,
        playerId: room.playerId,
        seatToken: room.seatToken,
      });
      await navigate(`/room/${room.code}`);
    } catch (requestError) {
      showError(publicMessage(requestError));
    } finally {
      setPending(null);
    }
  };

  return (
    <main className="app-shell home-shell">
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Cipher Party home">
          <span aria-hidden="true" className="wordmark-mark">
            CP
          </span>
          <span>Cipher Party</span>
        </a>
        <span className="privacy-note">Private rooms · No account</span>
      </header>

      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">Private word-association games</p>
        <h1 id="home-title">Open the archive. Find the connection.</h1>
        <p className="lede">
          Bring your friends, split into two teams, and uncover a shared field
          of clues. Your invite stays private and your seat stays on this
          device.
        </p>
      </section>

      {error === null ? null : (
        <div
          className="error-summary"
          role="alert"
          ref={errorRef}
          tabIndex={-1}
        >
          <strong>We could not continue.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="entry-table" aria-label="Room entry desk">
        <form
          className="entry-card entry-card-primary"
          aria-labelledby="create-room-title"
          onSubmit={(event) => void handleCreate(event)}
        >
          <div>
            <p className="card-index" aria-hidden="true">
              File 01
            </p>
            <h2 id="create-room-title">Create Room</h2>
            <p>
              Start a new private table and receive an invite for your crew.
            </p>
          </div>
          <label htmlFor="create-display-name">Your display name</label>
          <input
            id="create-display-name"
            name="create-display-name"
            autoComplete="nickname"
            required
          />
          <button type="submit" disabled={pending !== null}>
            {pending === "create" ? "Creating room…" : "Create Room"}
          </button>
        </form>

        <form
          className="entry-card"
          aria-labelledby="join-room-title"
          onSubmit={(event) => void handleJoin(event)}
        >
          <div>
            <p className="card-index" aria-hidden="true">
              File 02
            </p>
            <h2 id="join-room-title">Join Room</h2>
            <p>Enter the six-character code a host shared with you.</p>
          </div>
          <label htmlFor="room-code">Room code</label>
          <input
            id="room-code"
            name="room-code"
            autoComplete="off"
            autoCapitalize="characters"
            inputMode="text"
            spellCheck={false}
            maxLength={12}
            required
          />
          <label htmlFor="join-display-name">Join display name</label>
          <input
            id="join-display-name"
            name="join-display-name"
            autoComplete="nickname"
            required
          />
          <button
            className="button-secondary"
            type="submit"
            disabled={pending !== null}
          >
            {pending === "join" ? "Joining room…" : "Join Room"}
          </button>
        </form>
      </div>

      <p className="trust-line">
        <span aria-hidden="true">✦</span> Voice chat stays wherever your group
        already talks.
      </p>
    </main>
  );
}
