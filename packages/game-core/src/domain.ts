export const TEAM_IDS = ["red", "blue"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export type PlayerId = string;
export type CardId = string;
export type RoomCode = string;
export type SeatRole = "unassigned" | "clue-giver" | "operative" | "spectator";
export type Ownership = TeamId | "neutral" | "hazard";
export type PlayPhase =
  "clue" | "guess" | "challenged" | "paused" | "board_complete";

export interface TextCard {
  id: CardId;
  label: string;
}
