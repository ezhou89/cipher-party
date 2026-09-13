import { hashToken } from "../auth/token";
import type { Env } from "../env";
import { apiError } from "./json";
import { normalizeRoomCode } from "./schemas";

type Admission = "create" | "join" | "ticket" | "connect";

const admissionBindings = {
  create: { ip: "CREATE_BY_IP", room: undefined },
  join: { ip: "JOIN_BY_IP", room: "JOIN_BY_ROOM" },
  ticket: { ip: "TICKET_BY_IP", room: "TICKET_BY_ROOM" },
  connect: { ip: "CONNECT_BY_IP", room: "CONNECT_BY_ROOM" },
} as const;

export function rateLimitedResponse(): Response {
  const response = apiError(429, "rate_limited");
  response.headers.set("Retry-After", "60");
  return response;
}

export async function checkAdmissionLimits(
  request: Request,
  env: Env,
  admission: Admission,
  untrustedCode?: string,
): Promise<Response | null> {
  const required = new URL(env.CANONICAL_ORIGIN).protocol === "https:";
  const ip = request.headers.get("CF-Connecting-IP")?.trim() || null;
  const code =
    untrustedCode === undefined ? null : normalizeRoomCode(untrustedCode);
  const names = admissionBindings[admission];
  const checks: Array<{
    binding: RateLimit | undefined;
    kind: string;
    value: string | null;
  }> = [{ binding: env[names.ip], kind: "ip", value: ip }];
  if (code !== null && names.room !== undefined) {
    checks.push({
      binding: env[names.room],
      kind: "room",
      value: code,
    });
  }

  // Every applicable platform counter completes before any room lookup, even
  // when another dimension denies or fails. These are per-location counters.
  const results = await Promise.allSettled(
    checks.map(async ({ binding, kind, value }) => {
      if (binding === undefined) return !required;
      if (value === null) return false;
      const key = `cipher-party:${env.CANONICAL_ORIGIN}:${admission}:${kind}:${await hashToken(value)}`;
      return (await binding.limit({ key })).success === true;
    }),
  );
  if (results.every((result) => result.status === "fulfilled" && result.value))
    return null;
  return rateLimitedResponse();
}
