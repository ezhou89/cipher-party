import type { RoomDurableObject } from "./room/room-durable-object";

export interface Env {
  APPLE_APP_ID?: string;
  CANONICAL_ORIGIN: string;
  ASSETS?: Fetcher;
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
}
