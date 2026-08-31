import type {
  ClientProjection,
  CommandEnvelope,
  CommandResult,
  ServerMessage,
  ViewerContext,
} from "@cipher-party/protocol";
import { ClientMessageSchema } from "@cipher-party/protocol";
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
import {
  MAX_CLIENT_MESSAGE_BYTES,
  opaqueAdmissionFailure,
  parseRoomSocketAttachment,
  readUpgradeTicket,
  type RoomSocketAttachment,
} from "./room-websocket";

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

type MarkConnectedResult = { ok: true } | { ok: false };

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
        hostAuthority:
          accepted.hostAuthority && accepted.playerId === current.hostPlayerId,
      };
    });
  }

  markConnected(playerId: string, now: number): Promise<MarkConnectedResult> {
    return this.#serialize(async () => {
      const current = this.#state;
      if (current === undefined) {
        return { ok: false };
      }
      const next = clone(current);
      const seat = next.seats.find(
        (candidate) => candidate.playerId === playerId,
      );
      if (seat === undefined) {
        return { ok: false };
      }

      seat.connected = true;
      next.revision = current.revision + 1;
      next.lastActivity = new Date(now).toISOString();
      await this.#storage.write(next);
      this.#state = clone(next);
      return { ok: true };
    });
  }

  disconnect(
    playerId: string,
    hasOtherOpenConnection: () => boolean,
  ): Promise<{ changed: boolean }> {
    return this.#serialize(async () => {
      const current = this.#state;
      if (current === undefined || hasOtherOpenConnection()) {
        return { changed: false };
      }
      const seat = current.seats.find(
        (candidate) => candidate.playerId === playerId,
      );
      if (seat === undefined || !seat.connected) {
        return { changed: false };
      }
      const next = clone(current);
      const nextSeat = next.seats.find(
        (candidate) => candidate.playerId === playerId,
      )!;
      nextSeat.connected = false;
      next.revision = current.revision + 1;
      await this.#storage.write(next);
      this.#state = clone(next);
      return { changed: true };
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

  getConnectionProjection(
    playerId: string,
    hostAuthority: boolean,
  ): ClientProjection | undefined {
    const state = this.#state;
    const seat = state?.seats.find(
      (candidate) => candidate.playerId === playerId,
    );
    if (state === undefined || seat === undefined) {
      return undefined;
    }
    return RoomSession.from(state).project({
      playerId: seat.playerId,
      teamId: seat.teamId,
      role: seat.role,
      isHost: hostAuthority && seat.playerId === state.hostPlayerId,
    });
  }

  getConnectionActor(
    playerId: string,
    hostAuthority: boolean,
  ): RoomActor | undefined {
    const state = this.#state;
    if (
      state === undefined ||
      !state.seats.some((seat) => seat.playerId === playerId)
    ) {
      return undefined;
    }
    return {
      playerId,
      hostAuthority: hostAuthority && playerId === state.hostPlayerId,
    };
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

  async join(input: JoinRoomInput): Promise<JoinResult> {
    const result = await this.#controller.join(input);
    if (result.ok) {
      await this.#broadcastProjections();
    }
    return result;
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

  async fetch(request: Request): Promise<Response> {
    const snapshot = this.#controller.getSnapshot();
    if (snapshot === undefined) {
      return opaqueAdmissionFailure();
    }
    const ticket = readUpgradeTicket(request, snapshot.code);
    if (ticket === null) {
      return opaqueAdmissionFailure();
    }

    const connectedAt = Date.now();
    let admission: ConsumeTicketResult;
    try {
      admission = await this.#controller.consumeTicket({
        ticket,
        now: connectedAt,
      });
    } catch {
      return opaqueAdmissionFailure();
    }
    if (!admission.ok) {
      return opaqueAdmissionFailure();
    }

    let serverSocket: WebSocket | undefined;
    try {
      const pair = new WebSocketPair();
      const clientSocket = pair[0];
      serverSocket = pair[1];
      this.ctx.acceptWebSocket(serverSocket, [admission.playerId]);
      const attachment: RoomSocketAttachment = {
        connectionId: crypto.randomUUID(),
        playerId: admission.playerId,
        hostAuthority: admission.hostAuthority,
      };
      serverSocket.serializeAttachment(attachment);
      const connected = await this.#controller.markConnected(
        admission.playerId,
        connectedAt,
      );
      if (!connected.ok) {
        throw new Error("room connection is unavailable");
      }
      if (!this.#sendProjection(serverSocket, attachment)) {
        throw new Error("initial projection send failed");
      }
      await this.#broadcastProjections(attachment.connectionId);
      return new Response(null, { status: 101, webSocket: clientSocket });
    } catch {
      try {
        serverSocket?.close(1011, "Connection failed");
      } catch {
        // Admission still fails opaquely when the server socket cannot close.
      }
      try {
        await this.#disconnectIfLast(admission.playerId, undefined);
      } catch {
        // The connection is already closed and admission remains opaque.
      }
      try {
        await this.#broadcastProjections();
      } catch {
        // Admission failures remain opaque even if a defensive resync fails.
      }
      return opaqueAdmissionFailure();
    }
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = parseRoomSocketAttachment(socket);
    if (
      attachment === null ||
      typeof message !== "string" ||
      new TextEncoder().encode(message).byteLength > MAX_CLIENT_MESSAGE_BYTES
    ) {
      this.#send(socket, {
        type: "error",
        code: "invalid_message",
        message: "Message did not match protocol",
      });
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      this.#send(socket, {
        type: "error",
        code: "invalid_message",
        message: "Message did not match protocol",
      });
      return;
    }
    const parsed = ClientMessageSchema.safeParse(value);
    if (!parsed.success) {
      this.#send(socket, {
        type: "error",
        code: "invalid_message",
        message: "Message did not match protocol",
      });
      return;
    }

    const actor = this.#controller.getConnectionActor(
      attachment.playerId,
      attachment.hostAuthority,
    );
    if (actor === undefined) {
      this.#send(socket, {
        type: "error",
        code: "internal_error",
        message: "Room connection is unavailable",
      });
      return;
    }
    try {
      const result = await this.#controller.dispatch(actor, parsed.data);
      this.#send(socket, {
        type: "command_result",
        commandId: parsed.data.commandId,
        result,
      });
      await this.#broadcastProjections();
    } catch {
      this.#send(socket, {
        type: "error",
        code: "internal_error",
        message: "Room command could not be processed",
      });
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = parseRoomSocketAttachment(socket);
    if (attachment === null) {
      return;
    }
    await this.#disconnectIfLast(attachment.playerId, attachment.connectionId);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
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

  async #disconnectIfLast(
    playerId: string,
    closingConnectionId: string | undefined,
  ): Promise<void> {
    const hasOtherOpenConnection = () =>
      this.ctx.getWebSockets(playerId).some((candidate) => {
        const attachment = parseRoomSocketAttachment(candidate);
        return (
          attachment !== null &&
          attachment.connectionId !== closingConnectionId &&
          candidate.readyState === WebSocket.OPEN
        );
      });
    const { changed } = await this.#controller.disconnect(
      playerId,
      hasOtherOpenConnection,
    );
    if (changed && !hasOtherOpenConnection()) {
      await this.#broadcastProjections();
    }
  }

  #send(socket: WebSocket, message: ServerMessage): boolean {
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  #sendProjection(
    socket: WebSocket,
    attachment: RoomSocketAttachment,
  ): boolean {
    const projection = this.#controller.getConnectionProjection(
      attachment.playerId,
      attachment.hostAuthority,
    );
    return (
      projection !== undefined &&
      this.#send(socket, { type: "projection", projection })
    );
  }

  async #broadcastProjections(excludedConnectionId?: string): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = parseRoomSocketAttachment(socket);
      if (
        attachment === null ||
        attachment.connectionId === excludedConnectionId
      ) {
        continue;
      }
      this.#sendProjection(socket, attachment);
    }
  }
}
