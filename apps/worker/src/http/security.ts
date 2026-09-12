import type { Env } from "../env";
import { apiError } from "./json";

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function configuredOrigin(env: Env): URL | null {
  try {
    const origin = new URL(env.CANONICAL_ORIGIN);
    return (origin.protocol === "https:" || origin.protocol === "http:") &&
      origin.origin === env.CANONICAL_ORIGIN
      ? origin
      : null;
  } catch {
    return null;
  }
}

export function checkTransport(request: Request, env: Env): Response | null {
  const canonical = configuredOrigin(env);
  if (canonical === null) return apiError(500, "invalid_request");
  // Local HTTP configurations also serve the Vite proxy and isolated tests.
  if (canonical.protocol !== "https:") return null;

  const url = new URL(request.url);
  if (url.host !== canonical.host) return apiError(421, "invalid_request");
  if (url.protocol === "https:") return null;
  if (isApiPath(url.pathname)) return apiError(426, "invalid_request");

  url.protocol = "https:";
  return new Response(null, {
    status: 308,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
  });
}

export function secureResponse(
  request: Request,
  env: Env,
  response: Response,
): Response {
  // Reconstructing an upgrade would discard its WebSocket handle.
  if (response.status === 101) return response;

  const canonical = configuredOrigin(env);
  const socketOrigin =
    canonical === null
      ? ""
      : ` ${canonical.protocol === "https:" ? "wss" : "ws"}://${canonical.host}`;
  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self'",
      "font-src 'self'",
      `connect-src 'self'${socketOrigin}`,
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=()",
  );
  headers.set("X-Robots-Tag", "noindex, nofollow");
  const url = new URL(request.url);
  if (url.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000");
  } else {
    headers.delete("Strict-Transport-Security");
  }
  if (headers.get("Content-Type")?.toLowerCase().includes("text/html")) {
    // Keep the shell fresh and prevent edge transforms such as analytics injection.
    headers.set("Cache-Control", "no-store, no-transform");
  } else if (isApiPath(url.pathname) || response.status >= 400) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
