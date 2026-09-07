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

export interface TicketResponse {
  ticket: string;
  expiresAt: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function createRoom(
  displayName: string,
  baseUrl = ""
): Promise<CreateRoomResponse> {
  const res = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName })
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiError;
    throw new ApiRequestError(
      data.error?.code ?? "request_failed",
      data.error?.message ?? "Failed to create room",
      res.status
    );
  }
  return res.json() as Promise<CreateRoomResponse>;
}

export async function joinRoom(
  code: string,
  displayName: string,
  asSpectator = false,
  baseUrl = ""
): Promise<JoinRoomResponse> {
  const res = await fetch(`${baseUrl}/api/rooms/${code}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, asSpectator })
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiError;
    throw new ApiRequestError(
      data.error?.code ?? "request_failed",
      data.error?.message ?? "Failed to join room",
      res.status
    );
  }
  return res.json() as Promise<JoinRoomResponse>;
}

export async function requestTicket(
  code: string,
  seatToken: string,
  hostToken?: string,
  baseUrl = ""
): Promise<TicketResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${seatToken}`
  };
  if (hostToken) {
    headers["X-Cipher-Host-Token"] = hostToken;
  }
  const res = await fetch(`${baseUrl}/api/rooms/${code}/tickets`, {
    method: "POST",
    headers
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiError;
    throw new ApiRequestError(
      data.error?.code ?? "request_failed",
      data.error?.message ?? "Failed to request ticket",
      res.status
    );
  }
  return res.json() as Promise<TicketResponse>;
}
