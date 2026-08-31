import { describe, expect, it } from "vitest";
import {
  TEAM_IDS,
  type Ownership,
  type SeatRole,
  type TextCard,
} from "./index";

describe("shared game domain vocabulary", () => {
  it("defines the two team IDs and supported roles and ownership values", () => {
    const roles: SeatRole[] = [
      "unassigned",
      "clue-giver",
      "operative",
      "spectator",
    ];
    const ownership: Ownership[] = ["red", "blue", "neutral", "hazard"];

    expect(TEAM_IDS).toEqual(["red", "blue"]);
    expect(roles).toHaveLength(4);
    expect(ownership).toHaveLength(4);
  });

  it("represents a text card with its stable ID and label", () => {
    const card: TextCard = { id: "card-1", label: "COSMIC" };

    expect(card).toEqual({ id: "card-1", label: "COSMIC" });
  });
});
