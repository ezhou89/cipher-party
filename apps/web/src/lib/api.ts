import type { SeatCredentials } from "./seat-store";

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CANONICAL_ROOM_CODE_PATTERN = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/u;
const ORIGINAL_ROOM_CODE_PATTERN = /^[A-Za-z0-9]{6}$/u;

export type PublicApiErrorCode =
  | "invalid_request"
  | "room_unavailable"
  | "room_locked"
  | "room_in_progress"
  | "room_full"
  | "unauthorized"
  | "rate_limited"
  | "network_error"
  | "unexpected_response";

const PUBLIC_ERROR_MESSAGES: Record<PublicApiErrorCode, string> = {
  invalid_request: "Check the information you entered and try again.",
  room_unavailable: "Room is unavailable.",
  room_locked: "Room is locked.",
  room_in_progress: "Room is already in progress.",
  room_full: "Room is full.",
  unauthorized: "This room credential is no longer valid.",
  rate_limited: "Too many attempts. Please wait a minute and try again.",
  network_error:
    "Unable to reach Cipher Party. Check your connection and try again.",
  unexpected_response:
    "Cipher Party received an unexpected response. Please try again.",
};

export class ApiError extends Error {
  constructor(
    readonly code: PublicApiErrorCode,
    readonly status: number | null = null,
  ) {
    super(PUBLIC_ERROR_MESSAGES[code]);
    this.name = "ApiError";
  }
}

export interface CreateRoomResponse {
  code: string;
  inviteUrl: string;
  playerId: string;
  seatToken: string;
  hostToken: string;
}

export interface JoinRoomResponse {
  code: string;
  playerId: string;
  seatToken: string;
}

export interface ConnectionTicket {
  ticket: string;
  expiresAt: number;
}

export interface WebSocketLocation {
  protocol: string;
  host: string;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  return actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key))
    ? record
    : null;
}

function isCanonicalInviteUrl(value: string, code: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === `/room/${code}` &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isCredentialField(value: unknown): value is string {
  return typeof value === "string" && TICKET_PATTERN.test(value);
}

function parseCreateRoomResponse(value: unknown): CreateRoomResponse | null {
  const record = exactRecord(value, [
    "code",
    "inviteUrl",
    "playerId",
    "seatToken",
    "hostToken",
  ]);
  if (
    record === null ||
    typeof record.code !== "string" ||
    !CANONICAL_ROOM_CODE_PATTERN.test(record.code) ||
    typeof record.inviteUrl !== "string" ||
    !isCanonicalInviteUrl(record.inviteUrl, record.code) ||
    typeof record.playerId !== "string" ||
    record.playerId.length === 0 ||
    !isCredentialField(record.seatToken) ||
    !isCredentialField(record.hostToken)
  ) {
    return null;
  }
  return {
    code: record.code,
    inviteUrl: record.inviteUrl,
    playerId: record.playerId,
    seatToken: record.seatToken,
    hostToken: record.hostToken,
  };
}

function parseJoinRoomResponse(value: unknown): JoinRoomResponse | null {
  const record = exactRecord(value, ["code", "playerId", "seatToken"]);
  if (
    record === null ||
    typeof record.code !== "string" ||
    !CANONICAL_ROOM_CODE_PATTERN.test(record.code) ||
    typeof record.playerId !== "string" ||
    record.playerId.length === 0 ||
    !isCredentialField(record.seatToken)
  ) {
    return null;
  }
  return {
    code: record.code,
    playerId: record.playerId,
    seatToken: record.seatToken,
  };
}

function parsePublicError(value: unknown, status: number): ApiError {
  const outer = exactRecord(value, ["error"]);
  const inner =
    outer === null ? null : exactRecord(outer.error, ["code", "message"]);
  const code = inner?.code;
  if (
    typeof code === "string" &&
    Object.hasOwn(PUBLIC_ERROR_MESSAGES, code) &&
    code !== "network_error" &&
    code !== "unexpected_response" &&
    typeof inner?.message === "string"
  ) {
    return new ApiError(code as PublicApiErrorCode, status);
  }
  return new ApiError("unexpected_response", status);
}

async function postJson(
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network_error");
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiError("unexpected_response", response.status);
  }
  if (!response.ok) {
    throw parsePublicError(value, response.status);
  }
  return value;
}

export function normalizeRoomCodeInput(value: string): string | null {
  const trimmed = value.trim();
  if (!ORIGINAL_ROOM_CODE_PATTERN.test(trimmed)) {
    return null;
  }
  const normalized = trimmed
    .toUpperCase()
    .replaceAll("O", "0")
    .replace(/[IL]/gu, "1");
  return CANONICAL_ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}

export async function createRoom(
  displayName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateRoomResponse> {
  const value = await postJson("/api/rooms", { displayName }, fetchImpl);
  const parsed = parseCreateRoomResponse(value);
  if (parsed === null) {
    throw new ApiError("unexpected_response");
  }
  return parsed;
}

export async function joinRoom(
  code: string,
  displayName: string,
  asSpectator: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<JoinRoomResponse> {
  const value = await postJson(
    `/api/rooms/${encodeURIComponent(code)}/join`,
    { displayName, asSpectator },
    fetchImpl,
  );
  const parsed = parseJoinRoomResponse(value);
  if (parsed === null) {
    throw new ApiError("unexpected_response");
  }
  return parsed;
}

export async function requestConnectionTicket(
  credentials: SeatCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTicket> {
  const headers = new Headers({
    Authorization: `Bearer ${credentials.seatToken}`,
  });
  if (credentials.hostToken !== undefined) {
    headers.set("X-Cipher-Host-Token", credentials.hostToken);
  }
  const response = await fetchImpl(
    `/api/rooms/${encodeURIComponent(credentials.code)}/tickets`,
    { method: "POST", headers },
  );
  if (!response.ok) {
    let error: unknown;
    try {
      error = await response.json();
    } catch {
      throw new ApiError("unexpected_response", response.status);
    }
    throw parsePublicError(error, response.status);
  }
  const value: unknown = await response.json();
  const record =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (
    record === null ||
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, "ticket") ||
    !Object.hasOwn(record, "expiresAt") ||
    !TICKET_PATTERN.test(
      typeof record.ticket === "string" ? record.ticket : "",
    ) ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt)
  ) {
    throw new Error("Room connection ticket response was malformed");
  }
  return {
    ticket: record.ticket as string,
    expiresAt: record.expiresAt,
  };
}

export function roomWebSocketUrl(
  code: string,
  ticket: string,
  location: WebSocketLocation = window.location,
): string {
  if (!TICKET_PATTERN.test(ticket)) {
    throw new Error("Room connection ticket was malformed");
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(
    `/api/rooms/${encodeURIComponent(code)}/connect`,
    `${protocol}//${location.host}`,
  );
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
