import type {
  ClientCommand,
  ClientProjection,
  CommandResult,
} from "@cipher-party/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, joinRoom, normalizeRoomCodeInput } from "../../lib/api";
import {
  RoomSocket,
  type RoomConnectionSnapshot,
  type RoomConnectionState,
} from "../../lib/room-socket";
import type { SeatCredentials, SeatStore } from "../../lib/seat-store";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface RoomSocketClient {
  connect(credentials: SeatCredentials): Promise<void>;
  send(command: ClientCommand): string;
  close(): void;
  subscribe(listener: (snapshot: RoomConnectionSnapshot) => void): () => void;
}

export interface UseRoomDependencies {
  seatStore: SeatStore;
  createRoomSocket?: () => RoomSocketClient;
}

type CredentialStatus = "loading" | "missing" | "invalid" | "ready";

interface PendingCommand {
  projectionSequenceAtSend: number;
  resultAtSend: CommandResult | null;
  result: CommandResult | null;
}

export interface UseRoomValue {
  code: string | null;
  credentialStatus: CredentialStatus;
  connection: RoomConnectionState;
  projection: ClientProjection | null;
  lastResult: CommandResult | null;
  pending: boolean;
  error: string | null;
  join(displayName: string, asSpectator: boolean): Promise<void>;
  discardCredentials(): Promise<void>;
  send(command: ClientCommand): void;
}

function defaultRoomSocket(): RoomSocketClient {
  return new RoomSocket();
}

function isSeatCredentials(
  value: SeatCredentials | undefined,
  code: string,
): value is SeatCredentials {
  if (value === undefined) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  const expectedLength = record.hostToken === undefined ? 3 : 4;
  return (
    keys.length === expectedLength &&
    record.code === code &&
    typeof record.playerId === "string" &&
    record.playerId.length > 0 &&
    typeof record.seatToken === "string" &&
    TOKEN_PATTERN.test(record.seatToken) &&
    (record.hostToken === undefined ||
      (typeof record.hostToken === "string" &&
        TOKEN_PATTERN.test(record.hostToken)))
  );
}

function publicError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "The room connection could not be opened. You can discard this seat and rejoin.";
}

export function useRoom({
  seatStore,
  createRoomSocket = defaultRoomSocket,
}: UseRoomDependencies): UseRoomValue {
  const { code: routeCode = "" } = useParams();
  const navigate = useNavigate();
  const code = normalizeRoomCodeInput(routeCode);
  const [credentialStatus, setCredentialStatus] =
    useState<CredentialStatus>("loading");
  const [credentials, setCredentials] = useState<SeatCredentials | null>(null);
  const [snapshot, setSnapshot] = useState<RoomConnectionSnapshot>({
    connection: "idle",
    projection: null,
    lastResult: null,
  });
  const [pending, setPending] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(
    code === null ? "This invite does not contain a valid room code." : null,
  );
  const socketRef = useRef<RoomSocketClient | null>(null);
  const pendingCommandRef = useRef<PendingCommand | null>(null);
  const projectionSequenceRef = useRef(0);
  const lastProjectionRef = useRef<ClientProjection | null>(null);
  const lastResultRef = useRef<CommandResult | null>(null);

  useEffect(() => {
    let current = true;
    setCredentials(null);
    setSnapshot({ connection: "idle", projection: null, lastResult: null });
    setPending(false);
    pendingCommandRef.current = null;
    projectionSequenceRef.current = 0;
    lastProjectionRef.current = null;
    lastResultRef.current = null;
    if (code === null) {
      setCredentialStatus("invalid");
      setError("This invite does not contain a valid room code.");
      return () => {
        current = false;
      };
    }
    setCredentialStatus("loading");
    setError(null);
    void seatStore
      .get(code)
      .then((stored) => {
        if (!current) {
          return;
        }
        if (stored === undefined) {
          setCredentialStatus("missing");
          return;
        }
        if (!isSeatCredentials(stored, code)) {
          setCredentialStatus("invalid");
          return;
        }
        setCredentials(stored);
        setCredentialStatus("ready");
      })
      .catch(() => {
        if (current) {
          setCredentialStatus("invalid");
          setError("The saved seat could not be read on this device.");
        }
      });
    return () => {
      current = false;
    };
  }, [code, seatStore]);

  useEffect(() => {
    if (credentials === null || credentialStatus !== "ready") {
      return;
    }
    let current = true;
    const socket = createRoomSocket();
    socketRef.current = socket;
    const unsubscribe = socket.subscribe((nextSnapshot) => {
      if (!current) {
        return;
      }
      if (nextSnapshot.projection !== lastProjectionRef.current) {
        lastProjectionRef.current = nextSnapshot.projection;
        if (nextSnapshot.projection !== null) {
          projectionSequenceRef.current += 1;
        }
      }
      lastResultRef.current = nextSnapshot.lastResult;
      setSnapshot(nextSnapshot);
      const tracked = pendingCommandRef.current;
      if (tracked === null) {
        return;
      }
      if (nextSnapshot.lastResult !== tracked.resultAtSend) {
        tracked.result = nextSnapshot.lastResult;
      }
      if (
        tracked.result !== null &&
        nextSnapshot.projection !== null &&
        projectionSequenceRef.current > tracked.projectionSequenceAtSend &&
        nextSnapshot.projection.revision >= tracked.result.revision
      ) {
        pendingCommandRef.current = null;
        setPending(false);
        if (!tracked.result.ok) {
          setError(tracked.result.message);
        }
      }
    });
    void socket.connect(credentials).catch((connectError) => {
      if (current) {
        setError(publicError(connectError));
      }
    });
    return () => {
      current = false;
      unsubscribe();
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [createRoomSocket, credentialStatus, credentials]);

  const send = useCallback((command: ClientCommand) => {
    if (pendingCommandRef.current !== null) {
      return;
    }
    const socket = socketRef.current;
    if (socket === null) {
      setError("The room connection is not ready yet.");
      return;
    }
    try {
      socket.send(command);
      pendingCommandRef.current = {
        projectionSequenceAtSend: projectionSequenceRef.current,
        resultAtSend: lastResultRef.current,
        result: null,
      };
      setError(null);
      setPending(true);
    } catch {
      setError(
        "The command could not be sent. Wait for the room to reconnect.",
      );
    }
  }, []);

  const join = useCallback(
    async (displayName: string, asSpectator: boolean) => {
      if (code === null || joining) {
        return;
      }
      const trimmedName = displayName.trim();
      if (trimmedName === "") {
        setError("Enter a display name to join the room.");
        return;
      }
      setJoining(true);
      setError(null);
      try {
        const joined = await joinRoom(code, trimmedName, asSpectator);
        const nextCredentials: SeatCredentials = {
          code: joined.code,
          playerId: joined.playerId,
          seatToken: joined.seatToken,
        };
        await seatStore.put(nextCredentials);
        setCredentials(nextCredentials);
        setCredentialStatus("ready");
        await navigate(`/room/${joined.code}`, { replace: true });
      } catch (joinError) {
        setError(publicError(joinError));
      } finally {
        setJoining(false);
      }
    },
    [code, joining, navigate, seatStore],
  );

  const discardCredentials = useCallback(async () => {
    if (code === null) {
      return;
    }
    try {
      await seatStore.delete(code);
      setCredentials(null);
      setCredentialStatus("missing");
      setSnapshot({ connection: "idle", projection: null, lastResult: null });
      setError(null);
    } catch {
      setError("The saved seat could not be removed from this device.");
    }
  }, [code, seatStore]);

  return {
    code,
    credentialStatus,
    connection: snapshot.connection,
    projection: snapshot.projection,
    lastResult: snapshot.lastResult,
    pending: pending || joining,
    error,
    join,
    discardCredentials,
    send,
  };
}
