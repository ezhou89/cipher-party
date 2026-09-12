import type { RoomState } from "./room-state";
import { parseRoomSnapshot } from "./room-snapshot";

const SNAPSHOT_KEY = "room:snapshot";

export const ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

export interface RoomSnapshotStore {
  read(): Promise<RoomState | undefined>;
  write(state: RoomState): Promise<void>;
  clear(): Promise<void>;
}

export class RoomStorage implements RoomSnapshotStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async read(): Promise<RoomState | undefined> {
    const value = await this.storage.get<unknown>(SNAPSHOT_KEY);
    return value === undefined ? undefined : parseRoomSnapshot(value);
  }

  write(state: RoomState): Promise<void> {
    return this.storage.transaction(async (transaction) => {
      await transaction.put(SNAPSHOT_KEY, state);
      await transaction.setAlarm(
        Date.parse(state.lastActivity) + ROOM_IDLE_TTL_MS,
      );
    });
  }

  clear(): Promise<void> {
    return this.storage.deleteAll();
  }
}
