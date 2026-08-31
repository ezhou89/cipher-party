import type {
  ClientProjection,
  CommandEnvelope,
  CommandResult,
  ViewerContext,
} from "@cipher-party/protocol";
import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";
import { RoomSession } from "./room-session";
import {
  ROOM_IDLE_TTL_MS,
  RoomStorage,
  type RoomSnapshotStore,
} from "./room-storage";
import type { RoomActor, RoomState } from "./room-state";

export type { RoomSnapshotStore } from "./room-storage";

type InitializeResult =
  { ok: true } | { ok: false; code: "already_initialized" };

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

  initialize(input: RoomState): Promise<InitializeResult> {
    return this.#serialize(async () => {
      if (this.#state !== undefined) {
        return { ok: false, code: "already_initialized" };
      }

      const next = clone(input);
      next.lastActivity = this.#now().toISOString();
      await this.#storage.write(next);
      this.#state = clone(next);
      return { ok: true };
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

  initialize(input: RoomState): Promise<InitializeResult> {
    return this.#controller.initialize(input);
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
