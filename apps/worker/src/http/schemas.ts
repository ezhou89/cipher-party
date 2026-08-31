import { z } from "zod";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const DisplayNameSchema = z
  .string()
  .refine(
    // Display names are text-only and must reject the ASCII control ranges.
    // eslint-disable-next-line no-control-regex
    (value) => !/[\u0000-\u001F\u007F]/u.test(value),
    "Display name has control characters",
  )
  .transform((value) => value.trim().normalize("NFC"))
  .pipe(
    z
      .string()
      .min(1)
      .refine(
        (value) =>
          Array.from(
            new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
              value,
            ),
          ).length <= 24,
        "Display name is too long",
      ),
  );

export const CreateRoomRequestSchema = z
  .object({ displayName: DisplayNameSchema })
  .strict();

export const JoinRoomRequestSchema = z
  .object({
    displayName: DisplayNameSchema,
    asSpectator: z.boolean().optional().default(false),
  })
  .strict();

export function normalizeRoomCode(value: string): string | null {
  if (
    value.length !== 6 ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return !(
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a)
      );
    })
  ) {
    return null;
  }
  const normalized = value
    .toUpperCase()
    .replaceAll("O", "0")
    .replace(/[IL]/gu, "1");
  if (
    normalized.length !== 6 ||
    Array.from(normalized).some(
      (character) => !CROCKFORD_ALPHABET.includes(character),
    )
  ) {
    return null;
  }
  return normalized;
}

export function randomRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CROCKFORD_ALPHABET[byte & 31]!).join("");
}
