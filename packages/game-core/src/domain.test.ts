import { describe, expect, it } from "vitest";
import {
  classicBoardSpec,
  configuredTeams,
  TEAM_IDS,
  type Ownership,
  type SeatRole,
  type TextCard,
} from "./index";

describe("shared game domain vocabulary", () => {
  it("defines the canonical team IDs and supported roles and ownership values", () => {
    const roles: SeatRole[] = [
      "unassigned",
      "clue-giver",
      "operative",
      "spectator",
    ];
    const ownership: Ownership[] = [
      "red",
      "blue",
      "green",
      "yellow",
      "neutral",
      "hazard",
    ];

    expect(TEAM_IDS).toEqual(["red", "blue", "green", "yellow"]);
    expect(roles).toHaveLength(4);
    expect(ownership).toHaveLength(6);
  });

  it.each([
    [2, 5, 5, 25, 9, 8, 7],
    [3, 5, 6, 30, 8, 7, 7],
    [4, 6, 6, 36, 8, 7, 6],
  ] as const)(
    "derives the %d-team board specification",
    (
      teamCount,
      rows,
      columns,
      cardCount,
      startingTargets,
      otherTargets,
      neutralCards,
    ) => {
      expect(classicBoardSpec(teamCount)).toMatchObject({
        teamCount,
        rows,
        columns,
        cardCount,
        startingTargets,
        otherTargets,
        neutralCards,
        hazardCards: 1,
      });
    },
  );

  it("derives configured teams without holes", () => {
    expect(configuredTeams(2)).toEqual(["red", "blue"]);
    expect(configuredTeams(3)).toEqual(["red", "blue", "green"]);
    expect(configuredTeams(4)).toEqual(["red", "blue", "green", "yellow"]);
  });

  it("represents a text card with its stable ID and label", () => {
    const card: TextCard = { id: "card-1", label: "COSMIC" };

    expect(card).toEqual({ id: "card-1", label: "COSMIC" });
  });
});
