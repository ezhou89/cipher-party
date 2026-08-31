import { z } from "zod";

import { CommandEnvelopeSchema } from "./commands";
import { ClientProjectionSchema } from "./projections";

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

export const ClientMessageSchema = CommandEnvelopeSchema;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("projection"),
      projection: ClientProjectionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("command_result"),
      commandId: z.string().uuid(),
      result: CommandResultSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.enum(["invalid_message", "ticket_expired", "internal_error"]),
      message: z.string(),
    })
    .strict(),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
