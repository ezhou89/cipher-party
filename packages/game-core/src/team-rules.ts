import { createSeededRandom } from "./random";

export const TEAM_IDS = ["red", "blue", "green", "yellow"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export const TEAM_COUNTS = [2, 3, 4] as const;
export type TeamCount = (typeof TEAM_COUNTS)[number];

export interface ClassicBoardSpec {
  teamCount: TeamCount;
  rows: 5 | 6;
  columns: 5 | 6;
  cardCount: 25 | 30 | 36;
  startingTargets: 8 | 9;
  otherTargets: 7 | 8;
  neutralCards: 6 | 7;
  hazardCards: 1;
}

const CLASSIC_BOARD_SPECS: Record<TeamCount, ClassicBoardSpec> = {
  2: {
    teamCount: 2,
    rows: 5,
    columns: 5,
    cardCount: 25,
    startingTargets: 9,
    otherTargets: 8,
    neutralCards: 7,
    hazardCards: 1,
  },
  3: {
    teamCount: 3,
    rows: 5,
    columns: 6,
    cardCount: 30,
    startingTargets: 8,
    otherTargets: 7,
    neutralCards: 7,
    hazardCards: 1,
  },
  4: {
    teamCount: 4,
    rows: 6,
    columns: 6,
    cardCount: 36,
    startingTargets: 8,
    otherTargets: 7,
    neutralCards: 6,
    hazardCards: 1,
  },
};

export function configuredTeams(teamCount: TeamCount): TeamId[] {
  return TEAM_IDS.slice(0, teamCount);
}

export function classicBoardSpec(teamCount: TeamCount): ClassicBoardSpec {
  return CLASSIC_BOARD_SPECS[teamCount];
}

export function chooseStartingTeam(teamCount: TeamCount, seed: string): TeamId {
  const teams = configuredTeams(teamCount);
  const index = Math.floor(
    createSeededRandom(`${seed}/starting-team`)() * teams.length,
  );
  return teams[index]!;
}
