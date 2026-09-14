import type {
  ClientCommand,
  ClientProjection,
  CommandErrorCode,
  CommandResult,
} from "@cipher-party/protocol";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, joinRoom, normalizeRoomCodeInput } from "../../lib/api";
import {
  RoomSocket,
  type RoomConnectionError,
  type RoomConnectionSnapshot,
  type RoomConnectionState,
} from "../../lib/room-socket";
import type { SeatCredentials, SeatStore } from "../../lib/seat-store";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const CONNECTION_ERROR_MESSAGES: Record<RoomConnectionError, string> = {
  credential_invalid:
    "This saved seat is no longer valid. You can forget it and rejoin.",
  room_unavailable:
    "This room is no longer available. You can forget this seat and use another room code.",
  room_expired:
    "This room has expired. You can forget this seat and start or join another room.",
  connection_rejected:
    "This room connection was rejected. You can forget this seat and rejoin.",
};

const COMMAND_ERROR_MESSAGES: Record<CommandErrorCode, string> = {
  invalid_command: "The room could not understand that action.",
  unauthorized: "You no longer have permission to do that.",
  wrong_phase: "That action is not available right now.",
  stale_revision: "The room changed before that action completed. Try again.",
  storage_failed: "The room could not save that action. Try again.",
  room_locked: "The room is locked to new seats.",
  room_full:
    "The room is full, or its remaining capacity is reserved for a possible team elimination.",
};

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
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(
    code === null ? "This invite does not contain a valid room code." : null,
  );
  const socketRef = useRef<RoomSocketClient | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const joinGenerationRef = useRef<number | null>(null);
  const discardGenerationRef = useRef<number | null>(null);
  const pendingCommandRef = useRef<PendingCommand | null>(null);
  const projectionSequenceRef = useRef(0);
  const lastProjectionRef = useRef<ClientProjection | null>(null);
  const lastResultRef = useRef<CommandResult | null>(null);

  useLayoutEffect(() => {
    lifecycleGenerationRef.current += 1;
    return () => {
      lifecycleGenerationRef.current += 1;
    };
  }, [code]);

  useEffect(() => {
    let current = true;
    setCredentials(null);
    setSnapshot({ connection: "idle", projection: null, lastResult: null });
    setPending(false);
    setJoining(false);
    setDiscarding(false);
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
    let connectionError: RoomConnectionError | null = null;
    let connectionState: RoomConnectionState = "idle";
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
      connectionError = nextSnapshot.error ?? null;
      connectionState = nextSnapshot.connection;
      if (connectionError !== null) {
        pendingCommandRef.current = null;
        setPending(false);
        setError(CONNECTION_ERROR_MESSAGES[connectionError]);
        return;
      }
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
          setError(COMMAND_ERROR_MESSAGES[tracked.result.code]);
        }
      }
    });
    void socket.connect(credentials).catch((connectError) => {
      if (
        current &&
        connectionError === null &&
        connectionState !== "reconnecting"
      ) {
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
      const generation = lifecycleGenerationRef.current;
      if (code === null || joinGenerationRef.current === generation) {
        return;
      }
      const trimmedName = displayName.trim();
      if (trimmedName === "") {
        setError("Enter a display name to join the room.");
        return;
      }
      joinGenerationRef.current = generation;
      setJoining(true);
      setError(null);
      try {
        const joined = await joinRoom(code, trimmedName, asSpectator);
        if (lifecycleGenerationRef.current !== generation) {
          return;
        }
        const nextCredentials: SeatCredentials = {
          code: joined.code,
          playerId: joined.playerId,
          seatToken: joined.seatToken,
        };
        await seatStore.put(nextCredentials);
        if (lifecycleGenerationRef.current !== generation) {
          return;
        }
        setCredentials(nextCredentials);
        setCredentialStatus("ready");
        if (lifecycleGenerationRef.current !== generation) {
          return;
        }
        await navigate(`/room/${joined.code}`, { replace: true });
      } catch (joinError) {
        if (lifecycleGenerationRef.current === generation) {
          setError(publicError(joinError));
        }
      } finally {
        if (
          lifecycleGenerationRef.current === generation &&
          joinGenerationRef.current === generation
        ) {
          joinGenerationRef.current = null;
          setJoining(false);
        }
      }
    },
    [code, navigate, seatStore],
  );

  const discardCredentials = useCallback(async () => {
    const generation = lifecycleGenerationRef.current;
    if (code === null || discardGenerationRef.current === generation) {
      return;
    }
    discardGenerationRef.current = generation;
    setDiscarding(true);
    setError(null);
    try {
      await seatStore.delete(code);
      if (lifecycleGenerationRef.current !== generation) {
        return;
      }
      setCredentials(null);
      setCredentialStatus("missing");
      setSnapshot({ connection: "idle", projection: null, lastResult: null });
      setError(null);
    } catch {
      if (lifecycleGenerationRef.current === generation) {
        setError("The saved seat could not be removed from this device.");
      }
    } finally {
      if (
        lifecycleGenerationRef.current === generation &&
        discardGenerationRef.current === generation
      ) {
        discardGenerationRef.current = null;
        setDiscarding(false);
      }
    }
  }, [code, seatStore]);

  return {
    code,
    credentialStatus,
    connection: snapshot.connection,
    projection: snapshot.projection,
    lastResult: snapshot.lastResult,
    pending: pending || joining || discarding,
    error,
    join,
    discardCredentials,
    send,
  };
}
