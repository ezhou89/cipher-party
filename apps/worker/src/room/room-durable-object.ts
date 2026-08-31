import type {
  ClientProjection,
  CommandEnvelope,
  CommandResult,
  ViewerContext,
} from "@cipher-party/protocol";
import { DurableObject } from "cloudflare:workers";

import { createConnectionTicket } from "../auth/ticket";
import { verifyToken } from "../auth/token";
import type { Env } from "../env";
import { RoomSession } from "./room-session";
import {
  ROOM_IDLE_TTL_MS,
  RoomStorage,
  type RoomSnapshotStore,
} from "./room-storage";
import { createLobbyState, type RoomActor, type RoomState } from "./room-state";

export type { RoomSnapshotStore } from "./room-storage";

type InitializeResult =
  { ok: true } | { ok: false; code: "already_initialized" };

export interface InitializeRoomInput {
  code: string;
  hostPlayerId: string;
  hostDisplayName: string;
  inviteUrl: string;
  seatTokenHash: string;
  hostTokenHash: string;
  boardSeed: string;
}

export interface JoinRoomInput {
  playerId: string;
  displayName: string;
  seatTokenHash: string;
  asSpectator: boolean;
}

type JoinResult =
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

type IssueTicketResult =
  | { ok: true; ticket: string; expiresAt: number }
  | { ok: false; code: "room_unavailable" | "unauthorized" };

export interface ConsumeTicketInput {
  ticket: string;
  now: number;
}

type ConsumeTicketResult =
  | { ok: true; playerId: string; hostAuthority: boolean }
  | { ok: false; code: "unauthorized" };

type PostPersistHook = (state: RoomState) => void | Promise<void>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class PersistentRoomController {
  readonly #storage: RoomSnapshotStore;
  readonly #now: () => Date;
  readonly #postPersist: PostPersistHook | undefined;
  #state: RoomState | undefined;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(
    storage: RoomSnapshotStore,
    now: () => Date = () => new Date(),
    postPersist?: PostPersistHook,
  ) {
    this.#storage = storage;
    this.#now = now;
    this.#postPersist = postPersist;
  }

  async load(): Promise<void> {
    await this.#serialize(async () => {
      const persisted = await this.#storage.read();
      this.#state = persisted === undefined ? undefined : clone(persisted);
    });
  }

  initialize(
    input: RoomState | InitializeRoomInput,
  ): Promise<InitializeResult> {
    return this.#serialize(async () => {
      if (this.#state !== undefined) {
        return { ok: false, code: "already_initialized" };
      }

      const now = this.#now().toISOString();
      const next =
        "schemaVersion" in input
          ? clone(input)
          : createLobbyState({
              code: input.code,
              inviteUrl: input.inviteUrl,
              boardSeed: input.boardSeed,
              hostPlayerId: input.hostPlayerId,
              displayName: input.hostDisplayName,
              seatTokenHash: input.seatTokenHash,
              hostTokenHash: input.hostTokenHash,
              createdAt: now,
            });
      next.lastActivity = now;
      await this.#storage.write(next);
      this.#state = clone(next);
      return { ok: true };
    });
  }

  join(input: JoinRoomInput): Promise<JoinResult> {
    return this.#serialize(async () => {
      const current = this.#state;
      if (current === undefined) {
        return { ok: false, code: "room_unavailable" };
      }
      if (current.locked) {
        return { ok: false, code: "room_locked" };
      }
      if (!input.asSpectator && current.phase !== "lobby") {
        return { ok: false, code: "room_in_progress" };
      }
      const seatClass = input.asSpectator ? "spectator" : "active";
      const seatsInClass = current.seats.filter(
        (seat) => seat.seatClass === seatClass,
      ).length;
      if (seatsInClass >= 16) {
        return { ok: false, code: "room_full" };
      }

      const next = clone(current);
      next.seats.push({
        playerId: input.playerId,
        displayName: input.displayName,
        seatClass,
        teamId: null,
        role: input.asSpectator ? "spectator" : "unassigned",
        connected: false,
        seatTokenHash: input.seatTokenHash,
      });
      next.revision = current.revision + 1;
      next.lastActivity = this.#now().toISOString();
      await this.#storage.write(next);
      this.#state = clone(next);
      await this.#postPersist?.(clone(next));
      return { ok: true, revision: next.revision };
    });
  }

  issueTicket(input: IssueTicketInput): Promise<IssueTicketResult> {
    return this.#serialize(async () => {
      const current = this.#state;
      if (current === undefined) {
        return { ok: false, code: "room_unavailable" };
      }
      const next = clone(current);
      next.connectionTickets = next.connectionTickets.filter(
        (ticket) => ticket.expiresAt > input.now,
      );
      const verification = await Promise.all(
        next.seats.map(async (seat) => ({
          seat,
          valid: await verifyToken(input.seatToken, seat.seatTokenHash),
        })),
      );
      const seat = verification.find(({ valid }) => valid)?.seat;
      if (seat === undefined) {
        if (
          next.connectionTickets.length !== current.connectionTickets.length
        ) {
          await this.#storage.write(next);
          this.#state = clone(next);
        }
        return { ok: false, code: "unauthorized" };
      }

      const hostAuthority =
        seat.playerId === current.hostPlayerId &&
        input.hostToken !== null &&
        (await verifyToken(input.hostToken, current.hostTokenHash));
      const issued = await createConnectionTicket(input.now);
      next.connectionTickets.push({
        ticketHash: issued.ticketHash,
        playerId: seat.playerId,
        hostAuthority,
        expiresAt: issued.expiresAt,
      });
      next.lastActivity = new Date(input.now).toISOString();
      await this.#storage.write(next);
      this.#state = clone(next);
      return {
        ok: true,
        ticket: issued.ticket,
        expiresAt: issued.expiresAt,
      };
    });
  }

  consumeTicket(input: ConsumeTicketInput): Promise<ConsumeTicketResult> {
    return this.#serialize(async () => {
      const current = this.#state;
      if (current === undefined) {
        return { ok: false, code: "unauthorized" };
      }
      const unexpired = current.connectionTickets.filter(
        (ticket) => ticket.expiresAt > input.now,
      );
      const verification = await Promise.all(
        unexpired.map(async (ticket) => ({
          ticket,
          valid: await verifyToken(input.ticket, ticket.ticketHash),
        })),
      );
      const accepted = verification.find(({ valid }) => valid)?.ticket;
      const next = clone(current);
      next.connectionTickets =
        accepted === undefined
          ? clone(unexpired)
          : unexpired.filter((ticket) => ticket !== accepted);
      const changed =
        next.connectionTickets.length !== current.connectionTickets.length;
      if (changed) {
        await this.#storage.write(next);
        this.#state = clone(next);
      }
      if (accepted === undefined) {
        return { ok: false, code: "unauthorized" };
      }
      return {
        ok: true,
        playerId: accepted.playerId,
        hostAuthority: accepted.hostAuthority,
      };
    });
  }

  dispatch(
    actor: RoomActor,
    envelope: CommandEnvelope,
  ): Promise<CommandResult> {
    return this.#serialize(async () => {
      const current = this.#state;
      if (current === undefined) {
        return {
          ok: false,
          revision: 0,
          code: "invalid_command",
          message: "Room is not initialized",
        };
      }

      const session = RoomSession.from(current);
      const result = await session.dispatch(actor, envelope, this.#now());
      const next = session.snapshot();
      if (next.revision === current.revision) {
        return result;
      }

      try {
        await this.#storage.write(next);
      } catch {
        return {
          ok: false,
          revision: current.revision,
          code: "storage_failed",
          message: "Room state could not be persisted",
        };
      }

      this.#state = clone(next);
      await this.#postPersist?.(clone(next));
      return result;
    });
  }

  getSnapshot(): RoomState | undefined {
    return this.#state === undefined ? undefined : clone(this.#state);
  }

  getProjection(viewer: ViewerContext): ClientProjection | undefined {
    return this.#state === undefined
      ? undefined
      : RoomSession.from(this.#state).project(viewer);
  }

  handleAlarm(closeSockets: () => void | Promise<void>): Promise<void> {
    return this.#serialize(async () => {
      const persisted = await this.#storage.read();
      if (persisted === undefined) {
        this.#state = undefined;
        return;
      }

      const deadline = Date.parse(persisted.lastActivity) + ROOM_IDLE_TTL_MS;
      if (this.#now().getTime() < deadline) {
        await this.#storage.write(persisted);
        this.#state = clone(persisted);
        return;
      }

      await closeSockets();
      await this.#storage.clear();
      this.#state = undefined;
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class RoomDurableObject extends DurableObject<Env> {
  readonly #controller: PersistentRoomController;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#controller = new PersistentRoomController(
      new RoomStorage(ctx.storage),
    );
    ctx.blockConcurrencyWhile(() => this.#controller.load());
  }

  initialize(
    input: RoomState | InitializeRoomInput,
  ): Promise<InitializeResult> {
    return this.#controller.initialize(input);
  }

  join(input: JoinRoomInput): Promise<JoinResult> {
    return this.#controller.join(input);
  }

  issueTicket(input: IssueTicketInput): Promise<IssueTicketResult> {
    return this.#controller.issueTicket(input);
  }

  consumeTicket(input: ConsumeTicketInput): Promise<ConsumeTicketResult> {
    return this.#controller.consumeTicket(input);
  }

  getSnapshot(): RoomState | undefined {
    return this.#controller.getSnapshot();
  }

  dispatch(
    actor: RoomActor,
    envelope: CommandEnvelope,
  ): Promise<CommandResult> {
    return this.#controller.dispatch(actor, envelope);
  }

  getProjection(viewer: ViewerContext): ClientProjection | undefined {
    return this.#controller.getProjection(viewer);
  }

  async alarm(): Promise<void> {
    await this.#controller.handleAlarm(() => {
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.close(1001, "Room expired");
        } catch {
          // A concurrently closed socket cannot prevent expiry cleanup.
        }
      }
    });
  }
}
