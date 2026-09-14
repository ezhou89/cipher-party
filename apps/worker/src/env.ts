import type { RoomDurableObject } from "./room/room-durable-object";

interface AdmissionBindings {
  CREATE_BY_IP?: RateLimit;
  JOIN_BY_IP?: RateLimit;
  JOIN_BY_ROOM?: RateLimit;
  TICKET_BY_IP?: RateLimit;
  TICKET_BY_ROOM?: RateLimit;
  CONNECT_BY_IP?: RateLimit;
  CONNECT_BY_ROOM?: RateLimit;
  COMMAND_BY_SEAT?: RateLimit;
  COMMAND_BY_ROOM?: RateLimit;
}

export interface Env extends AdmissionBindings {
  APPLE_APP_ID?: string;
  CANONICAL_ORIGIN: string;
  ASSETS?: Fetcher;
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
}

declare global {
  // Cloudflare's generated binding types use declaration merging here.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env extends AdmissionBindings {
      APPLE_APP_ID?: string;
      CANONICAL_ORIGIN: string;
      ASSETS?: Fetcher;
      ROOMS: DurableObjectNamespace<RoomDurableObject>;
    }
  }
}
