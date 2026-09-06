import type { Env } from "../env";
import { handleCreateRoom, handleIssueTicket, handleJoinRoom } from "./rooms";

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

  return null;
}
