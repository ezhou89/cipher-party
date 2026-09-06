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
import type { Env } from "../env";
import { createLobbyState, type RoomActor, type RoomState } from "./room-state";
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
