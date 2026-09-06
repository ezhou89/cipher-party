import { hashToken, randomToken } from "../auth/token";
import type { Env } from "../env";
import { errorResponse, jsonResponse, parseJsonBody } from "./json";
import {
  CreateRoomRequestSchema,
  generateRoomCode,
  JoinRoomRequestSchema,
  RoomCodeSchema
} from "./schemas";

export async function handleCreateRoom(
  request: Request,
  env: Env
): Promise<Response> {
  const parsed = await parseJsonBody(request, CreateRoomRequestSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { displayName } = parsed.data;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const id = env.ROOMS.idFromName(code);
    const stub = env.ROOMS.get(id);

    const playerId = crypto.randomUUID();
    const seatToken = randomToken();
    const hostToken = randomToken();
    const seatTokenHash = await hashToken(seatToken);
    const hostTokenHash = await hashToken(hostToken);
    const boardSeed = randomToken();
    const inviteUrl = new URL(`/room/${code}`, env.CANONICAL_ORIGIN).toString();

    const initResult = await stub.initialize({
      code,
      hostPlayerId: playerId,
      hostDisplayName: displayName,
      inviteUrl,
      seatTokenHash,
      hostTokenHash,
      boardSeed
    });

    if (initResult.ok) {
      return jsonResponse(
        {
          code,
          inviteUrl,
          playerId,
          seatToken,
          hostToken
        },
        { status: 201 },
        true
      );
    }
  }

  return errorResponse("invalid_request", "Failed to allocate room", 500);
}

export async function handleJoinRoom(
  request: Request,
  env: Env,
  rawCode: string
): Promise<Response> {
  const codeResult = RoomCodeSchema.safeParse(rawCode);
  if (!codeResult.success) {
    return errorResponse("room_unavailable", "Room not found or expired", 404);
  }
  const code = codeResult.data;

  const parsed = await parseJsonBody(request, JoinRoomRequestSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  const id = env.ROOMS.idFromName(code);
  const stub = env.ROOMS.get(id);

  const playerId = crypto.randomUUID();
  const seatToken = randomToken();
  const seatTokenHash = await hashToken(seatToken);

  const joinResult = await stub.join({
    playerId,
    displayName: parsed.data.displayName,
    seatTokenHash,
    asSpectator: parsed.data.asSpectator
  });

  if (joinResult.ok) {
    return jsonResponse(
      {
        code,
        playerId,
        seatToken
      },
      { status: 200 },
      true
    );
  }

  switch (joinResult.code) {
    case "room_unavailable":
      return errorResponse(
        "room_unavailable",
        "Room not found or expired",
        404
      );
    case "room_locked":
      return errorResponse("room_locked", "Room is locked", 409);
    case "room_in_progress":
      return errorResponse(
        "room_in_progress",
        "Game is in progress; join as spectator",
        409
      );
    case "room_full":
      return errorResponse(
        "room_full",
        "Room has reached maximum capacity",
        409
      );
  }
}

export async function handleIssueTicket(
  request: Request,
  env: Env,
  rawCode: string
): Promise<Response> {
  const codeResult = RoomCodeSchema.safeParse(rawCode);
  if (!codeResult.success) {
    return errorResponse("room_unavailable", "Room not found or expired", 404);
  }
  const code = codeResult.data;

  const authHeader = request.headers.get("authorization");
  const match = authHeader?.match(/^Bearer\s+([A-Za-z0-9_-]+)$/i);
  if (!match) {
    return errorResponse(
      "unauthorized",
      "Missing or invalid authorization bearer token",
      401
    );
  }

  const seatToken = match[1]!;
  const hostToken = request.headers.get("x-cipher-host-token");
  const now = Date.now();

  const id = env.ROOMS.idFromName(code);
  const stub = env.ROOMS.get(id);

  const ticketResult = await stub.issueTicket({
    seatToken,
    hostToken,
    now
  });

  if (ticketResult.ok) {
    return jsonResponse(
      {
        ticket: ticketResult.ticket,
        expiresAt: ticketResult.expiresAt
      },
      { status: 200 },
      true
    );
  }

  switch (ticketResult.code) {
    case "room_unavailable":
      return errorResponse(
        "room_unavailable",
        "Room not found or expired",
        404
      );
    case "unauthorized":
      return errorResponse("unauthorized", "Invalid authentication token", 401);
  }
}
