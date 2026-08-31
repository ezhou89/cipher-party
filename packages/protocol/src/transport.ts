import { z } from "zod";

export const CommandErrorCodeSchema = z.enum([
  "invalid_command",
  "unauthorized",
  "wrong_phase",
  "stale_revision",
  "storage_failed",
  "room_locked",
  "room_full",
]);

export const CommandResultSchema = z.discriminatedUnion("ok", [
  z
    .object({ ok: z.literal(true), revision: z.number().int().nonnegative() })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      revision: z.number().int().nonnegative(),
      code: CommandErrorCodeSchema,
      message: z.string(),
    })
    .strict(),
]);

export type CommandErrorCode = z.infer<typeof CommandErrorCodeSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
