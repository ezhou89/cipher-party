import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  type ClientCommand,
  type ClientProjection,
  type CommandEnvelope,
  type CommandResult,
} from "@cipher-party/protocol";

import {
  ApiError,
  requestConnectionTicket,
  roomWebSocketUrl,
  type WebSocketLocation,
} from "./api";
import type { SeatCredentials } from "./seat-store";

export type RoomConnectionState =
  "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type RoomConnectionError =
  | "credential_invalid"
  | "room_unavailable"
  | "room_expired"
  | "connection_rejected";

export interface RoomConnectionSnapshot {
  connection: RoomConnectionState;
  projection: ClientProjection | null;
  lastResult: CommandResult | null;
  error?: RoomConnectionError | null;
}

export interface RoomWebSocket {
  readonly url: string;
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RoomSocketDependencies {
  fetch: typeof fetch;
  createWebSocket(url: string): RoomWebSocket;
  location: WebSocketLocation;
  randomUUID(): string;
  now?(): number;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

interface InFlightCommand {
  envelope: CommandEnvelope;
  serialized: string;
  resultRevision: number | null;
  sentGeneration: number;
  projectionSequenceAtSend: number;
}

const RETRY_DELAYS = [500, 1_000, 2_000, 4_000] as const;
const MAX_RETRY_DELAY = 5_000;
const MAX_TIMER_DELAY = 2_147_483_647;
const OVERLOAD_RETRY_DELAY = 10_000;
const SOCKET_OPEN = 1;

function defaultDependencies(): RoomSocketDependencies {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    createWebSocket: (url) => new WebSocket(url),
    location: window.location,
    randomUUID: () => crypto.randomUUID(),
    now: Date.now,
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (handle) => window.clearTimeout(handle),
  };
}

function copyCredentials(credentials: SeatCredentials): SeatCredentials {
  return credentials.hostToken === undefined
    ? {
        code: credentials.code,
        playerId: credentials.playerId,
        seatToken: credentials.seatToken,
      }
    : { ...credentials };
}

export class RoomSocket {
  readonly #dependencies: RoomSocketDependencies;
  readonly #listeners = new Set<(state: RoomConnectionSnapshot) => void>();
  #connection: RoomConnectionState = "idle";
  #projection: ClientProjection | null = null;
  #lastResult: CommandResult | null = null;
  #error: RoomConnectionError | null = null;
  #credentials: SeatCredentials | null = null;
  #socket: RoomWebSocket | null = null;
  #generation = 0;
  #manualClose = false;
  #retryAttempt = 0;
  #retryTimer: number | null = null;
  #retryDeadline: number | null = null;
  #projectionSequence = 0;
  #inFlight: InFlightCommand | null = null;
  #awaitingFreshProjection = true;

  constructor(dependencies: RoomSocketDependencies = defaultDependencies()) {
    this.#dependencies = dependencies;
  }

  async connect(credentials: SeatCredentials): Promise<void> {
    this.#manualClose = false;
    this.#cancelRetry();
    this.#generation += 1;
    const previous = this.#socket;
    this.#socket = null;
    try {
      previous?.close(1000, "Connection replaced");
    } catch {
      // The generation guard already retired the previous socket.
    }
    this.#credentials = copyCredentials(credentials);
    this.#retryAttempt = 0;
    this.#projection = null;
    this.#lastResult = null;
    this.#error = null;
    this.#projectionSequence = 0;
    this.#inFlight = null;
    this.#awaitingFreshProjection = true;
    this.#setConnection("connecting");
    await this.#open(false);
  }

  send(command: ClientCommand): string {
    if (this.#inFlight !== null) {
      throw new Error("A room command is already in flight");
    }
    if (
      this.#socket === null ||
      this.#socket.readyState !== SOCKET_OPEN ||
      this.#connection !== "open" ||
      this.#projection === null ||
      this.#awaitingFreshProjection
    ) {
      throw new Error("Room connection is not ready");
    }
    const commandId = this.#dependencies.randomUUID();
    const envelope: CommandEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      expectedRevision: this.#projection.revision,
      command,
    };
    const serialized = JSON.stringify(envelope);
    this.#inFlight = {
      envelope,
      serialized,
      resultRevision: null,
      sentGeneration: this.#generation,
      projectionSequenceAtSend: this.#projectionSequence,
    };
    try {
      this.#socket.send(serialized);
    } catch (error) {
      this.#inFlight = null;
      throw error;
    }
    return commandId;
  }

  close(): void {
    this.#manualClose = true;
    this.#generation += 1;
    this.#cancelRetry();
    const socket = this.#socket;
    this.#socket = null;
    try {
      socket?.close(1000, "Closed by user");
    } catch {
      // Manual closure is complete locally even if the transport throws.
    }
    this.#setConnection("closed");
  }

  subscribe(listener: (state: RoomConnectionSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot());
    return () => this.#listeners.delete(listener);
  }

  async #open(reconnecting: boolean): Promise<void> {
    const credentials = this.#credentials;
    if (credentials === null || this.#manualClose) {
      return;
    }
    const generation = ++this.#generation;
    if (reconnecting) {
      this.#setConnection("reconnecting");
    }
    let ticket: Awaited<ReturnType<typeof requestConnectionTicket>>;
    try {
      ticket = await requestConnectionTicket(
        credentials,
        this.#dependencies.fetch,
        this.#dependencies.now,
      );
    } catch (error) {
      this.#handleOpenFailure(reconnecting, generation, error);
      throw error;
    }
    if (this.#manualClose || generation !== this.#generation) {
      return;
    }
    let socket: RoomWebSocket;
    try {
      socket = this.#dependencies.createWebSocket(
        roomWebSocketUrl(
          credentials.code,
          ticket.ticket,
          this.#dependencies.location,
        ),
      );
    } catch (error) {
      this.#handleOpenFailure(reconnecting, generation, error);
      throw error;
    }
    this.#socket = socket;
    socket.onopen = () => {
      if (!this.#isCurrent(generation, socket)) {
        return;
      }
      this.#setConnection("open");
    };
    socket.onmessage = (event) => {
      if (!this.#isCurrent(generation, socket)) {
        return;
      }
      this.#handleMessage(event.data, generation, socket);
    };
    socket.onclose = (event) => {
      if (!this.#isCurrent(generation, socket)) {
        return;
      }
      if (event.code === 1008) {
        this.#terminate("connection_rejected");
      } else if (event.code === 1001 && event.reason === "Room expired") {
        this.#terminate("room_expired");
      } else {
        this.#socket = null;
        this.#scheduleReconnect(event.code === 1013 ? OVERLOAD_RETRY_DELAY : 0);
      }
    };
    socket.onerror = () => {
      if (!this.#isCurrent(generation, socket)) {
        return;
      }
      this.#setConnection("reconnecting");
    };
  }

  #handleMessage(
    raw: unknown,
    generation: number,
    socket: RoomWebSocket,
  ): void {
    if (typeof raw !== "string") {
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = ServerMessageSchema.safeParse(value);
    if (!parsed.success) {
      return;
    }
    const message = parsed.data;
    if (message.type === "projection") {
      if (
        this.#projection !== null &&
        message.projection.revision < this.#projection.revision
      ) {
        return;
      }
      this.#projection = message.projection;
      this.#projectionSequence += 1;
      this.#awaitingFreshProjection = false;
      this.#retryAttempt = 0;
      this.#cancelRetry();
      this.#setConnection("open", false);
      const cleared = this.#clearCompletedInFlight();
      if (
        !cleared &&
        this.#inFlight !== null &&
        this.#inFlight.resultRevision === null &&
        this.#inFlight.sentGeneration !== generation &&
        socket.readyState === SOCKET_OPEN
      ) {
        socket.send(this.#inFlight.serialized);
        this.#inFlight.sentGeneration = generation;
        this.#inFlight.projectionSequenceAtSend = this.#projectionSequence;
      }
      this.#notify();
      return;
    }
    if (message.type === "command_result") {
      this.#lastResult = message.result;
      if (this.#inFlight?.envelope.commandId === message.commandId) {
        this.#inFlight.resultRevision = message.result.revision;
        this.#clearCompletedInFlight();
      }
      this.#notify();
    }
  }

  #clearCompletedInFlight(): boolean {
    const inFlight = this.#inFlight;
    if (
      inFlight === null ||
      inFlight.resultRevision === null ||
      this.#projection === null ||
      this.#projection.revision < inFlight.resultRevision ||
      this.#projectionSequence <= inFlight.projectionSequenceAtSend
    ) {
      return false;
    }
    this.#inFlight = null;
    return true;
  }

  #scheduleReconnect(minimumDelay = 0): void {
    if (this.#manualClose || this.#credentials === null) {
      return;
    }
    this.#generation += 1;
    this.#awaitingFreshProjection = true;
    const delay = Math.max(
      RETRY_DELAYS[this.#retryAttempt] ?? MAX_RETRY_DELAY,
      minimumDelay,
    );
    this.#retryAttempt += 1;
    this.#cancelRetry();
    this.#retryDeadline = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.#now() + delay,
    );
    this.#armRetry(this.#generation);
    this.#setConnection("reconnecting");
  }

  #armRetry(generation: number): void {
    if (this.#retryDeadline === null) return;
    const remaining = Math.max(0, this.#retryDeadline - this.#now());
    this.#retryTimer = this.#dependencies.setTimeout(
      () => {
        if (
          this.#manualClose ||
          generation !== this.#generation ||
          this.#retryDeadline === null
        )
          return;
        this.#retryTimer = null;
        if (this.#now() < this.#retryDeadline) {
          this.#armRetry(generation);
          return;
        }
        this.#retryDeadline = null;
        void this.#open(true).catch(() => undefined);
      },
      Math.min(remaining, MAX_TIMER_DELAY),
    );
  }

  #handleOpenFailure(
    reconnecting: boolean,
    generation: number,
    error: unknown,
  ): void {
    if (this.#manualClose || generation !== this.#generation) {
      return;
    }
    const status = error instanceof ApiError ? error.status : null;
    if (status === 401 || status === 404) {
      this.#terminate(
        status === 401 ? "credential_invalid" : "room_unavailable",
      );
    } else if (
      reconnecting ||
      status === 429 ||
      (status !== null && status >= 500) ||
      error instanceof TypeError
    ) {
      this.#scheduleReconnect(
        error instanceof ApiError && status === 429
          ? (error.retryAfterMs ?? 0)
          : 0,
      );
    } else {
      this.#terminate("connection_rejected");
    }
  }

  #terminate(error: RoomConnectionError): void {
    this.#manualClose = true;
    this.#generation += 1;
    this.#cancelRetry();
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(1000, "Connection ended");
      } catch {
        // Retired callbacks cannot restore a terminated connection.
      }
    }
    this.#projection = null;
    this.#lastResult = null;
    this.#inFlight = null;
    this.#awaitingFreshProjection = true;
    this.#error = error;
    this.#connection = "closed";
    this.#notify();
  }

  #now(): number {
    return (this.#dependencies.now ?? Date.now)();
  }

  #cancelRetry(): void {
    this.#retryDeadline = null;
    if (this.#retryTimer !== null) {
      this.#dependencies.clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
  }

  #isCurrent(generation: number, socket: RoomWebSocket): boolean {
    return (
      !this.#manualClose &&
      generation === this.#generation &&
      socket === this.#socket
    );
  }

  #setConnection(connection: RoomConnectionState, notify = true): void {
    if (this.#connection === connection) {
      return;
    }
    this.#connection = connection;
    if (notify) {
      this.#notify();
    }
  }

  #snapshot(): RoomConnectionSnapshot {
    return {
      connection: this.#connection,
      projection: this.#projection,
      lastResult: this.#lastResult,
      error: this.#error,
    };
  }

  #notify(): void {
    const snapshot = this.#snapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // One UI subscriber cannot prevent other observers from converging.
      }
    }
  }
}
