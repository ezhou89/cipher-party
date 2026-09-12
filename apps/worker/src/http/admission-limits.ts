import { hashToken } from "../auth/token";
import type { Env } from "../env";
import { apiError } from "./json";
import { normalizeRoomCode } from "./schemas";

type Admission = "create" | "join" | "ticket";

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
  const ipBinding =
    admission === "create"
      ? env.CREATE_BY_IP
      : admission === "join"
        ? env.JOIN_BY_IP
        : env.TICKET_BY_IP;
  const checks: Array<{
    binding: RateLimit | undefined;
    kind: string;
    value: string | null;
  }> = [{ binding: ipBinding, kind: "ip", value: ip }];
  if (code !== null) {
    checks.push({
      binding: admission === "join" ? env.JOIN_BY_ROOM : env.TICKET_BY_ROOM,
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
  const response = apiError(429, "rate_limited");
  response.headers.set("Retry-After", "60");
  return response;
}
