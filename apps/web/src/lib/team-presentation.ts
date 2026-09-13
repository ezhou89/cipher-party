import type { ClientProjection, PublicCard } from "@cipher-party/protocol";

export type TeamId = ClientProjection["configuredTeams"][number];
export type PublicOwner = Extract<PublicCard, { revealed: true }>["owner"];

export const TEAM_PRESENTATION = {
  red: {
    label: "Red",
    symbol: "◆",
    callsign: "Ruby",
    pattern: "diamond",
  },
  blue: {
    label: "Blue",
    symbol: "●",
    callsign: "Cobalt",
    pattern: "circle",
  },
  green: {
    label: "Green",
    symbol: "▲",
    callsign: "Verdant",
    pattern: "triangle",
  },
  yellow: {
    label: "Yellow",
    symbol: "■",
    callsign: "Amber",
    pattern: "square",
  },
} as const satisfies Record<
  TeamId,
  {
    label: string;
    symbol: string;
    callsign: string;
    pattern: string;
  }
>;

export const OWNER_PRESENTATION = {
  ...TEAM_PRESENTATION,
  neutral: { label: "Neutral", symbol: "◇", pattern: "lines" },
  hazard: { label: "Hazard", symbol: "✦", pattern: "hazard" },
} as const satisfies Record<
  PublicOwner,
  { label: string; symbol: string; pattern: string }
>;
