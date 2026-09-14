import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ClientProjectionSchema,
  CommandEnvelopeSchema,
  ServerMessageSchema
} from "./index";

const projectionFixtureNames = [
  "projection-lobby-unassigned.json",
  "projection-operative.json",
  "projection-clue-giver.json",
  "projection-spectator.json",
  "projection-challenged.json",
  "projection-paused.json",
  "projection-complete.json"
] as const;

const fixtureNames = [
  ...projectionFixtureNames,
  "command-envelopes.json",
  "server-messages.json"
] as const;

const protocolFixturesURL = new URL("../fixtures/ios/", import.meta.url);
const swiftFixturesURL = new URL(
  "../../../apps/ios/CipherPartyTests/Fixtures/",
  import.meta.url
);

function loadJSON(name: (typeof fixtureNames)[number]): unknown {
  const fixtureURL = new URL(name, protocolFixturesURL);
  return existsSync(fixtureURL)
    ? JSON.parse(readFileSync(fixtureURL, "utf8"))
    : null;
}

describe("iOS protocol fixtures", () => {
  it.each(projectionFixtureNames)(
    "validates %s with the protocol v1 projection schema",
    (name) => {
      expect(ClientProjectionSchema.safeParse(loadJSON(name)).success).toBe(
        true
      );
    }
  );

  it("validates every Classic command envelope", () => {
    const fixtures = loadJSON("command-envelopes.json");
    expect(Array.isArray(fixtures)).toBe(true);
    if (!Array.isArray(fixtures)) return;

    expect(fixtures).toHaveLength(14);
    for (const fixture of fixtures) {
      expect(CommandEnvelopeSchema.safeParse(fixture).success).toBe(true);
    }
  });

  it("covers the required nullable assign_seat teamId field", () => {
    const fixtures = loadJSON("command-envelopes.json");
    expect(Array.isArray(fixtures)).toBe(true);
    if (!Array.isArray(fixtures)) return;

    expect(fixtures).toContainEqual(
      expect.objectContaining({
        command: {
          type: "assign_seat",
          playerId: expect.any(String),
          teamId: null
        }
      })
    );
  });

  it("validates command successes, command failures, and transport errors", () => {
    const fixtures = loadJSON("server-messages.json");
    expect(Array.isArray(fixtures)).toBe(true);
    if (!Array.isArray(fixtures)) return;

    for (const fixture of fixtures) {
      expect(ServerMessageSchema.safeParse(fixture).success).toBe(true);
    }

    expect(fixtures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command_result",
          result: expect.objectContaining({ ok: true })
        }),
        ...[
          "invalid_command",
          "unauthorized",
          "wrong_phase",
          "stale_revision",
          "storage_failed",
          "room_locked",
          "room_full"
        ].map((code) =>
          expect.objectContaining({
            type: "command_result",
            result: expect.objectContaining({ ok: false, code })
          })
        ),
        expect.objectContaining({
          type: "error",
          code: "ticket_expired"
        })
      ])
    );
  });

  it.each([
    "projection-lobby-unassigned.json",
    "projection-operative.json",
    "projection-spectator.json"
  ] as const)("keeps hidden key data out of %s", (name) => {
    const fixture = loadJSON(name);
    expect(fixture).not.toBeNull();
    if (fixture === null) return;
    expect(fixture).not.toHaveProperty("key");
  });

  it("contains a key only in the clue-giver fixture", () => {
    const keyedFixtures = projectionFixtureNames.filter((name) => {
      const fixture = loadJSON(name);
      return (
        typeof fixture === "object" && fixture !== null && "key" in fixture
      );
    });

    expect(keyedFixtures).toEqual(["projection-clue-giver.json"]);
  });

  it.each(fixtureNames)(
    "ships identical Swift fixture bytes for %s",
    (name) => {
      const protocolURL = new URL(name, protocolFixturesURL);
      const swiftURL = new URL(name, swiftFixturesURL);
      expect(existsSync(protocolURL)).toBe(true);
      expect(existsSync(swiftURL)).toBe(true);
      if (!existsSync(protocolURL) || !existsSync(swiftURL)) return;

      expect(readFileSync(swiftURL).equals(readFileSync(protocolURL))).toBe(
        true
      );
    }
  );

  it("accepts exactly 100 public history entries and rejects 101", () => {
    const fixture = loadJSON("projection-complete.json") as Record<
      string,
      unknown
    >;
    const historyEntry = {
      revision: 1,
      at: "2026-09-13T12:00:00Z",
      type: "room_resumed"
    };
    const with100 = {
      ...fixture,
      publicHistory: Array.from({ length: 100 }, () => historyEntry)
    };
    const with101 = {
      ...fixture,
      publicHistory: Array.from({ length: 101 }, () => historyEntry)
    };

    expect(ClientProjectionSchema.safeParse(with100).success).toBe(true);
    expect(ClientProjectionSchema.safeParse(with101).success).toBe(false);
  });
});
