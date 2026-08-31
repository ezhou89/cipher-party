const TOKEN_BYTE_LENGTH = 32;
const SHA_256_BYTE_LENGTH = 32;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function decodeDigest(value: string): {
  bytes: Uint8Array;
  valid: number;
} {
  const bytes = new Uint8Array(SHA_256_BYTE_LENGTH);
  let valid = value.length === SHA_256_BYTE_LENGTH * 2 ? 0 : 1;
  for (let index = 0; index < SHA_256_BYTE_LENGTH; index += 1) {
    const pair = value.slice(index * 2, index * 2 + 2);
    const parsed = /^[0-9a-f]{2}$/u.test(pair) ? Number.parseInt(pair, 16) : 0;
    if (!/^[0-9a-f]{2}$/u.test(pair)) {
      valid |= 1;
    }
    bytes[index] = parsed;
  }
  return { bytes, valid };
}

export function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyToken(
  token: string,
  expectedDigest: string,
): Promise<boolean> {
  const actual = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const actualBytes = new Uint8Array(actual);
  const expected = decodeDigest(expectedDigest);
  let difference = expected.valid;
  for (let index = 0; index < SHA_256_BYTE_LENGTH; index += 1) {
    difference |= actualBytes[index]! ^ expected.bytes[index]!;
  }
  return difference === 0;
}
