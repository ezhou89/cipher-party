import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "cipher-party" });
    }
    return (
      env.ASSETS?.fetch(request) ?? new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
