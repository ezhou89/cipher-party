import { z } from "zod";

export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
export const OVERLOAD_CLOSE_CODE = 1013;
export const OVERLOAD_CLOSE_REASON = "Room connection is busy";
export const CONNECTION_TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export const RoomSocketAttachmentSchema = z
  .object({
    connectionId: z.string().uuid(),
    playerId: z.string().min(1),
    hostAuthority: z.boolean(),
  })
  .strict();

export type RoomSocketAttachment = z.infer<typeof RoomSocketAttachmentSchema>;

export function parseRoomSocketAttachment(
  socket: WebSocket,
): RoomSocketAttachment | null {
  const parsed = RoomSocketAttachmentSchema.safeParse(
    socket.deserializeAttachment(),
  );
  return parsed.success ? parsed.data : null;
}

export function readUpgradeTicket(
  request: Request,
  code: string,
): string | null {
  if (
    request.method !== "GET" ||
    request.headers.get("upgrade")?.toLowerCase() !== "websocket"
  ) {
    return null;
  }
  const url = new URL(request.url);
  if (url.pathname !== `/api/rooms/${code}/connect`) {
    return null;
  }
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== "ticket" ||
    !CONNECTION_TICKET_PATTERN.test(entries[0][1])
  ) {
    return null;
  }
  return entries[0][1];
}

export function opaqueAdmissionFailure(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "cache-control": "no-store" },
  });
}
