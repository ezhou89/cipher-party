import type { RoomState } from "./room-state";

export const SNAPSHOT_KEY = "room:snapshot";
export const ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

export interface IRoomStorage {
  read(): Promise<RoomState | undefined>;
  write(state: RoomState): Promise<void>;
  clear(): Promise<void>;
}

export class RoomStorage implements IRoomStorage {
  constructor(private readonly storage: DurableObjectStorage) {}

  read(): Promise<RoomState | undefined> {
    return this.storage.get<RoomState>(SNAPSHOT_KEY);
  }

  write(state: RoomState): Promise<void> {
    return this.storage.transaction(async (transaction) => {
      await transaction.put(SNAPSHOT_KEY, state);
      await transaction.setAlarm(
        Date.parse(state.lastActivity) + ROOM_IDLE_TTL_MS
      );
    });
  }

  clear(): Promise<void> {
    return this.storage.deleteAll();
  }
}
