import type {
  BoardCard,
  ClassicBoard,
  ClassicGameState
} from "@cipher-party/game-core";
import { describe, expect, it } from "vitest";
import {
  ClientProjectionSchema,
  projectRoomForSeat,
  type ClueGiverProjection,
  type OperativeProjection,
  type RoomProjectionSource
} from "./index";

function roomSource(): RoomProjectionSource {
  const cards: Record<string, BoardCard> = {
    "red-1": { id: "red-1", label: "Red 1", owner: "red", revealed: false },
    "red-2": { id: "red-2", label: "Red 2", owner: "red", revealed: true },
    "blue-1": { id: "blue-1", label: "Blue 1", owner: "blue", revealed: false },
    "neutral-1": {
      id: "neutral-1",
      label: "Neutral 1",
      owner: "neutral",
      revealed: false
    },
    "hazard-1": {
      id: "hazard-1",
      label: "Hazard 1",
      owner: "hazard",
      revealed: false
    }
  };
  const order = ["red-1", "red-2", "blue-1", "neutral-1", "hazard-1"];
  const board: ClassicBoard = {
    order,
    cards,
    startingTeam: "red"
  };
  const game: ClassicGameState = {
    board,
    phase: "guess",
    resumePhase: null,
    activeTeam: "red",
    clue: { word: "Cosmic", count: 2 },
    guessesRemaining: 2,
    nomination: { playerId: "op1", cardId: "red-1" },
    winner: null,
    completionReason: null
  };

  return {
    protocolVersion: 1,
    code: "TESTROOM",
    inviteUrl: "https://cipher.party/TESTROOM",
    revision: 3,
    roomPhase: "playing",
    locked: false,
    seats: [
      {
        playerId: "viewer",
        displayName: "Viewer",
        teamId: "red",
        role: "operative",
        connected: true
      },
      {
        playerId: "red-clue",
        displayName: "ClueGiver",
        teamId: "red",
        role: "clue-giver",
        connected: true
      }
    ],
    publicHistory: [
      {
        revision: 1,
        at: "2026-09-05T12:00:00Z",
        type: "clue_submitted",
        teamId: "red",
        word: "Cosmic",
        count: 2
      },
      {
        revision: 2,
        at: "2026-09-05T12:01:00Z",
        type: "card_revealed",
        teamId: "red",
        cardId: "red-2",
        owner: "red"
      }
    ],
    game
  };
}

describe("Role-Safe Room Projections", () => {
  it.each([
    { role: "operative" as const, teamId: "red" as const, isHost: false },
    { role: "spectator" as const, teamId: null, isHost: false },
    { role: "operative" as const, teamId: "red" as const, isHost: true },
    { role: "unassigned" as const, teamId: null, isHost: false }
  ])("omits the key and unrevealed ownership for $role", (viewer) => {
    const projection = projectRoomForSeat(roomSource(), {
      playerId: "viewer",
      ...viewer
    });

    expect("key" in projection).toBe(false);
    expect(JSON.stringify(projection)).not.toContain('"hazard"');
    expect(
      projection.board?.cards
        .filter((card) => !card.revealed)
        .every((card) => !("owner" in card))
    ).toBe(true);
  });

  it("gives a clue-giver the complete key", () => {
    const projection = projectRoomForSeat(roomSource(), {
      playerId: "red-clue",
      role: "clue-giver",
      teamId: "red",
      isHost: false
    });

    expect(projection.viewRole).toBe("clue-giver");
    expect("key" in projection).toBe(true);
    if ("key" in projection) {
      expect(projection.key).toEqual(
        expect.objectContaining({ "hazard-1": "hazard" })
      );
      expect(Object.keys(projection.key)).toHaveLength(5);
    }
  });

  it("exposes only public ownership for revealed cards", () => {
    const projection = projectRoomForSeat(roomSource(), {
      playerId: "viewer",
      role: "operative",
      teamId: "red",
      isHost: false
    });

    const revealedCard = projection.board?.cards.find((c) => c.id === "red-2");
    expect(revealedCard?.revealed).toBe(true);
    expect(revealedCard?.owner).toBe("red");

    const unrevealedCard = projection.board?.cards.find(
      (c) => c.id === "red-1"
    );
    expect(unrevealedCard?.revealed).toBe(false);
    expect("owner" in (unrevealedCard ?? {})).toBe(false);
  });

  it("allows host permission flags to coexist with any viewRole without adding key", () => {
    const projection = projectRoomForSeat(roomSource(), {
      playerId: "viewer",
      role: "spectator",
      teamId: null,
      isHost: true
    });

    expect(projection.viewRole).toBe("spectator");
    expect("key" in projection).toBe(false);
    expect(projection.permissions.configure).toBe(true);
    expect(projection.permissions.moderate).toBe(true);
    expect(projection.permissions.nominate).toBe(false);
    expect(projection.permissions.confirmReveal).toBe(false);
  });

  it("validates projected payloads against ClientProjectionSchema and rejects invalid keys", () => {
    const source = roomSource();
    const opProjection = projectRoomForSeat(source, {
      playerId: "viewer",
      role: "operative",
      teamId: "red",
      isHost: false
    });

    const parsedOp = ClientProjectionSchema.safeParse(opProjection);
    expect(parsedOp.success).toBe(true);

    // Strict rejection: adding key to operative must fail schema parsing
    const forgedOp = { ...opProjection, key: { "hazard-1": "hazard" } };
    const parsedForged = ClientProjectionSchema.safeParse(forgedOp);
    expect(parsedForged.success).toBe(false);
  });

  it("verifies compile-time type safety for projections", () => {
    const source = roomSource();
    const opProjection = projectRoomForSeat(source, {
      playerId: "viewer",
      role: "operative",
      teamId: "red",
      isHost: false
    });

    const clueProjection = projectRoomForSeat(source, {
      playerId: "red-clue",
      role: "clue-giver",
      teamId: "red",
      isHost: false
    });

    const _invalidOperative: OperativeProjection = {
      ...opProjection,
      // @ts-expect-error OperativeProjection cannot have key
      key: {}
    };

    expect(clueProjection.viewRole).toBe("clue-giver");
    if (clueProjection.viewRole === "clue-giver") {
      const { key, ...clueWithoutKey } = clueProjection;
      expect(key).toBeDefined();
      // @ts-expect-error ClueGiverProjection must have key
      const _invalidClueGiver: ClueGiverProjection = clueWithoutKey;
      expect(_invalidClueGiver).toBeDefined();
    }

    expect(_invalidOperative).toBeDefined();
  });
});
