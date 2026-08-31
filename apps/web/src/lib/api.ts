import type { SeatCredentials } from "./seat-store";

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface ConnectionTicket {
  ticket: string;
  expiresAt: number;
}

export interface WebSocketLocation {
  protocol: string;
  host: string;
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
    throw new Error("Room connection ticket request failed");
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
