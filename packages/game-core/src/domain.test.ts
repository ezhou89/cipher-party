import { describe, expect, it } from "vitest";
import { TEAM_IDS, type Ownership, type SeatRole, type TeamId } from "./index";

describe("domain vocabulary", () => {
  it("defines red and blue teams", () => {
    expect(TEAM_IDS).toEqual(["red", "blue"]);
  });

  it("types compile as expected", () => {
    const team: TeamId = "red";
    const ownership: Ownership = "hazard";
    const role: SeatRole = "clue-giver";
    expect(team).toBe("red");
    expect(ownership).toBe("hazard");
    expect(role).toBe("clue-giver");
  });
});
