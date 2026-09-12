import type { TeamId } from "./team-rules";

export {
  TEAM_COUNTS,
  TEAM_IDS,
  chooseStartingTeam,
  classicBoardSpec,
  configuredTeams,
} from "./team-rules";
export type { ClassicBoardSpec, TeamCount, TeamId } from "./team-rules";

export type PlayerId = string;
export type CardId = string;
export type RoomCode = string;
export type SeatRole = "unassigned" | "clue-giver" | "operative" | "spectator";
export type Ownership = TeamId | "neutral" | "hazard";

export interface TextCard {
  id: CardId;
  label: string;
}
