import { describe, expect, it } from "vitest";
import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ClientProjection,
  type ServerMessage
} from "./index";

function sampleOperativeProjection(): ClientProjection {
  return {
    protocolVersion: 1,
    viewRole: "operative",
    code: "ABC234",
    inviteUrl: "http://127.0.0.1:5173/room/ABC234",
    revision: 5,
    roomPhase: "lobby",
    locked: false,
    viewer: {
      playerId: "player-op",
      teamId: "red",
      role: "operative",
      isHost: false
    },
    permissions: {
      configure: false,
      moderate: false,
      submitClue: false,
      challengeClue: false,
      nominate: true,
      confirmReveal: true,
      endTurn: true,
      resolveChallenge: false,
      pause: false,
      resume: false
    },
    seats: [
      {
        playerId: "player-op",
        displayName: "Operative",
        teamId: "red",
        role: "operative",
        connected: true
      }
    ],
    publicHistory: [],
    board: null
  };
}

describe("Transport and ServerMessage Schema", () => {
  it("accepts valid projection, command_result, and error server messages", () => {
    const projectionMessage: ServerMessage = {
      type: "projection",
      projection: sampleOperativeProjection()
    };
    expect(ServerMessageSchema.safeParse(projectionMessage).success).toBe(true);

    const commandResultMessage: ServerMessage = {
      type: "command_result",
      commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
      result: { ok: true, revision: 5 }
    };
    expect(ServerMessageSchema.safeParse(commandResultMessage).success).toBe(
      true
    );

    const errorMessage: ServerMessage = {
      type: "error",
      code: "invalid_message",
      message: "Message did not match protocol"
    };
    expect(ServerMessageSchema.safeParse(errorMessage).success).toBe(true);
  });

  it("rejects an operative projection containing a key", () => {
    const invalidProjection = {
      ...sampleOperativeProjection(),
      key: {
        "card-1": "red"
      }
    };
    const invalidMessage = {
      type: "projection",
      projection: invalidProjection
    };
    expect(ServerMessageSchema.safeParse(invalidMessage).success).toBe(false);
  });

  it("rejects server messages with extra fields or invalid message types", () => {
    const extraFieldMessage = {
      type: "error",
      code: "invalid_message",
      message: "bad",
      extra: "not allowed"
    };
    expect(ServerMessageSchema.safeParse(extraFieldMessage).success).toBe(
      false
    );

    const unknownTypeMessage = {
      type: "unknown_event",
      payload: {}
    };
    expect(ServerMessageSchema.safeParse(unknownTypeMessage).success).toBe(
      false
    );
  });

  it("validates client messages through ClientMessageSchema", () => {
    const validClientMessage = {
      protocolVersion: 1,
      commandId: "018f6c2e-6f44-7ef0-8000-000000000002",
      expectedRevision: 0,
      command: {
        type: "lock_room",
        locked: true
      }
    };
    expect(ClientMessageSchema.safeParse(validClientMessage).success).toBe(
      true
    );

    const invalidClientMessage = {
      protocolVersion: 1,
      commandId: "not-a-uuid",
      expectedRevision: 0,
      command: {
        type: "lock_room",
        locked: true
      }
    };
    expect(ClientMessageSchema.safeParse(invalidClientMessage).success).toBe(
      false
    );
  });
});
