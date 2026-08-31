import { hashToken, randomToken } from "./token";

export const CONNECTION_TICKET_TTL_MS = 60_000;

export async function createConnectionTicket(now: number): Promise<{
  ticket: string;
  ticketHash: string;
  expiresAt: number;
}> {
  const ticket = randomToken();
  return {
    ticket,
    ticketHash: await hashToken(ticket),
    expiresAt: now + CONNECTION_TICKET_TTL_MS,
  };
}
