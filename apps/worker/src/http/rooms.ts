import { hashToken, randomToken } from "../auth/token";
import type { Env } from "../env";
import { apiError, parseJson, tokenResponse } from "./json";
import {
  CreateRoomRequestSchema,
  JoinRoomRequestSchema,
  normalizeRoomCode,
  randomRoomCode,
} from "./schemas";

const MAX_CODE_CLAIM_ATTEMPTS = 32;

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function unavailable(): Response {
  return apiError(404, "room_unavailable");
}

export async function createRoom(
  request: Request,
  env: Env,
): Promise<Response> {
  const parsed = await parseJson(request, CreateRoomRequestSchema);
  if (!parsed.ok) {
    return parsed.response;
  }
  const origin = canonicalOrigin(env.CANONICAL_ORIGIN);
  if (origin === null) {
    return apiError(500, "invalid_request");
  }

  const playerId = crypto.randomUUID();
  const seatToken = randomToken();
  const hostToken = randomToken();
  const boardSeed = randomToken();
  const [seatTokenHash, hostTokenHash] = await Promise.all([
    hashToken(seatToken),
    hashToken(hostToken),
  ]);

  for (let attempt = 0; attempt < MAX_CODE_CLAIM_ATTEMPTS; attempt += 1) {
    const code = randomRoomCode();
    const inviteUrl = new URL(`/room/${code}`, origin).toString();
    const id = env.ROOMS.idFromName(code);
    const result = await env.ROOMS.get(id).initialize({
      code,
      hostPlayerId: playerId,
      hostDisplayName: parsed.data.displayName,
      inviteUrl,
      seatTokenHash,
      hostTokenHash,
      boardSeed,
    });
    if (!result.ok) {
      continue;
    }

    return tokenResponse(
      { code, inviteUrl, playerId, seatToken, hostToken },
      { status: 201, headers: { Location: inviteUrl } },
    );
  }

  return unavailable();
}

export async function joinRoom(
  request: Request,
  env: Env,
  untrustedCode: string,
): Promise<Response> {
  const parsed = await parseJson(request, JoinRoomRequestSchema);
  if (!parsed.ok) {
    return parsed.response;
  }
  const code = normalizeRoomCode(untrustedCode);
  if (code === null) {
    return unavailable();
  }

  const playerId = crypto.randomUUID();
  const seatToken = randomToken();
  const seatTokenHash = await hashToken(seatToken);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  const result = await stub.join({
    playerId,
    displayName: parsed.data.displayName,
    seatTokenHash,
    asSpectator: parsed.data.asSpectator,
  });
  if (!result.ok) {
    switch (result.code) {
      case "room_unavailable":
        return unavailable();
      case "room_locked":
        return apiError(409, "room_locked");
      case "room_in_progress":
        return apiError(409, "room_in_progress");
      case "room_full":
        return apiError(409, "room_full");
    }
  }

  return tokenResponse({ code, playerId, seatToken });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
  return match?.[1] ?? null;
}

export async function issueRoomTicket(
  request: Request,
  env: Env,
  untrustedCode: string,
): Promise<Response> {
  const code = normalizeRoomCode(untrustedCode);
  if (code === null) {
    return unavailable();
  }
  const seatToken = bearerToken(request);
  if (seatToken === null) {
    return apiError(401, "unauthorized");
  }

  const result = await env.ROOMS.get(env.ROOMS.idFromName(code)).issueTicket({
    seatToken,
    hostToken: request.headers.get("x-cipher-host-token"),
    now: Date.now(),
  });
  if (!result.ok) {
    return result.code === "room_unavailable"
      ? unavailable()
      : apiError(401, "unauthorized");
  }
  return tokenResponse({ ticket: result.ticket, expiresAt: result.expiresAt });
}
