import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  CommandResultSchema,
  PROTOCOL_VERSION
} from "./index";

describe("CommandEnvelopeSchema", () => {
  it("accepts a valid submit clue command", () => {
    expect(
      CommandEnvelopeSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
        expectedRevision: 4,
        command: { type: "submit_clue", word: "Cosmic", count: 2 }
      })
    ).toMatchObject({ expectedRevision: 4 });
  });

  it.each([
    { word: "two words", count: 2 },
    { word: "", count: 2 },
    { word: "Cosmic", count: 0 }
  ])("rejects an invalid clue: %o", ({ word, count }) => {
    const result = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
      expectedRevision: 4,
      command: { type: "submit_clue", word, count }
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields on commands due to strict mode", () => {
    const result = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
      expectedRevision: 4,
      command: { type: "end_turn", extraField: "malicious" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields on envelope due to strict mode", () => {
    const result = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
      expectedRevision: 4,
      command: { type: "end_turn" },
      impersonatedSeat: "seat-123"
    });
    expect(result.success).toBe(false);
  });

  it("accepts all standard gameplay commands", () => {
    const validCommands = [
      { type: "randomize_teams" as const },
      { type: "assign_seat" as const, playerId: "p1", teamId: "red" as const },
      { type: "set_role" as const, playerId: "p1", role: "operative" as const },
      { type: "lock_room" as const, locked: true },
      { type: "start_board" as const },
      { type: "challenge_clue" as const },
      { type: "resolve_challenge" as const, decision: "accept" as const },
      { type: "nominate_card" as const, cardId: "card-1" },
      { type: "clear_nomination" as const },
      { type: "confirm_reveal" as const, cardId: "card-1" },
      { type: "end_turn" as const },
      { type: "pause_room" as const },
      { type: "resume_room" as const }
    ];

    for (const command of validCommands) {
      const parsed = CommandEnvelopeSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
        expectedRevision: 1,
        command
      });
      expect(parsed.command.type).toBe(command.type);
    }
  });
});

describe("CommandResultSchema", () => {
  it("validates successful command results", () => {
    const success = CommandResultSchema.parse({ ok: true, revision: 5 });
    expect(success.ok).toBe(true);
  });

  it("validates failure command results with standard error codes", () => {
    const failure = CommandResultSchema.parse({
      ok: false,
      revision: 4,
      code: "unauthorized",
      message: "Only clue-givers may submit clues"
    });
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.code).toBe("unauthorized");
    }
  });
});
