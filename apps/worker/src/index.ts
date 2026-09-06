import type { Env } from "./env";
import { routeRequest } from "./http/router";

export { RoomDurableObject } from "./room/room-durable-object";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const apiResponse = await routeRequest(request, env);
    if (apiResponse) {
      return apiResponse;
    }
    return (
      env.ASSETS?.fetch(request) ?? new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
