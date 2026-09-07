import type { Env } from "../env";
import { errorResponse } from "./json";
import { handleCreateRoom, handleIssueTicket, handleJoinRoom } from "./rooms";
import { RoomCodeSchema } from "./schemas";

export async function routeRequest(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (pathname === "/api/health" && method === "GET") {
    return Response.json({ ok: true, service: "cipher-party" });
  }

  if (pathname === "/api/rooms" && method === "POST") {
    return handleCreateRoom(request, env);
  }

  const joinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
  if (joinMatch && method === "POST") {
    const rawCode = joinMatch[1]!;
    return handleJoinRoom(request, env, rawCode);
  }

  const ticketMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/tickets$/);
  if (ticketMatch && method === "POST") {
    const rawCode = ticketMatch[1]!;
    return handleIssueTicket(request, env, rawCode);
  }

  const connectMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/connect$/);
  if (connectMatch && method === "GET") {
    const rawCode = connectMatch[1]!;
    const codeResult = RoomCodeSchema.safeParse(rawCode);
    if (!codeResult.success) {
      return errorResponse(
        "room_unavailable",
        "Room not found or expired",
        404
      );
    }
    const code = codeResult.data;
    const id = env.ROOMS.idFromName(code);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  }

  return null;
}
