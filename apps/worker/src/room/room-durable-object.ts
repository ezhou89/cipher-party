import { DurableObject } from "cloudflare:workers";
import {
  projectRoomForSeat,
  type ClientProjection,
  type CommandEnvelope,
  type CommandResult,
  type RoomProjectionSource,
  type SeatSummary,
  type ViewerContext
} from "@cipher-party/protocol";
import { hashTicket, randomTicket, TICKET_TTL_MS } from "../auth/ticket";
import { hashToken, timingSafeEqualString } from "../auth/token";
import type { Env } from "../env";
import {
  createLobbyState,
  type RoomActor,
  type RoomSeat,
  type RoomState
} from "./room-state";
import { RoomSession } from "./room-session";
import {
  RoomStorage,
  type IRoomStorage,
  ROOM_IDLE_TTL_MS
} from "./room-storage";

export interface RoomInitializationInput {
  code: string;
  hostPlayerId: string;
  hostDisplayName: string;
  inviteUrl: string;
  seatTokenHash: string;
  hostTokenHash: string;
  boardSeed: string;
}

export type InitializeResult =
  { ok: true } | { ok: false; code: "already_initialized" };

export interface JoinRoomInput {
  playerId: string;
  displayName: string;
  seatTokenHash: string;
  asSpectator: boolean;
}

export type JoinRoomResult =
  | { ok: true; revision: number }
  | {
      ok: false;
      code:
        "room_unavailable" | "room_locked" | "room_in_progress" | "room_full";
    };

export interface IssueTicketInput {
  seatToken: string;
  hostToken: string | null;
  now: number;
}

export type IssueTicketResult =
  | { ok: true; ticket: string; expiresAt: number }
  | { ok: false; code: "room_unavailable" | "unauthorized" };

export type ConsumeTicketResult =
  | { ok: true; playerId: string; hostAuthority: boolean }
  | { ok: false; code: "room_unavailable" | "invalid_ticket" };

export type DispatchResult =
  | CommandResult
  | {
      ok: false;
      revision: number;
      code: "storage_failed";
      message?: string;
    };

export class RoomDurableObject extends DurableObject<Env> {
  private storage: IRoomStorage;
  private sessionState: RoomState | undefined;
  private initializing = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = new RoomStorage(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      this.sessionState = await this.storage.read();
    });
  }

  setStorageAdapterForTest(adapter: IRoomStorage): void {
    this.storage = adapter;
  }

  async isInitialized(): Promise<boolean> {
    return this.sessionState !== undefined;
  }

  async initialize(input: RoomInitializationInput): Promise<InitializeResult> {
    if (this.sessionState !== undefined || this.initializing) {
      return { ok: false, code: "already_initialized" };
    }
    this.initializing = true;
    try {
      const now = new Date();
      const state = createLobbyState({
        code: input.code,
        hostPlayerId: input.hostPlayerId,
        hostDisplayName: input.hostDisplayName,
        hostTokenHash: input.hostTokenHash,
        seatTokenHash: input.seatTokenHash,
        boardSeed: input.boardSeed,
        inviteUrl: input.inviteUrl,
        now
      });
      await this.storage.write(state);
      this.sessionState = state;
      return { ok: true };
    } finally {
      this.initializing = false;
    }
  }

  async join(input: JoinRoomInput): Promise<JoinRoomResult> {
    if (!this.sessionState) {
      return { ok: false, code: "room_unavailable" };
    }
    if (this.sessionState.locked) {
      return { ok: false, code: "room_locked" };
    }
    if (this.sessionState.phase !== "lobby" && !input.asSpectator) {
      return { ok: false, code: "room_in_progress" };
    }
    const activeCount = this.sessionState.seats.filter(
      (s) => s.seatClass === "active"
    ).length;
    const spectatorCount = this.sessionState.seats.filter(
      (s) => s.seatClass === "spectator"
    ).length;

    if (!input.asSpectator && activeCount >= 16) {
      return { ok: false, code: "room_full" };
    }
    if (input.asSpectator && spectatorCount >= 16) {
      return { ok: false, code: "room_full" };
    }

    const newSeat: RoomSeat = {
      playerId: input.playerId,
      displayName: input.displayName,
      seatClass: input.asSpectator ? "spectator" : "active",
      teamId: null,
      role: input.asSpectator ? "spectator" : "unassigned",
      connected: false,
      seatTokenHash: input.seatTokenHash
    };

    const nextState = structuredClone(this.sessionState);
    nextState.seats.push(newSeat);
    nextState.revision += 1;
    nextState.lastActivity = new Date().toISOString();

    await this.storage.write(nextState);
    this.sessionState = nextState;

    return { ok: true, revision: nextState.revision };
  }

  async issueTicket(input: IssueTicketInput): Promise<IssueTicketResult> {
    if (!this.sessionState) {
      return { ok: false, code: "room_unavailable" };
    }

    const seatTokenHash = await hashToken(input.seatToken);
    const seat = this.sessionState.seats.find((s) =>
      timingSafeEqualString(s.seatTokenHash, seatTokenHash)
    );
    if (!seat) {
      return { ok: false, code: "unauthorized" };
    }

    const isHostPlayer = seat.playerId === this.sessionState.hostPlayerId;
    let hostAuthority = false;
    if (input.hostToken !== null) {
      if (!isHostPlayer) {
        return { ok: false, code: "unauthorized" };
      }
      const hostTokenHash = await hashToken(input.hostToken);
      if (
        !timingSafeEqualString(this.sessionState.hostTokenHash, hostTokenHash)
      ) {
        return { ok: false, code: "unauthorized" };
      }
      hostAuthority = true;
    }

    const nextState = structuredClone(this.sessionState);
    nextState.connectionTickets = nextState.connectionTickets.filter(
      (t) => t.expiresAt > input.now
    );

    const ticket = randomTicket();
    const ticketHash = await hashTicket(ticket);
    const expiresAt = input.now + TICKET_TTL_MS;

    nextState.connectionTickets.push({
      ticketHash,
      playerId: seat.playerId,
      hostAuthority,
      expiresAt
    });
    nextState.lastActivity = new Date(input.now).toISOString();

    await this.storage.write(nextState);
    this.sessionState = nextState;

    return { ok: true, ticket, expiresAt };
  }

  async consumeTicket(
    ticket: string,
    now: number
  ): Promise<ConsumeTicketResult> {
    if (!this.sessionState) {
      return { ok: false, code: "room_unavailable" };
    }

    const ticketHash = await hashTicket(ticket);
    const nextState = structuredClone(this.sessionState);

    nextState.connectionTickets = nextState.connectionTickets.filter(
      (t) => t.expiresAt > now
    );

    const ticketIdx = nextState.connectionTickets.findIndex((t) =>
      timingSafeEqualString(t.ticketHash, ticketHash)
    );

    if (ticketIdx === -1) {
      return { ok: false, code: "invalid_ticket" };
    }

    const [ticketRecord] = nextState.connectionTickets.splice(ticketIdx, 1);
    if (!ticketRecord) {
      return { ok: false, code: "invalid_ticket" };
    }

    const seat = nextState.seats.find(
      (s) => s.playerId === ticketRecord.playerId
    );
    if (seat) {
      seat.connected = true;
    }

    nextState.lastActivity = new Date(now).toISOString();

    await this.storage.write(nextState);
    this.sessionState = nextState;

    return {
      ok: true,
      playerId: ticketRecord.playerId,
      hostAuthority: ticketRecord.hostAuthority
    };
  }

  async getSnapshot(): Promise<RoomState> {
    if (!this.sessionState) {
      throw new Error("Room not initialized");
    }
    return structuredClone(this.sessionState);
  }

  async dispatch(
    actor: RoomActor,
    envelope: CommandEnvelope
  ): Promise<DispatchResult> {
    if (!this.sessionState) {
      throw new Error("Room not initialized");
    }

    const session = RoomSession.from(this.sessionState);
    const now = new Date();
    const result = await session.dispatch(actor, envelope, now);

    if (result.ok && result.revision > this.sessionState.revision) {
      const nextState = session.snapshot();
      try {
        await this.storage.write(nextState);
        this.sessionState = nextState;
      } catch (error) {
        return {
          ok: false,
          revision: this.sessionState.revision,
          code: "storage_failed",
          message:
            error instanceof Error ? error.message : "Storage write failed"
        };
      }
    }

    return result;
  }

  async getProjection(viewer: RoomActor): Promise<ClientProjection> {
    if (!this.sessionState) {
      throw new Error("Room not initialized");
    }

    const state = this.sessionState;
    const seat = state.seats.find((s) => s.playerId === viewer.playerId);
    const isHost =
      viewer.hostAuthority || viewer.playerId === state.hostPlayerId;

    const viewerContext: ViewerContext = {
      playerId: viewer.playerId,
      teamId: seat?.teamId ?? null,
      role: seat?.role ?? "spectator",
      isHost
    };

    const seats: SeatSummary[] = state.seats.map((s) => ({
      playerId: s.playerId,
      displayName: s.displayName,
      teamId: s.teamId,
      role: s.role,
      connected: s.connected
    }));

    const source: RoomProjectionSource = {
      protocolVersion: state.protocolVersion,
      code: state.code,
      inviteUrl: state.inviteUrl,
      revision: state.revision,
      roomPhase: state.phase,
      locked: state.locked,
      seats,
      publicHistory: state.publicHistory,
      game: state.game
    };

    return projectRoomForSeat(source, viewerContext);
  }

  async alarm(): Promise<void> {
    const snapshot = await this.storage.read();
    if (!snapshot) {
      this.sessionState = undefined;
      return;
    }

    const expiresAt = Date.parse(snapshot.lastActivity) + ROOM_IDLE_TTL_MS;
    const now = Date.now();
    if (now < expiresAt) {
      await this.ctx.storage.setAlarm(expiresAt);
      return;
    }

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1001, "Room expired");
      } catch {
        // ignore WebSocket close errors
      }
    }

    await this.storage.clear();
    this.sessionState = undefined;
  }
}
