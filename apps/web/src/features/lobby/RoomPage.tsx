import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { joinRoom, ApiRequestError } from "../../lib/api";
import { createSeatStore, type SeatStore } from "../../lib/seat-store";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import { LobbyView } from "./LobbyView";
import { GameView } from "../game/GameView";
import { useRoom, type UseRoomOptions } from "./useRoom";

const defaultSeatStore = createSeatStore();

export interface RoomPageProps {
  seatStore?: SeatStore;
  roomOptions?: UseRoomOptions;
  baseUrl?: string;
}

export function RoomPage({
  seatStore = defaultSeatStore,
  roomOptions,
  baseUrl = ""
}: RoomPageProps) {
  const { code } = useParams<{ code: string }>();

  const {
    loadingCredentials,
    needsJoin,
    connection,
    projection,
    isCommandPending,
    send,
    setCredentials
  } = useRoom(code, { seatStore, ...roomOptions });

  const [joinName, setJoinName] = useState("");
  const [asSpectator, setAsSpectator] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  if (!code) {
    return (
      <div className="room-error-page">
        <h2>Invalid Room Code</h2>
        <p>No room code was specified in the URL.</p>
      </div>
    );
  }

  if (loadingCredentials) {
    return (
      <div className="room-loading" role="status" aria-live="polite">
        <p>Loading credentials...</p>
      </div>
    );
  }

  if (needsJoin) {
    async function handleJoinSubmit(e: FormEvent) {
      e.preventDefault();
      const trimmed = joinName.trim();
      if (!trimmed) {
        setJoinError("Display name cannot be empty");
        return;
      }
      setJoinError(null);
      setJoinLoading(true);

      try {
        const result = await joinRoom(code!, trimmed, asSpectator, baseUrl);
        const creds = {
          code: code!,
          playerId: result.playerId,
          seatToken: result.seatToken
        };
        await seatStore.put(creds);
        setCredentials(creds);
      } catch (err) {
        if (err instanceof ApiRequestError) {
          setJoinError(err.message);
        } else {
          setJoinError(
            err instanceof Error ? err.message : "Failed to join room"
          );
        }
      } finally {
        setJoinLoading(false);
      }
    }

    return (
      <div className="home-container">
        <main className="home-card" aria-labelledby="join-room-title">
          <h2 id="join-room-title">Join Room {code}</h2>
          <p className="card-desc">
            Enter your name to join this private room.
          </p>

          {joinError && (
            <div role="alert" className="error-summary" tabIndex={-1}>
              {joinError}
            </div>
          )}

          <form onSubmit={handleJoinSubmit} className="home-form">
            <div className="form-group">
              <label htmlFor="room-page-name">Your Name</label>
              <input
                id="room-page-name"
                name="displayName"
                type="text"
                autoComplete="nickname"
                maxLength={24}
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="e.g. Agent Shadow"
                disabled={joinLoading}
                required
              />
            </div>
            <div className="form-group form-check">
              <label htmlFor="room-page-spectator" className="checkbox-label">
                <input
                  id="room-page-spectator"
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
              className="btn btn-primary"
              disabled={joinLoading}
            >
              {joinLoading ? "Joining..." : "Join Room"}
            </button>
          </form>
        </main>
      </div>
    );
  }

  if (!projection) {
    return (
      <div
        className="room-connecting-container"
        role="status"
        aria-live="polite"
      >
        <h2 className="title">Connecting to Room {code}...</h2>
        <ConnectionBadge state={connection} />
      </div>
    );
  }

  if (projection.roomPhase === "lobby") {
    return (
      <LobbyView
        projection={projection}
        connectionState={connection}
        onSendCommand={send}
        isCommandPending={isCommandPending}
      />
    );
  }

  return (
    <GameView
      projection={projection}
      connectionState={connection}
      onSendCommand={send}
      isCommandPending={isCommandPending}
    />
  );
}
