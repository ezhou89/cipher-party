import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientCommand,
  ClientProjection,
  CommandResult
} from "@cipher-party/protocol";
import {
  RoomSocket,
  type RoomConnectionState,
  type RoomSocketOptions
} from "../../lib/room-socket";
import {
  createSeatStore,
  type SeatCredentials,
  type SeatStore
} from "../../lib/seat-store";

const defaultSeatStore = createSeatStore();

export interface UseRoomOptions extends RoomSocketOptions {
  seatStore?: SeatStore;
}

export function useRoom(
  code: string | undefined,
  options: UseRoomOptions = {}
) {
  const seatStore = options.seatStore ?? defaultSeatStore;
  const [credentials, setCredentials] = useState<SeatCredentials | null>(null);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [connection, setConnection] = useState<RoomConnectionState>("idle");
  const [projection, setProjection] = useState<ClientProjection | null>(null);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);
  const [isCommandPending, setIsCommandPending] = useState(false);

  const socketRef = useRef<RoomSocket | null>(null);

  // Load credentials from IndexedDB on mount / code change
  useEffect(() => {
    let active = true;

    if (!code) {
      setCredentials(null);
      setLoadingCredentials(false);
      return;
    }

    setLoadingCredentials(true);
    seatStore
      .get(code)
      .then((creds) => {
        if (!active) return;
        setCredentials(creds ?? null);
        setLoadingCredentials(false);
      })
      .catch(() => {
        if (!active) return;
        setCredentials(null);
        setLoadingCredentials(false);
      });

    return () => {
      active = false;
    };
  }, [code, seatStore]);

  // Connect socket once credentials are ready
  useEffect(() => {
    if (!credentials) {
      return;
    }

    const socket = new RoomSocket(options);
    socketRef.current = socket;

    const unsubscribe = socket.subscribe((state) => {
      setConnection(state.connection);
      setProjection(state.projection);
      setLastResult(state.lastResult);

      if (state.lastResult !== null) {
        setIsCommandPending(false);
      }
    });

    socket.connect(credentials).catch(() => {
      // Reconnection logic inside RoomSocket handles retries
    });

    return () => {
      unsubscribe();
      socket.close();
      socketRef.current = null;
    };
  }, [credentials]);

  const send = useCallback((command: ClientCommand) => {
    const socket = socketRef.current;
    if (!socket) {
      throw new Error("Cannot send command: socket not connected");
    }
    setIsCommandPending(true);
    return socket.send(command);
  }, []);

  const setManualCredentials = useCallback((creds: SeatCredentials) => {
    setCredentials(creds);
  }, []);

  return {
    code,
    credentials,
    loadingCredentials,
    needsJoin: !loadingCredentials && credentials === null,
    connection,
    projection,
    lastResult,
    isCommandPending,
    send,
    setCredentials: setManualCredentials
  };
}
