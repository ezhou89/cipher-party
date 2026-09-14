import { describe, expect, it } from "vitest";

import { CommandEnvelopeSchema } from "./commands";
import { ServerMessageSchema } from "./transport";

const permissions = {
  configure: false,
  moderate: false,
  submitClue: false,
  challengeClue: false,
  nominate: false,
  confirmReveal: false,
  endTurn: false,
  resolveChallenge: false,
  pause: false,
  resume: false,
};

function operativeProjection() {
  return {
    protocolVersion: 2,
    revision: 5,
    code: "ABC123",
    inviteUrl: "https://cipher.example/room/ABC123",
    roomPhase: "lobby",
    locked: false,
    teamCount: 4,
    configuredTeams: ["red", "blue", "green", "yellow"],
    viewRole: "operative",
    viewer: {
      playerId: "operative",
      teamId: "red",
      role: "operative",
      isHost: false,
    },
    permissions,
    seats: [
      {
        playerId: "operative",
        displayName: "Operative",
        teamId: "red",
        role: "operative",
        connected: true,
      },
    ],
    publicHistory: [],
    board: null,
  } as const;
}

describe("ServerMessageSchema", () => {
  it.each([
    {
      type: "projection",
      projection: operativeProjection(),
    },
    {
      type: "command_result",
      commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
      result: { ok: true, revision: 5 },
    },
    {
      type: "error",
      code: "invalid_message",
      message: "Message did not match protocol",
    },
  ])("accepts the strict $type server message", (message) => {
    expect(ServerMessageSchema.safeParse(message).success).toBe(true);
  });

  it("rejects hidden ownership and nested extra fields in an operative projection", () => {
    const projection = operativeProjection();

    expect(
      ServerMessageSchema.safeParse({
        type: "projection",
        projection: { ...projection, key: { card: "hazard" } },
      }).success,
    ).toBe(false);
    expect(
      ServerMessageSchema.safeParse({
        type: "projection",
        projection: {
          ...projection,
          viewer: { ...projection.viewer, hiddenOwner: "hazard" },
        },
      }).success,
    ).toBe(false);
  });

  it("aliases the strict command envelope schema for client messages", async () => {
    const transport = await import("./transport");
    const message = {
      protocolVersion: 2,
      commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
      expectedRevision: 5,
      command: { type: "end_turn" },
    };

    expect(transport.ClientMessageSchema).toBe(CommandEnvelopeSchema);
    expect(transport.ClientMessageSchema.safeParse(message).success).toBe(true);
    expect(
      transport.ClientMessageSchema.safeParse({ ...message, playerId: "fake" })
        .success,
    ).toBe(false);
  });
});
