import { describe, expect, it } from "vitest";
import {
  ClientCommandSchema,
  CommandEnvelopeSchema,
  CommandResultSchema,
  PROTOCOL_VERSION,
} from "./index";

const validEnvelope = (command: unknown) => ({
  protocolVersion: PROTOCOL_VERSION,
  commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
  expectedRevision: 4,
  command,
});

describe("CommandEnvelopeSchema", () => {
  it("uses protocol version 2", () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it("accepts a valid submit clue command", () => {
    expect(
      CommandEnvelopeSchema.parse(
        validEnvelope({ type: "submit_clue", word: "Cosmic", count: 2 }),
      ),
    ).toMatchObject({ expectedRevision: 4 });
  });

  it.each([
    { word: "two words", count: 2 },
    { word: "", count: 2 },
    { word: "Cosmic", count: 0 },
  ])("rejects an invalid clue: %o", ({ word, count }) => {
    expect(
      CommandEnvelopeSchema.safeParse(
        validEnvelope({ type: "submit_clue", word, count }),
      ).success,
    ).toBe(false);
  });

  it("normalizes and trims a permitted Unicode clue", () => {
    const parsed = CommandEnvelopeSchema.parse(
      validEnvelope({
        type: "submit_clue",
        word: "  cafe\u0301-l’été  ",
        count: 9,
      }),
    );

    expect(parsed.command).toEqual({
      type: "submit_clue",
      word: "café-l’été",
      count: 9,
    });
  });

  it("counts grapheme clusters rather than code units at the clue maximum", () => {
    expect(
      CommandEnvelopeSchema.safeParse(
        validEnvelope({
          type: "submit_clue",
          word: "a\u0300\u0301".repeat(40),
          count: 1,
        }),
      ).success,
    ).toBe(true);
  });

  it.each(["two words", "wo\trd", "wo\nrd", "word!", "a".repeat(41), "👩🏽‍🚀"])(
    "rejects invalid clue syntax or length: %s",
    (word) => {
      expect(
        CommandEnvelopeSchema.safeParse(
          validEnvelope({ type: "submit_clue", word, count: 1 }),
        ).success,
      ).toBe(false);
    },
  );

  it.each([0, 10, 1.5])("rejects an out-of-range clue count: %s", (count) => {
    expect(
      CommandEnvelopeSchema.safeParse(
        validEnvelope({ type: "submit_clue", word: "Cosmic", count }),
      ).success,
    ).toBe(false);
  });

  it.each([
    { type: "randomize_teams" },
    { type: "set_team_count", teamCount: 4 },
    { type: "assign_seat", playerId: "player-1", teamId: "red" },
    { type: "assign_seat", playerId: "player-2", teamId: "green" },
    { type: "assign_seat", playerId: "player-3", teamId: "yellow" },
    { type: "set_role", playerId: "player-1", role: "operative" },
    { type: "lock_room", locked: true },
    { type: "start_board" },
    { type: "submit_clue", word: "Cosmic", count: 2 },
    { type: "challenge_clue" },
    { type: "resolve_challenge", decision: "accept" },
    { type: "nominate_card", cardId: "card-1" },
    { type: "clear_nomination" },
    { type: "confirm_reveal", cardId: "card-1" },
    { type: "end_turn" },
    { type: "pause_room" },
    { type: "resume_room" },
  ])("accepts command variant %#", (command) => {
    expect(ClientCommandSchema.safeParse(command).success).toBe(true);
  });

  it.each([2, 3, 4])("accepts supported team count: %s", (teamCount) => {
    expect(
      ClientCommandSchema.safeParse({
        type: "set_team_count",
        teamCount,
      }).success,
    ).toBe(true);
  });

  it.each([1, 5, 2.5])("rejects unsupported team count: %s", (teamCount) => {
    expect(
      ClientCommandSchema.safeParse({
        type: "set_team_count",
        teamCount,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown envelope fields", () => {
    expect(
      CommandEnvelopeSchema.safeParse({
        ...validEnvelope({ type: "end_turn" }),
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown command fields instead of stripping them", () => {
    expect(
      ClientCommandSchema.safeParse({ type: "end_turn", extra: true }).success,
    ).toBe(false);
  });

  it.each([
    { type: "end_turn", actorId: "player-1" },
    { type: "submit_clue", word: "Cosmic", count: 2, actorId: "player-1" },
    { type: "nominate_card", cardId: "card-1", teamId: "red" },
  ])("rejects client-authored actor identity or team fields: %o", (command) => {
    expect(
      CommandEnvelopeSchema.safeParse(validEnvelope(command)).success,
    ).toBe(false);
  });
});

describe("CommandResultSchema", () => {
  it("accepts both stable result variants", () => {
    expect(
      CommandResultSchema.safeParse({ ok: true, revision: 5 }).success,
    ).toBe(true);
    expect(
      CommandResultSchema.safeParse({
        ok: false,
        revision: 5,
        code: "stale_revision",
        message: "Room revision has advanced",
      }).success,
    ).toBe(true);
  });

  it.each([
    { ok: true, revision: 5, extra: true },
    {
      ok: false,
      revision: 5,
      code: "stale_revision",
      message: "Resync",
      extra: true,
    },
  ])("rejects unknown result fields: %o", (result) => {
    expect(CommandResultSchema.safeParse(result).success).toBe(false);
  });
});
