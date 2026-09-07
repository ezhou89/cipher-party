import { useState, useRef, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  createRoom,
  joinRoom,
  normalizeRoomCode,
  ApiRequestError
} from "../../lib/api";
import { createSeatStore, type SeatStore } from "../../lib/seat-store";

const defaultSeatStore = createSeatStore();

export interface HomePageProps {
  seatStore?: SeatStore;
  baseUrl?: string;
}

export function HomePage({
  seatStore = defaultSeatStore,
  baseUrl = ""
}: HomePageProps) {
  const navigate = useNavigate();

  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [asSpectator, setAsSpectator] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errorMessage && errorRef.current) {
      errorRef.current.focus();
    }
  }, [errorMessage]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = createName.trim();
    if (!trimmed) {
      setErrorMessage("Display name cannot be empty");
      return;
    }

    setErrorMessage(null);
    setCreateLoading(true);
    try {
      const result = await createRoom(trimmed, baseUrl);
      await seatStore.put({
        code: result.code,
        playerId: result.playerId,
        seatToken: result.seatToken,
        hostToken: result.hostToken
      });
      navigate(`/room/${result.code}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to create room"
        );
      }
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    const trimmedName = joinName.trim();
    const normalizedCode = normalizeRoomCode(joinCode);

    if (!normalizedCode) {
      setErrorMessage("Room code is required");
      return;
    }
    if (!trimmedName) {
      setErrorMessage("Display name cannot be empty");
      return;
    }

    setErrorMessage(null);
    setJoinLoading(true);
    try {
      const result = await joinRoom(
        normalizedCode,
        trimmedName,
        asSpectator,
        baseUrl
      );
      await seatStore.put({
        code: normalizedCode,
        playerId: result.playerId,
        seatToken: result.seatToken
      });
      navigate(`/room/${normalizedCode}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to join room"
        );
      }
    } finally {
      setJoinLoading(false);
    }
  }

  return (
    <div className="home-container">
      <header className="home-header">
        <p className="eyebrow">Private Multiplayer</p>
        <h1 className="title">Cipher Party</h1>
        <p className="subtitle">Word and picture association game</p>
      </header>

      {errorMessage && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="error-summary"
          aria-live="assertive"
        >
          {errorMessage}
        </div>
      )}

      <main className="home-cards">
        <section className="home-card" aria-labelledby="create-heading">
          <h2 id="create-heading">Create Room</h2>
          <p className="card-desc">Start a new private game as the host.</p>
          <form onSubmit={handleCreate} className="home-form">
            <div className="form-group">
              <label htmlFor="create-name">Your Name</label>
              <input
                id="create-name"
                name="displayName"
                type="text"
                autoComplete="nickname"
                maxLength={24}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Agent Phoenix"
                disabled={createLoading}
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createLoading}
            >
              {createLoading ? "Creating..." : "Create Room"}
            </button>
          </form>
        </section>

        <section className="home-card" aria-labelledby="join-heading">
          <h2 id="join-heading">Join Room</h2>
          <p className="card-desc">Enter an invite code to join friends.</p>
          <form onSubmit={handleJoin} className="home-form">
            <div className="form-group">
              <label htmlFor="join-code">Room Code</label>
              <input
                id="join-code"
                name="roomCode"
                type="text"
                maxLength={16}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="6-character code"
                disabled={joinLoading}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="join-name">Your Name</label>
              <input
                id="join-name"
                name="displayName"
                type="text"
                autoComplete="nickname"
                maxLength={24}
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="e.g. Operative Shadow"
                disabled={joinLoading}
                required
              />
            </div>
            <div className="form-group form-check">
              <label htmlFor="join-spectator" className="checkbox-label">
                <input
                  id="join-spectator"
                  name="asSpectator"
                  type="checkbox"
                  checked={asSpectator}
                  onChange={(e) => setAsSpectator(e.target.checked)}
                  disabled={joinLoading}
                />
                Join as Spectator
              </label>
            </div>
            <button
              type="submit"
              className="btn btn-secondary"
              disabled={joinLoading}
            >
              {joinLoading ? "Joining..." : "Join Room"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
