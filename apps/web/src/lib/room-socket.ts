import type {
  ClientCommand,
  ClientProjection,
  CommandEnvelope,
  CommandResult,
  ServerMessage
} from "@cipher-party/protocol";
import type { SeatCredentials } from "./seat-store";

export type RoomConnectionState =
  "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface RoomSocketState {
  connection: RoomConnectionState;
  projection: ClientProjection | null;
  lastResult: CommandResult | null;
}

export interface RoomSocketOptions {
  baseUrl?: string | undefined;
  wsBaseUrl?: string | undefined;
  fetchFn?: typeof fetch | undefined;
  wsFactory?: ((url: string) => WebSocket) | undefined;
}

interface InFlightCommand {
  commandId: string;
  expectedRevision: number;
  resultReceived: boolean;
  requiredRevision?: number | undefined;
}

const BACKOFF_DELAYS = [500, 1000, 2000, 5000];

export class RoomSocket {
  private state: RoomConnectionState = "idle";
  private projection: ClientProjection | null = null;
  private lastResult: CommandResult | null = null;
  private ws: WebSocket | null = null;
  private credentials: SeatCredentials | null = null;
  private listeners = new Set<(state: RoomSocketState) => void>();
  private inFlightCommand: InFlightCommand | null = null;
  private closedByUser = false;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly baseUrl: string;
  private readonly wsBaseUrl?: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly wsFactory: (url: string) => WebSocket;

  constructor(options: RoomSocketOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.wsBaseUrl = options.wsBaseUrl;
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
    this.wsFactory = options.wsFactory ?? ((url: string) => new WebSocket(url));
  }

  async connect(credentials: SeatCredentials): Promise<void> {
    this.credentials = credentials;
    this.closedByUser = false;
    this.retryAttempt = 0;
    await this.establishConnection();
  }

  private async establishConnection(): Promise<void> {
    if (!this.credentials || this.closedByUser) {
      return;
    }

    if (this.state === "idle") {
      this.state = "connecting";
      this.notify();
    }

    try {
      const ticketRes = await this.fetchTicket(this.credentials);
      if (this.closedByUser) {
        return;
      }

      const wsUrl = this.buildWebSocketUrl(
        this.credentials.code,
        ticketRes.ticket
      );
      const ws = this.wsFactory(wsUrl);
      this.ws = ws;

      ws.addEventListener("open", () => {
        if (this.closedByUser) {
          ws.close();
          return;
        }
        this.retryAttempt = 0;
        this.state = "open";
        this.notify();
      });

      ws.addEventListener("message", (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          this.handleServerMessage(msg);
        } catch {
          // Ignore malformed incoming frames
        }
      });

      ws.addEventListener("close", () => {
        if (this.closedByUser) {
          this.state = "closed";
          this.notify();
          return;
        }

        this.ws = null;
        this.state = "reconnecting";
        this.notify();

        const delay =
          BACKOFF_DELAYS[
            Math.min(this.retryAttempt, BACKOFF_DELAYS.length - 1)
          ]!;
        this.retryAttempt++;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.establishConnection();
        }, delay);
      });

      ws.addEventListener("error", () => {
        // Close event will handle reconnection
      });
    } catch {
      if (this.closedByUser) {
        return;
      }
      this.state = "reconnecting";
      this.notify();

      const delay =
        BACKOFF_DELAYS[Math.min(this.retryAttempt, BACKOFF_DELAYS.length - 1)]!;
      this.retryAttempt++;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.establishConnection();
      }, delay);
    }
  }

  private async fetchTicket(
    credentials: SeatCredentials
  ): Promise<{ ticket: string; expiresAt: number }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credentials.seatToken}`
    };
    if (credentials.hostToken) {
      headers["X-Cipher-Host-Token"] = credentials.hostToken;
    }

    const res = await this.fetchFn(
      `${this.baseUrl}/api/rooms/${credentials.code}/tickets`,
      {
        method: "POST",
        headers
      }
    );

    if (!res.ok) {
      throw new Error(`Failed to obtain ticket: status ${res.status}`);
    }

    return (await res.json()) as { ticket: string; expiresAt: number };
  }

  private buildWebSocketUrl(code: string, ticket: string): string {
    if (this.wsBaseUrl) {
      return `${this.wsBaseUrl}/api/rooms/${code}/connect?ticket=${ticket}`;
    }
    const loc = globalThis.location;
    if (loc) {
      const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${loc.host}/api/rooms/${code}/connect?ticket=${ticket}`;
    }
    return `ws://127.0.0.1:5173/api/rooms/${code}/connect?ticket=${ticket}`;
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "projection": {
        this.projection = msg.projection;
        if (this.inFlightCommand) {
          if (this.inFlightCommand.resultReceived) {
            if (
              this.inFlightCommand.requiredRevision === undefined ||
              msg.projection.revision >= this.inFlightCommand.requiredRevision
            ) {
              this.inFlightCommand = null;
            }
          } else if (
            this.inFlightCommand.requiredRevision !== undefined &&
            msg.projection.revision >= this.inFlightCommand.requiredRevision
          ) {
            this.inFlightCommand = null;
          }
        }
        this.notify();
        break;
      }

      case "command_result": {
        this.lastResult = msg.result;
        if (
          this.inFlightCommand &&
          this.inFlightCommand.commandId === msg.commandId
        ) {
          this.inFlightCommand.resultReceived = true;
          if (msg.result.ok) {
            this.inFlightCommand.requiredRevision = msg.result.revision;
            if (
              this.projection &&
              this.projection.revision >= msg.result.revision
            ) {
              this.inFlightCommand = null;
            }
          } else {
            if (msg.result.code === "stale_revision") {
              this.inFlightCommand.requiredRevision =
                (this.projection?.revision ?? 0) + 1;
            } else {
              this.inFlightCommand = null;
            }
          }
        }
        this.notify();
        break;
      }

      case "error": {
        this.notify();
        break;
      }
    }
  }

  send(command: ClientCommand): string {
    if (this.state !== "open" || !this.ws || !this.projection) {
      throw new Error(
        "Cannot send command: socket is not open or projection is missing"
      );
    }

    if (this.inFlightCommand !== null) {
      throw new Error("Cannot send command: another command is in flight");
    }

    const commandId = crypto.randomUUID();
    const envelope: CommandEnvelope = {
      protocolVersion: 1,
      commandId,
      expectedRevision: this.projection.revision,
      command
    };

    this.inFlightCommand = {
      commandId,
      expectedRevision: this.projection.revision,
      resultReceived: false
    };

    this.ws.send(JSON.stringify(envelope));
    return commandId;
  }

  close(): void {
    this.closedByUser = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Closed by client");
      this.ws = null;
    }
    this.inFlightCommand = null;
    this.state = "closed";
    this.notify();
  }

  subscribe(listener: (state: RoomSocketState) => void): () => void {
    this.listeners.add(listener);
    listener({
      connection: this.state,
      projection: this.projection,
      lastResult: this.lastResult
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot: RoomSocketState = {
      connection: this.state,
      projection: this.projection,
      lastResult: this.lastResult
    };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
