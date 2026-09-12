import {
  CommandEnvelopeSchema,
  CommandResultSchema,
  ClientCommandSchema,
} from "@cipher-party/protocol";
import { z } from "zod";
import type { RoomState } from "./room-state";
import { DisplayNameSchema } from "../http/schemas";

export class InvalidRoomSnapshotError extends Error {
  constructor() {
    super("Room snapshot is invalid");
    this.name = "InvalidRoomSnapshotError";
  }
}
export class UnsupportedRoomSnapshotError extends Error {
  constructor() {
    super("Room snapshot version is unsupported");
    this.name = "UnsupportedRoomSnapshotError";
  }
}

const id = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().nonnegative();
const team = z.enum(["red", "blue"]);
const owner = z.enum(["red", "blue", "neutral", "hazard"]);
const timestamp = z.string().refine((value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
});
const clueWord = z.string().refine((word) => {
  const parsed = ClientCommandSchema.safeParse({
    type: "submit_clue",
    word,
    count: 1,
  });
  return (
    parsed.success &&
    parsed.data.type === "submit_clue" &&
    parsed.data.word === word
  );
});
const clue = z
  .object({ word: clueWord, count: z.number().int().min(1).max(9) })
  .strict();
const seat = z
  .object({
    playerId: id,
    displayName: z.string().refine((value) => {
      const parsed = DisplayNameSchema.safeParse(value);
      return parsed.success && parsed.data === value;
    }),
    seatClass: z.enum(["active", "spectator"]),
    teamId: team.nullable(),
    role: z.enum(["unassigned", "clue-giver", "operative", "spectator"]),
    connected: z.boolean(),
    seatTokenHash: hash,
  })
  .strict()
  .refine((value) =>
    value.seatClass === "spectator"
      ? value.role === "spectator" && value.teamId === null
      : value.role !== "spectator" &&
        (value.role === "unassigned" || value.teamId !== null),
  );
const card = z
  .object({ id, label: z.string().min(1), owner, revealed: z.boolean() })
  .strict();
const board = z
  .object({
    order: z.array(id).length(25),
    cards: z.record(id, card),
    startingTeam: team,
  })
  .strict();
const game = z
  .object({
    board,
    phase: z.enum(["clue", "guess", "challenged", "paused", "board_complete"]),
    resumePhase: z.enum(["clue", "guess", "challenged"]).nullable(),
    activeTeam: team,
    clue: clue.nullable(),
    guessesRemaining: z.number().int().min(0).max(10),
    nomination: z.object({ playerId: id, cardId: id }).strict().nullable(),
    winner: team.nullable(),
    completionReason: z.enum(["targets", "hazard"]).nullable(),
  })
  .strict();
const historyBase = { revision, at: timestamp };
const history = z.discriminatedUnion("type", [
  z
    .object({
      ...historyBase,
      type: z.literal("clue_submitted"),
      teamId: team,
      word: clueWord,
      count: z.number().int().min(1).max(9),
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("clue_challenged"),
      teamId: team,
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("challenge_resolved"),
      decision: z.enum(["accept", "reject"]),
    })
    .strict(),
  z
    .object({
      ...historyBase,
      type: z.literal("card_revealed"),
      teamId: team,
      cardId: id,
      owner,
    })
    .strict(),
  z
    .object({ ...historyBase, type: z.literal("turn_ended"), teamId: team })
    .strict(),
  z.object({ ...historyBase, type: z.literal("room_paused") }).strict(),
  z.object({ ...historyBase, type: z.literal("room_resumed") }).strict(),
]);
const snapshot = z
  .object({
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(1),
    code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{6}$/u),
    inviteUrl: z.url().refine((value) => {
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          url.username === "" &&
          url.password === "" &&
          url.search === "" &&
          url.hash === ""
        );
      } catch {
        return false;
      }
    }),
    revision,
    phase: z.enum(["lobby", "playing", "complete"]),
    locked: z.boolean(),
    createdAt: timestamp,
    lastActivity: timestamp,
    boardSeed: id,
    startingTeam: team,
    hostPlayerId: id,
    hostTokenHash: hash,
    seats: z.array(seat).min(1).max(32),
    game: game.nullable(),
    publicHistory: z.array(history).max(100),
    // Older valid snapshots may exceed today's issuance cap; never evict tickets here.
    connectionTickets: z.array(
      z
        .object({
          ticketHash: hash,
          playerId: id,
          hostAuthority: z.boolean(),
          expiresAt: z.number().finite(),
        })
        .strict(),
    ),
    processedCommands: z
      .array(
        z
          .object({
            commandId: CommandEnvelopeSchema.shape.commandId,
            payloadDigest: hash,
            result: CommandResultSchema,
          })
          .strict(),
      )
      .max(256),
  })
  .strict();

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validReferences(state: RoomState): boolean {
  const ids = new Set(state.seats.map((value) => value.playerId));
  if (!ids.has(state.hostPlayerId) || ids.size !== state.seats.length)
    return false;
  if (!unique(state.seats.map((value) => value.seatTokenHash))) return false;
  for (const kind of ["active", "spectator"]) {
    if (state.seats.filter((value) => value.seatClass === kind).length > 16)
      return false;
  }
  if (!unique(state.connectionTickets.map((value) => value.ticketHash)))
    return false;
  if (
    state.connectionTickets.some(
      (value) =>
        !ids.has(value.playerId) ||
        (value.hostAuthority && value.playerId !== state.hostPlayerId),
    )
  )
    return false;
  if (!unique(state.processedCommands.map((value) => value.commandId)))
    return false;
  if (
    state.processedCommands.some(
      (value) => value.result.revision > state.revision,
    )
  )
    return false;
  return state.publicHistory.every((entry, index) => {
    if (
      entry.revision > state.revision ||
      entry.revision <= (state.publicHistory[index - 1]?.revision ?? -1)
    )
      return false;
    if (entry.type !== "card_revealed") return true;
    const value = state.game?.board.cards[entry.cardId];
    return value !== undefined && value.revealed && value.owner === entry.owner;
  });
}

function validBoard(state: NonNullable<RoomState["game"]>): boolean {
  const { board } = state;
  if (!unique(board.order) || Object.keys(board.cards).length !== 25)
    return false;
  if (
    !board.order.every(
      (key) => Object.hasOwn(board.cards, key) && board.cards[key]!.id === key,
    )
  )
    return false;
  const counts = { red: 0, blue: 0, neutral: 0, hazard: 0 };
  for (const value of Object.values(board.cards)) counts[value.owner]++;
  return (
    counts[board.startingTeam] === 9 &&
    counts[board.startingTeam === "red" ? "blue" : "red"] === 8 &&
    counts.neutral === 7 &&
    counts.hazard === 1
  );
}

function validGameOutcome(value: NonNullable<RoomState["game"]>): boolean {
  const complete = value.phase === "board_complete";
  if (complete !== (value.winner !== null && value.completionReason !== null))
    return false;
  if (!complete && (value.winner !== null || value.completionReason !== null))
    return false;
  const cards = Object.values(value.board.cards);
  const revealedHazard = cards.some(
    (card) => card.owner === "hazard" && card.revealed,
  );
  if (value.completionReason === "hazard")
    return revealedHazard && value.winner !== value.activeTeam;
  if (revealedHazard) return false;
  const allTargets = (teamId: "red" | "blue") =>
    cards
      .filter((card) => card.owner === teamId)
      .every((card) => card.revealed);
  if (value.completionReason === "targets")
    return value.winner !== null && allTargets(value.winner);
  return !allTargets("red") && !allTargets("blue");
}

function validGamePhase(value: NonNullable<RoomState["game"]>): boolean {
  const phase = value.phase === "paused" ? value.resumePhase : value.phase;
  if ((value.phase === "paused") !== (value.resumePhase !== null)) return false;
  if (!validGameOutcome(value)) return false;
  if (phase === "clue")
    return (
      value.clue === null &&
      value.guessesRemaining === 0 &&
      value.nomination === null
    );
  if (value.clue === null || value.guessesRemaining > value.clue.count + 1)
    return false;
  if (value.phase === "board_complete") return value.nomination === null;
  return value.guessesRemaining > 0;
}

function validRoomGame(state: RoomState): boolean {
  const value = state.game;
  if (value === null)
    return state.phase === "lobby" && state.publicHistory.length === 0;
  if (
    state.phase === "lobby" ||
    (state.phase === "complete") !== (value.phase === "board_complete")
  )
    return false;
  if (
    state.startingTeam !== value.board.startingTeam ||
    !validBoard(value) ||
    !validGamePhase(value)
  )
    return false;
  const active = state.seats.filter((seat) => seat.seatClass === "active");
  if (active.some((seat) => seat.teamId === null || seat.role === "unassigned"))
    return false;
  for (const teamId of ["red", "blue"]) {
    if (
      active.filter(
        (seat) => seat.teamId === teamId && seat.role === "clue-giver",
      ).length !== 1
    )
      return false;
    if (
      !active.some(
        (seat) => seat.teamId === teamId && seat.role === "operative",
      )
    )
      return false;
  }
  if (value.nomination === null) return true;
  const nominator = state.seats.find(
    (seat) => seat.playerId === value.nomination!.playerId,
  );
  const nominated = value.board.cards[value.nomination.cardId];
  return (
    nominator?.role === "operative" &&
    nominator.teamId === value.activeTeam &&
    nominated !== undefined &&
    !nominated.revealed
  );
}

export function parseRoomSnapshot(input: unknown): RoomState {
  if (input !== null && typeof input === "object") {
    const versions = input as {
      schemaVersion?: unknown;
      protocolVersion?: unknown;
    };
    if (
      (typeof versions.schemaVersion === "number" &&
        versions.schemaVersion !== 1) ||
      (typeof versions.protocolVersion === "number" &&
        versions.protocolVersion !== 1)
    )
      throw new UnsupportedRoomSnapshotError();
  }
  const parsed = snapshot.safeParse(input);
  if (
    !parsed.success ||
    !validReferences(parsed.data) ||
    !validRoomGame(parsed.data)
  )
    throw new InvalidRoomSnapshotError();
  if (parsed.data.game !== null) {
    parsed.data.game.board.cards = Object.assign(
      Object.create(null),
      parsed.data.game.board.cards,
    );
  }
  return parsed.data;
}
