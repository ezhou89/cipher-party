import type { RoomDurableObject } from "./room/room-durable-object";

export interface Env {
  CANONICAL_ORIGIN: string;
  ASSETS?: Fetcher;
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
}

declare global {
  // Cloudflare's generated binding types use declaration merging here.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env {
      CANONICAL_ORIGIN: string;
      ASSETS?: Fetcher;
      ROOMS: DurableObjectNamespace<RoomDurableObject>;
    }
  }
}
