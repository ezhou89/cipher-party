import type { z } from "zod";

export type ApiErrorCode =
  | "invalid_request"
  | "room_unavailable"
  | "room_locked"
  | "room_in_progress"
  | "room_full"
  | "unauthorized";

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export function jsonResponse(
  data: unknown,
  init: ResponseInit = {},
  isTokenBearing = false
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (isTokenBearing) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number
): Response {
  return jsonResponse({ error: { code, message } }, { status });
}

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 4096
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: errorResponse(
        "invalid_request",
        "Content-Type must be application/json",
        400
      )
    };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    return {
      ok: false,
      response: errorResponse("invalid_request", "Request body too large", 400)
    };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return {
      ok: false,
      response: errorResponse(
        "invalid_request",
        "Failed to read request body",
        400
      )
    };
  }

  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return {
      ok: false,
      response: errorResponse("invalid_request", "Request body too large", 400)
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: errorResponse("invalid_request", "Malformed JSON body", 400)
    };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message = firstIssue ? firstIssue.message : "Validation failed";
    return {
      ok: false,
      response: errorResponse("invalid_request", message, 400)
    };
  }

  return { ok: true, data: result.data };
}
