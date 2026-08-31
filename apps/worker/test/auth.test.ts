import { describe, expect, it } from "vitest";

import { hashToken, randomToken, verifyToken } from "../src/auth/token";

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(44, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

describe("durable authentication tokens", () => {
  it("generates exactly 32 random bytes as unpadded base64url", () => {
    const tokens = Array.from({ length: 32 }, () => randomToken());

    expect(new Set(tokens)).toHaveLength(32);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(token).not.toContain("=");
      expect(decodeBase64Url(token)).toHaveLength(32);
    }
  });

  it("hashes without retaining the durable token and verifies the digest", async () => {
    const token = randomToken();
    const digest = await hashToken(token);

    expect(digest).not.toContain(token);
    await expect(verifyToken(token, digest)).resolves.toBe(true);
    await expect(verifyToken(randomToken(), digest)).resolves.toBe(false);
  });

  it("rejects malformed and equal-length incorrect digests", async () => {
    const token = randomToken();
    const digest = await hashToken(token);
    const firstByteChanged = `${digest.startsWith("00") ? "01" : "00"}${digest.slice(2)}`;
    const lastByteChanged = `${digest.slice(0, -2)}${digest.endsWith("00") ? "01" : "00"}`;

    await expect(verifyToken(token, "not-a-digest")).resolves.toBe(false);
    await expect(verifyToken(token, firstByteChanged)).resolves.toBe(false);
    await expect(verifyToken(token, lastByteChanged)).resolves.toBe(false);
  });
});
