import {
  applyGameAction,
  createClassicBoard,
  createClassicGame,
  createSeededRandom,
  GameTransitionError,
  shuffled,
  type GameAction,
  type TeamId,
  type TextCard,
} from "@cipher-party/game-core";
import {
  CommandEnvelopeSchema,
  projectRoomForSeat,
  type ClientCommand,
  type ClientProjection,
  type CommandEnvelope,
  type CommandErrorCode,
  type CommandResult,
  type PublicHistoryEntry,
  type RoomProjectionSource,
  type ViewerContext,
} from "@cipher-party/protocol";

import { neutralWords } from "../fixtures/neutral-words";
import type { RoomActor, RoomSeat, RoomState } from "./room-state";

const MAX_ACTIVE_SEATS = 16;
const MAX_SPECTATORS = 16;
const MAX_PROCESSED_COMMANDS = 256;
const MAX_PUBLIC_HISTORY = 100;

type RoomSessionOptions = { cardPool?: readonly TextCard[] };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function failed(
  state: RoomState,
  code: CommandErrorCode,
  message: string,
): CommandResult {
  return { ok: false, revision: state.revision, code, message };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function payloadDigest(command: ClientCommand): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalJson(command));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isHostCommand(command: ClientCommand): boolean {
  switch (command.type) {
    case "randomize_teams":
    case "assign_seat":
    case "set_role":
    case "lock_room":
    case "start_board":
    case "resolve_challenge":
    case "pause_room":
    case "resume_room":
      return true;
    case "submit_clue":
    case "challenge_clue":
    case "nominate_card":
    case "clear_nomination":
    case "confirm_reveal":
    case "end_turn":
      return false;
  }
}

function authorize(
  state: RoomState,
  actor: RoomActor,
  command: ClientCommand,
): RoomSeat | null {
  const seat = state.seats.find(
    (candidate) => candidate.playerId === actor.playerId,
  );
  if (seat === undefined || !seat.connected) {
    return null;
  }
  if (isHostCommand(command)) {
    return actor.hostAuthority && actor.playerId === state.hostPlayerId
      ? seat
      : null;
  }
  if (seat.seatClass !== "active" || seat.teamId === null) {
    return null;
  }

  const activeTeam = state.game?.activeTeam;
  switch (command.type) {
    case "submit_clue":
      return seat.role === "clue-giver" &&
        (activeTeam === undefined || seat.teamId === activeTeam)
        ? seat
        : null;
    case "challenge_clue":
      return seat.role === "clue-giver" &&
        (activeTeam === undefined || seat.teamId !== activeTeam)
        ? seat
        : null;
    case "nominate_card":
    case "clear_nomination":
    case "confirm_reveal":
    case "end_turn":
      return seat.role === "operative" &&
        (activeTeam === undefined || seat.teamId === activeTeam)
        ? seat
        : null;
    default:
      return null;
  }
}

function requireLobby(state: RoomState): CommandResult | null {
  return state.phase === "lobby"
    ? null
    : failed(state, "wrong_phase", "Command requires the lobby phase");
}

function validateStart(state: RoomState): string | null {
  const active = state.seats.filter((seat) => seat.seatClass === "active");
  if (
    active.some(
      (seat) =>
        !seat.connected ||
        seat.teamId === null ||
        seat.role === "unassigned" ||
        seat.role === "spectator",
    )
  ) {
    return "Every active seat must be connected and fully assigned";
  }

  const red = active.filter((seat) => seat.teamId === "red");
  const blue = active.filter((seat) => seat.teamId === "blue");
  if (Math.abs(red.length - blue.length) > 1) {
    return "Team sizes must differ by at most one";
  }
  for (const teamSeats of [red, blue]) {
    if (
      teamSeats.filter((seat) => seat.role === "clue-giver").length !== 1 ||
      teamSeats.filter((seat) => seat.role === "operative").length < 1
    ) {
      return "Each team requires one clue-giver and at least one operative";
    }
  }
  return null;
}

function applyLobbyCommand(
  state: RoomState,
  command: ClientCommand,
  cardPool: readonly TextCard[],
): CommandResult | null {
  const phaseFailure = requireLobby(state);
  if (phaseFailure !== null) {
    return phaseFailure;
  }

  switch (command.type) {
    case "randomize_teams": {
      const active = state.seats.filter((seat) => seat.seatClass === "active");
      const shuffledIds = shuffled(
        active.map((seat) => seat.playerId),
        createSeededRandom(`${state.boardSeed}/teams/${state.revision}`),
      );
      const teamByPlayer = new Map(
        shuffledIds.map((playerId, index) => [
          playerId,
          index % 2 === 0 ? ("red" as const) : ("blue" as const),
        ]),
      );
      state.seats = state.seats.map((seat) =>
        seat.seatClass === "active"
          ? {
              ...seat,
              teamId: teamByPlayer.get(seat.playerId)!,
              role: "unassigned",
            }
          : seat,
      );
      return null;
    }
    case "assign_seat": {
      const target = state.seats.find(
        (seat) => seat.playerId === command.playerId,
      );
      if (target === undefined || target.seatClass !== "active") {
        return failed(state, "invalid_command", "Unknown active seat");
      }
      target.teamId = command.teamId;
      if (command.teamId === null) {
        target.role = "unassigned";
      }
      return null;
    }
    case "set_role": {
      const target = state.seats.find(
        (seat) => seat.playerId === command.playerId,
      );
      if (target === undefined) {
        return failed(state, "invalid_command", "Unknown seat");
      }
      if (command.role === "spectator") {
        if (
          target.seatClass !== "spectator" &&
          state.seats.filter((seat) => seat.seatClass === "spectator").length >=
            MAX_SPECTATORS
        ) {
          return failed(state, "room_full", "Spectator capacity reached");
        }
        target.seatClass = "spectator";
        target.teamId = null;
        target.role = "spectator";
        return null;
      }
      if (
        target.seatClass === "spectator" &&
        state.seats.filter((seat) => seat.seatClass === "active").length >=
          MAX_ACTIVE_SEATS
      ) {
        return failed(state, "room_full", "Active-seat capacity reached");
      }
      if (
        (command.role === "clue-giver" || command.role === "operative") &&
        target.teamId === null
      ) {
        return failed(state, "invalid_command", "Active role requires a team");
      }
      target.seatClass = "active";
      target.role = command.role;
      return null;
    }
    case "lock_room":
      state.locked = command.locked;
      return null;
    case "start_board": {
      const startFailure = validateStart(state);
      if (startFailure !== null) {
        return failed(state, "invalid_command", startFailure);
      }
      try {
        state.game = createClassicGame(
          createClassicBoard({
            cards: cardPool,
            seed: `${state.boardSeed}/board-0`,
            startingTeam: state.startingTeam,
          }),
        );
      } catch (error) {
        return failed(
          state,
          "invalid_command",
          error instanceof Error ? error.message : "Invalid card pool",
        );
      }
      state.phase = "playing";
      return null;
    }
    default:
      return failed(state, "wrong_phase", "Command requires active play");
  }
}

function toGameAction(
  command: ClientCommand,
  seat: RoomSeat,
): GameAction | null {
  const teamId = seat.teamId as TeamId;
  switch (command.type) {
    case "submit_clue":
      return {
        type: "submit_clue",
        teamId,
        word: command.word,
        count: command.count,
      };
    case "challenge_clue":
      return { type: "challenge_clue", teamId };
    case "resolve_challenge":
      return { type: "resolve_challenge", decision: command.decision };
    case "nominate_card":
      return {
        type: "nominate_card",
        teamId,
        playerId: seat.playerId,
        cardId: command.cardId,
      };
    case "clear_nomination":
      return { type: "clear_nomination", teamId, playerId: seat.playerId };
    case "confirm_reveal":
      return {
        type: "confirm_reveal",
        teamId,
        playerId: seat.playerId,
        cardId: command.cardId,
      };
    case "end_turn":
      return { type: "end_turn", teamId };
    case "pause_room":
      return { type: "pause" };
    case "resume_room":
      return { type: "resume" };
    default:
      return null;
  }
}

function historyEntry(
  command: ClientCommand,
  seat: RoomSeat,
  state: RoomState,
  at: string,
): PublicHistoryEntry | null {
  const base = { revision: state.revision, at };
  switch (command.type) {
    case "submit_clue":
      return {
        ...base,
        type: "clue_submitted",
        teamId: seat.teamId!,
        word: command.word,
        count: command.count,
      };
    case "challenge_clue":
      return { ...base, type: "clue_challenged", teamId: seat.teamId! };
    case "resolve_challenge":
      return {
        ...base,
        type: "challenge_resolved",
        decision: command.decision,
      };
    case "confirm_reveal": {
      const revealed = state.game?.board.cards[command.cardId];
      if (revealed === undefined || !revealed.revealed) {
        throw new Error(
          "Accepted reveal did not reveal its authoritative card",
        );
      }
      return {
        ...base,
        type: "card_revealed",
        teamId: seat.teamId!,
        cardId: command.cardId,
        owner: revealed.owner,
      };
    }
    case "end_turn":
      return { ...base, type: "turn_ended", teamId: seat.teamId! };
    case "pause_room":
      return { ...base, type: "room_paused" };
    case "resume_room":
      return { ...base, type: "room_resumed" };
    case "randomize_teams":
    case "assign_seat":
    case "set_role":
    case "lock_room":
    case "start_board":
    case "nominate_card":
    case "clear_nomination":
      return null;
  }
}

function applyGameplayCommand(
  state: RoomState,
  command: ClientCommand,
  seat: RoomSeat,
): CommandResult | null {
  if (state.phase !== "playing" || state.game === null) {
    return failed(state, "wrong_phase", "Command requires active play");
  }
  const action = toGameAction(command, seat);
  if (action === null) {
    return failed(state, "wrong_phase", "Command requires the lobby phase");
  }
  try {
    state.game = applyGameAction(state.game, action);
    if (state.game.phase === "board_complete") {
      state.phase = "complete";
    }
    return null;
  } catch (error) {
    if (error instanceof GameTransitionError) {
      return failed(
        state,
        error.reason === "wrong_phase" || error.reason === "board_complete"
          ? "wrong_phase"
          : error.reason === "wrong_team"
            ? "unauthorized"
            : "invalid_command",
        error.message,
      );
    }
    throw error;
  }
}

export class RoomSession {
  readonly #cardPool: readonly TextCard[];
  #state: RoomState;

  private constructor(state: RoomState, options: RoomSessionOptions) {
    this.#state = clone(state);
    this.#cardPool = clone(options.cardPool ?? neutralWords);
  }

  static from(state: RoomState, options: RoomSessionOptions = {}): RoomSession {
    return new RoomSession(state, options);
  }

  async dispatch(
    actor: RoomActor,
    envelope: CommandEnvelope,
    now: Date,
  ): Promise<CommandResult> {
    const parsed = CommandEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      return failed(this.#state, "invalid_command", "Invalid command envelope");
    }

    const commandDigest = await payloadDigest(parsed.data.command);
    const processed = this.#state.processedCommands.find(
      (entry) => entry.commandId === parsed.data.commandId,
    );
    if (processed !== undefined) {
      return processed.payloadDigest === commandDigest
        ? clone(processed.result)
        : failed(
            this.#state,
            "invalid_command",
            "Command ID was reused with a different payload",
          );
    }
    if (parsed.data.expectedRevision !== this.#state.revision) {
      return failed(
        this.#state,
        "stale_revision",
        "Expected revision is stale",
      );
    }

    const seat = authorize(this.#state, actor, parsed.data.command);
    if (seat === null) {
      return failed(this.#state, "unauthorized", "Actor is not authorized");
    }

    const next = clone(this.#state);
    const nextSeat = next.seats.find(
      (candidate) => candidate.playerId === seat.playerId,
    )!;
    const mutationFailure =
      isHostCommand(parsed.data.command) &&
      parsed.data.command.type !== "resolve_challenge" &&
      parsed.data.command.type !== "pause_room" &&
      parsed.data.command.type !== "resume_room"
        ? applyLobbyCommand(next, parsed.data.command, this.#cardPool)
        : applyGameplayCommand(next, parsed.data.command, nextSeat);
    if (mutationFailure !== null) {
      return { ...mutationFailure, revision: this.#state.revision };
    }

    next.revision = this.#state.revision + 1;
    next.lastActivity = now.toISOString();
    const entry = historyEntry(
      parsed.data.command,
      nextSeat,
      next,
      next.lastActivity,
    );
    if (entry !== null) {
      next.publicHistory = [...next.publicHistory, entry].slice(
        -MAX_PUBLIC_HISTORY,
      );
    }
    const result: CommandResult = { ok: true, revision: next.revision };
    next.processedCommands = [
      ...next.processedCommands,
      {
        commandId: parsed.data.commandId,
        payloadDigest: commandDigest,
        result: clone(result),
      },
    ].slice(-MAX_PROCESSED_COMMANDS);
    this.#state = next;
    return clone(result);
  }

  project(viewer: ViewerContext): ClientProjection {
    const source: RoomProjectionSource = {
      protocolVersion: this.#state.protocolVersion,
      code: this.#state.code,
      inviteUrl: this.#state.inviteUrl,
      revision: this.#state.revision,
      roomPhase: this.#state.phase,
      locked: this.#state.locked,
      seats: this.#state.seats.map((seat) => ({
        playerId: seat.playerId,
        displayName: seat.displayName,
        teamId: seat.teamId,
        role: seat.role,
        connected: seat.connected,
      })),
      publicHistory: this.#state.publicHistory,
      game: this.#state.game,
    };
    return projectRoomForSeat(source, viewer);
  }

  snapshot(): RoomState {
    return clone(this.#state);
  }
}
