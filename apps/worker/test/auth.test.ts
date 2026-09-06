import { describe, expect, it } from "vitest";
import {
  hashToken,
  randomToken,
  timingSafeEqualString,
  verifyToken
} from "../src/auth/token";

describe("Token Authentication", () => {
  it("hashes without retaining the durable token", async () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = await hashToken(token);
    expect(digest).not.toContain(token);
    await expect(verifyToken(token, digest)).resolves.toBe(true);
    await expect(verifyToken(randomToken(), digest)).resolves.toBe(false);
  });

  it("produces 32 random bytes encoded as unpadded base64url", () => {
    const token1 = randomToken();
    const token2 = randomToken();
    expect(token1).not.toBe(token2);
    expect(token1).toHaveLength(43);
    expect(token1).not.toContain("=");
    expect(token1).not.toContain("+");
    expect(token1).not.toContain("/");
  });

  it("performs constant time string comparison safely", () => {
    expect(timingSafeEqualString("hello", "hello")).toBe(true);
    expect(timingSafeEqualString("hello", "world")).toBe(false);
    expect(timingSafeEqualString("hello", "hell")).toBe(false);
    expect(timingSafeEqualString("", "")).toBe(true);
    expect(timingSafeEqualString("a", "")).toBe(false);
  });
});
