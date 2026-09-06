import type { RoomDurableObject } from "./room/room-durable-object";

export interface Env {
  CANONICAL_ORIGIN: string;
  ASSETS?: Fetcher;
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
}
