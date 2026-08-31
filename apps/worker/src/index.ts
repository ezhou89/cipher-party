import type { Env } from "./env";
import { routeApiRequest } from "./http/router";

export { RoomDurableObject } from "./room/room-durable-object";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "cipher-party" });
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
