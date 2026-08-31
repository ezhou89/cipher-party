import type { Env } from "./env";
import { routeApiRequest } from "./http/router";
import { normalizeRoomCode } from "./http/schemas";
import {
  CONNECTION_TICKET_PATTERN,
  opaqueAdmissionFailure,
} from "./room/room-websocket";

export { RoomDurableObject } from "./room/room-durable-object";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "cipher-party" });
    }
    const connectMatch = /^\/api\/rooms\/([^/]+)\/connect$/u.exec(url.pathname);
    if (connectMatch !== null) {
      const code = normalizeRoomCode(connectMatch[1]!);
      const entries = [...url.searchParams.entries()];
      const ticket = entries[0]?.[1];
      if (
        request.method !== "GET" ||
        request.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
        code === null ||
        entries.length !== 1 ||
        entries[0]?.[0] !== "ticket" ||
        ticket === undefined ||
        !CONNECTION_TICKET_PATTERN.test(ticket)
      ) {
        return opaqueAdmissionFailure();
      }
      const forwardedUrl = new URL(
        `/api/rooms/${code}/connect`,
        "https://room.internal",
      );
      forwardedUrl.searchParams.set("ticket", ticket);
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(
        new Request(forwardedUrl, {
          method: "GET",
          headers: { Upgrade: "websocket" },
        }),
      );
    }
    const apiResponse = await routeApiRequest(request, env);
    if (apiResponse !== null) {
      return apiResponse;
    }
    return (
      env.ASSETS?.fetch(request) ?? new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
