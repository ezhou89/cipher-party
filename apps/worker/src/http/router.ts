import type { Env } from "../env";
import { createRoom, issueRoomTicket, joinRoom } from "./rooms";

const JOIN_PATH = /^\/api\/rooms\/([^/]+)\/join$/u;
const TICKET_PATH = /^\/api\/rooms\/([^/]+)\/tickets$/u;

export async function routeApiRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (request.method !== "POST") {
    return null;
  }
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/rooms") {
    return createRoom(request, env);
  }
  const joinMatch = JOIN_PATH.exec(pathname);
  if (joinMatch !== null) {
    return joinRoom(request, env, joinMatch[1]!);
  }
  const ticketMatch = TICKET_PATH.exec(pathname);
  if (ticketMatch !== null) {
    return issueRoomTicket(request, env, ticketMatch[1]!);
  }
  return null;
}
