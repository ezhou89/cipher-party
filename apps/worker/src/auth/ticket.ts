import { hashToken, randomToken, verifyToken } from "./token";

export const TICKET_TTL_MS = 60 * 1000;

export function randomTicket(): string {
  return randomToken();
}

export async function hashTicket(ticket: string): Promise<string> {
  return hashToken(ticket);
}

export async function verifyTicket(
  ticket: string,
  expectedDigest: string
): Promise<boolean> {
  return verifyToken(ticket, expectedDigest);
}
