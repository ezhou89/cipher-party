import { hashToken } from "../auth/token";
import type { Env } from "../env";

export const MAX_SOCKETS_PER_SEAT = 4;
export const MAX_SOCKETS_PER_ROOM = 64;
export const MAX_TICKETS_PER_SEAT = 8;
export const MAX_TICKETS_PER_ROOM = 256;

export function hasSocketCapacity(
  state: Pick<DurableObjectState, "getWebSockets">,
  playerId: string,
): boolean {
  // Inventory includes closing sockets until the runtime detaches them.
  return (
    state.getWebSockets().length < MAX_SOCKETS_PER_ROOM &&
    state.getWebSockets(playerId).length < MAX_SOCKETS_PER_SEAT
  );
}

export async function checkMessageBudget(
  env: Pick<Env, "CANONICAL_ORIGIN" | "COMMAND_BY_SEAT" | "COMMAND_BY_ROOM">,
  roomCode: string,
  playerId: string,
): Promise<boolean> {
  const required = new URL(env.CANONICAL_ORIGIN).protocol === "https:";
  const dimensions = [
    {
      binding: env.COMMAND_BY_SEAT,
      purpose: "seat",
      identity: [env.CANONICAL_ORIGIN, roomCode, playerId],
    },
    {
      binding: env.COMMAND_BY_ROOM,
      purpose: "room",
      identity: [env.CANONICAL_ORIGIN, roomCode],
    },
  ];
  // Native location-local counters outlive sockets and hibernation. They are
  // approximate abuse limits, not globally exact accounting or room state.
  const results = await Promise.allSettled(
    dimensions.map(async ({ binding, purpose, identity }) => {
      if (binding === undefined) return !required;
      const key = `cipher-party:command:${purpose}:${await hashToken(JSON.stringify(identity))}`;
      return (await binding.limit({ key })).success === true;
    }),
  );
  return results.every(
    (result) => result.status === "fulfilled" && result.value,
  );
}
