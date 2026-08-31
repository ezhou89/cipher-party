import type { z } from "zod";

export const MAX_BOOTSTRAP_BODY_BYTES = 4 * 1024;

export type ApiErrorCode =
  | "invalid_request"
  | "room_unavailable"
  | "room_locked"
  | "room_in_progress"
  | "room_full"
  | "unauthorized";

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  invalid_request: "Invalid request",
  room_unavailable: "Room is unavailable",
  room_locked: "Room is locked",
  room_in_progress: "Room is in progress",
  room_full: "Room is full",
  unauthorized: "Unauthorized",
};

export function apiError(status: number, code: ApiErrorCode): Response {
  return Response.json(
    { error: { code, message: ERROR_MESSAGES[code] } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function tokenResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function readBodyBytes(request: Request): Promise<Uint8Array | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const claimedLength = Number(contentLength);
    if (
      !Number.isInteger(claimedLength) ||
      claimedLength < 0 ||
      claimedLength > MAX_BOOTSTRAP_BODY_BYTES
    ) {
      return null;
    }
  }

  if (request.body === null) {
    return null;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    size += result.value.byteLength;
    if (size > MAX_BOOTSTRAP_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, response: apiError(400, "invalid_request") };
  }

  const bytes = await readBodyBytes(request);
  if (bytes === null) {
    return { ok: false, response: apiError(400, "invalid_request") };
  }

  try {
    const source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
    const parsed = schema.safeParse(JSON.parse(source) as unknown);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, response: apiError(400, "invalid_request") };
  } catch {
    return { ok: false, response: apiError(400, "invalid_request") };
  }
}
