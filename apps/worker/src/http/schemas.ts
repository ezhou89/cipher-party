import { z } from "zod";

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

export const DisplayNameSchema = z
  .string()
  .refine(
    (value) => !hasControlCharacters(value),
    "Display name has control characters"
  )
  .transform((value) => value.trim().normalize("NFC"))
  .pipe(
    z
      .string()
      .min(1, "Display name cannot be empty")
      .refine(
        (value) =>
          Array.from(
            new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
              value
            )
          ).length <= 24,
        "Display name is too long"
      )
  );

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CROCKFORD_ALPHABET[bytes[i]! % CROCKFORD_ALPHABET.length];
  }
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[\s-]/g, "");
}

export const RoomCodeSchema = z
  .string()
  .transform(normalizeRoomCode)
  .refine(
    (val) =>
      val.length === 6 && /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/.test(val),
    "Invalid room code"
  );

export const CreateRoomRequestSchema = z.object({
  displayName: DisplayNameSchema
});

export const JoinRoomRequestSchema = z.object({
  displayName: DisplayNameSchema,
  asSpectator: z.boolean().optional().default(false)
});
