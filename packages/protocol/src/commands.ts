import { z } from "zod";

export const PROTOCOL_VERSION = 1;

const graphemeCount = (value: string) =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)
  ).length;

const clueWord = z
  .string()
  .trim()
  .transform((value) => value.normalize("NFC"))
  .pipe(
    z
      .string()
      .min(1)
      .refine(
        (value) => graphemeCount(value) <= 40,
        "Clue must be at most 40 graphemes"
      )
      .regex(/^[\p{L}\p{M}\p{N}'’-]+$/u)
  );

export const ClientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("randomize_teams") }).strict(),
  z
    .object({
      type: z.literal("assign_seat"),
      playerId: z.string().min(1),
      teamId: z.enum(["red", "blue"]).nullable()
    })
    .strict(),
  z
    .object({
      type: z.literal("set_role"),
      playerId: z.string().min(1),
      role: z.enum(["unassigned", "clue-giver", "operative", "spectator"])
    })
    .strict(),
  z.object({ type: z.literal("lock_room"), locked: z.boolean() }).strict(),
  z.object({ type: z.literal("start_board") }).strict(),
  z
    .object({
      type: z.literal("submit_clue"),
      word: clueWord,
      count: z.number().int().min(1).max(9)
    })
    .strict(),
  z.object({ type: z.literal("challenge_clue") }).strict(),
  z
    .object({
      type: z.literal("resolve_challenge"),
      decision: z.enum(["accept", "reject"])
    })
    .strict(),
  z
    .object({
      type: z.literal("nominate_card"),
      cardId: z.string().min(1)
    })
    .strict(),
  z.object({ type: z.literal("clear_nomination") }).strict(),
  z
    .object({
      type: z.literal("confirm_reveal"),
      cardId: z.string().min(1)
    })
    .strict(),
  z.object({ type: z.literal("end_turn") }).strict(),
  z.object({ type: z.literal("pause_room") }).strict(),
  z.object({ type: z.literal("resume_room") }).strict()
]);

export const CommandEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    command: ClientCommandSchema
  })
  .strict();

export type ClientCommand = z.infer<typeof ClientCommandSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
