import {
  applyGameActionWithEvent,
  chooseStartingTeam,
  classicBoardSpec,
  configuredTeams,
  createClassicBoard,
  createClassicGame,
  createSeededRandom,
  GameTransitionError,
  shuffled,
  type GameAction,
  type GameTransitionEvent,
  type TeamCount,
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

function copyToNullPrototypeRecord<Value>(
  source: Record<string, Value>,
): Record<string, Value> {
  const record: Record<string, Value> = Object.create(null);
  for (const key of Object.keys(source)) {
    record[key] = source[key]!;
  }
  return record;
}

function outstandingEliminationSpectatorReserve(state: RoomState): number {
  if (
    state.phase === "complete" ||
    (state.game?.eliminatedTeams.length ?? 0) > 0
  ) {
    return 0;
  }
  return Math.max(
    ...state.configuredTeams.map(
      (teamId) =>
        state.seats.filter(
          (seat) => seat.seatClass === "active" && seat.teamId === teamId,
        ).length,
    ),
  );
}

export function respectsSpectatorCapacityReservation(
  state: RoomState,
): boolean {
  const spectatorCount = state.seats.filter(
    (seat) => seat.seatClass === "spectator",
  ).length;
  return (
    spectatorCount + outstandingEliminationSpectatorReserve(state) <=
    MAX_SPECTATORS
  );
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
    case "set_team_count":
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

function canIssueGameplayCommand(
  seat: RoomSeat,
  activeTeam: TeamId | undefined,
  command: ClientCommand,
): boolean {
  switch (command.type) {
    case "submit_clue":
      return (
        seat.role === "clue-giver" &&
        (activeTeam === undefined || seat.teamId === activeTeam)
      );
    case "challenge_clue":
      return (
        seat.role === "clue-giver" &&
        (activeTeam === undefined || seat.teamId !== activeTeam)
      );
    case "nominate_card":
    case "clear_nomination":
    case "confirm_reveal":
    case "end_turn":
      return (
        seat.role === "operative" &&
        (activeTeam === undefined || seat.teamId === activeTeam)
      );
    default:
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
  if (state.game?.eliminatedTeams.includes(seat.teamId) === true) {
    return null;
  }

  const activeTeam = state.game?.activeTeam;
  return canIssueGameplayCommand(seat, activeTeam, command) ? seat : null;
}

function requireLobby(state: RoomState): CommandResult | null {
  return state.phase === "lobby"
    ? null
    : failed(state, "wrong_phase", "Command requires the lobby phase");
}

interface StartValidationFailure {
  code: "invalid_command" | "room_full";
  message: string;
}

function validateStart(state: RoomState): StartValidationFailure | null {
  const active = state.seats.filter((seat) => seat.seatClass === "active");
  const minimumActiveSeats = state.teamCount * 2;
  if (active.filter((seat) => seat.connected).length < minimumActiveSeats) {
    return {
      code: "invalid_command",
      message: `At least ${minimumActiveSeats} active connected seats are required for ${state.teamCount} configured teams`,
    };
  }
  if (
    active.some(
      (seat) =>
        !seat.connected ||
        seat.teamId === null ||
        !state.configuredTeams.includes(seat.teamId) ||
        seat.role === "unassigned" ||
        seat.role === "spectator",
    )
  ) {
    return {
      code: "invalid_command",
      message:
        "Every active seat must be connected and assigned to a configured team and role",
    };
  }

  const seatsByTeam = state.configuredTeams.map((teamId) =>
    active.filter((seat) => seat.teamId === teamId),
  );
  const teamSizes = seatsByTeam.map((teamSeats) => teamSeats.length);
  const largestTeamSize = Math.max(...teamSizes);
  const smallestTeamSize = Math.min(...teamSizes);
  if (largestTeamSize - smallestTeamSize > 1) {
    return {
      code: "invalid_command",
      message: "Team sizes must differ by at most one",
    };
  }
  for (const teamSeats of seatsByTeam) {
    if (
      teamSeats.filter((seat) => seat.role === "clue-giver").length !== 1 ||
      teamSeats.filter((seat) => seat.role === "operative").length < 1
    ) {
      return {
        code: "invalid_command",
        message:
          "Each configured team requires one clue-giver and at least one operative",
      };
    }
  }
  if (!respectsSpectatorCapacityReservation(state)) {
    return {
      code: "room_full",
      message: "Spectator capacity must reserve room for a team elimination",
    };
  }
  return null;
}

function validateCardPool(
  cardPool: readonly TextCard[],
  state: RoomState,
): string | null {
  const cardCount = classicBoardSpec(state.teamCount).cardCount;
  const uniqueCardIds = new Set(cardPool.map((card) => card.id));
  if (uniqueCardIds.size < cardCount) {
    return `Classic board requires at least ${cardCount} unique cards`;
  }
  if (uniqueCardIds.size !== cardPool.length) {
    return "Classic board requires unique card IDs";
  }
  return null;
}

function applyTeamCount(
  state: RoomState,
  teamCount: TeamCount,
): CommandResult | null {
  if (state.locked) {
    return failed(
      state,
      "invalid_command",
      "Team count can change only in an unlocked lobby",
    );
  }
  const nextTeams = configuredTeams(teamCount);
  if (
    state.seats.some(
      (seat) =>
        seat.seatClass === "active" &&
        seat.teamId !== null &&
        !nextTeams.includes(seat.teamId),
    )
  ) {
    return failed(
      state,
      "invalid_command",
      "Move active seats off removed configured teams first",
    );
  }
  state.teamCount = teamCount;
  state.configuredTeams = [...nextTeams];
  state.startingTeam = chooseStartingTeam(
    teamCount,
    `${state.boardSeed}/board-0`,
  );
  return null;
}

function applySeatRole(
  state: RoomState,
  command: Extract<ClientCommand, { type: "set_role" }>,
): CommandResult | null {
  const target = state.seats.find((seat) => seat.playerId === command.playerId);
  if (target === undefined) {
    return failed(state, "invalid_command", "Unknown seat");
  }
  if (command.role === "spectator") {
    if (target.seatClass === "spectator") return null;
    target.seatClass = "spectator";
    target.teamId = null;
    target.role = "spectator";
    if (!respectsSpectatorCapacityReservation(state)) {
      return failed(state, "room_full", "Spectator capacity reached");
    }
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
    case "set_team_count":
      return applyTeamCount(state, command.teamCount);
    case "randomize_teams": {
      const active = state.seats.filter((seat) => seat.seatClass === "active");
      const shuffledIds = shuffled(
        active.map((seat) => seat.playerId),
        createSeededRandom(`${state.boardSeed}/teams/${state.revision}`),
      );
      const teamByPlayer = new Map(
        shuffledIds.map((playerId, index) => [
          playerId,
          state.configuredTeams[index % state.configuredTeams.length]!,
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
      if (
        command.teamId !== null &&
        !state.configuredTeams.includes(command.teamId)
      ) {
        return failed(state, "invalid_command", "Team is not configured");
      }
      target.teamId = command.teamId;
      if (command.teamId === null) {
        target.role = "unassigned";
      }
      return null;
    }
    case "set_role":
      return applySeatRole(state, command);
    case "lock_room":
      state.locked = command.locked;
      return null;
    case "start_board": {
      const startFailure = validateStart(state);
      if (startFailure !== null) {
        return failed(state, startFailure.code, startFailure.message);
      }
      const cardPoolFailure = validateCardPool(cardPool, state);
      if (cardPoolFailure !== null) {
        return failed(state, "invalid_command", cardPoolFailure);
      }
      const board = createClassicBoard({
        cards: cardPool,
        seed: `${state.boardSeed}/board-0`,
        startingTeam: state.startingTeam,
        teamCount: state.teamCount,
      });
      state.initialOwners = Object.fromEntries(
        board.order.map((cardId) => [cardId, board.cards[cardId]!.owner]),
      );
      state.eliminationConversions = Object.create(null);
      state.game = createClassicGame(board);
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
  actorTeam: TeamId | null,
  transitionEvent: GameTransitionEvent | null,
  state: RoomState,
  at: string,
): PublicHistoryEntry | null {
  const base = { revision: state.revision, at };
  switch (command.type) {
    case "submit_clue":
      return {
        ...base,
        type: "clue_submitted",
        teamId: actorTeam!,
        word: command.word,
        count: command.count,
      };
    case "challenge_clue":
      return { ...base, type: "clue_challenged", teamId: actorTeam! };
    case "resolve_challenge":
      return {
        ...base,
        type: "challenge_resolved",
        decision: command.decision,
      };
    case "confirm_reveal": {
      if (
        transitionEvent === null ||
        transitionEvent.type !== "card_revealed"
      ) {
        throw new Error(
          "Accepted reveal did not return an authoritative transition event",
        );
      }
      return {
        ...base,
        type: "card_revealed",
        teamId: actorTeam!,
        cardId: transitionEvent.cardId,
        owner: transitionEvent.owner,
        ...(transitionEvent.eliminatedTeam === undefined
          ? {}
          : { eliminatedTeam: transitionEvent.eliminatedTeam }),
      };
    }
    case "end_turn":
      return { ...base, type: "turn_ended", teamId: actorTeam! };
    case "pause_room":
      return { ...base, type: "room_paused" };
    case "resume_room":
      return { ...base, type: "room_resumed" };
    case "randomize_teams":
    case "set_team_count":
    case "assign_seat":
    case "set_role":
    case "lock_room":
    case "start_board":
    case "nominate_card":
    case "clear_nomination":
      return null;
  }
}

interface GameplayMutation {
  failure: CommandResult | null;
  event: GameTransitionEvent | null;
}

function applyGameplayCommand(
  state: RoomState,
  command: ClientCommand,
  seat: RoomSeat,
): GameplayMutation {
  if (state.phase !== "playing" || state.game === null) {
    return {
      failure: failed(state, "wrong_phase", "Command requires active play"),
      event: null,
    };
  }
  const action = toGameAction(command, seat);
  if (action === null) {
    return {
      failure: failed(state, "wrong_phase", "Command requires the lobby phase"),
      event: null,
    };
  }
  try {
    const previousGame = state.game;
    const transition = applyGameActionWithEvent(previousGame, action);
    let eliminationConversions = state.eliminationConversions;
    let seats = state.seats;
    if (transition.event?.eliminatedTeam !== undefined) {
      const eliminatedTeam = transition.event.eliminatedTeam;
      eliminationConversions = copyToNullPrototypeRecord(
        eliminationConversions,
      );
      for (const cardId of previousGame.board.order) {
        const before = previousGame.board.cards[cardId]!;
        const after = transition.state.board.cards[cardId]!;
        if (
          before.owner === eliminatedTeam &&
          !before.revealed &&
          after.owner === "neutral"
        ) {
          eliminationConversions[cardId] = eliminatedTeam;
        }
      }
      seats = seats.map((candidate) =>
        candidate.seatClass === "active" && candidate.teamId === eliminatedTeam
          ? {
              ...candidate,
              seatClass: "spectator",
              teamId: null,
              role: "spectator",
            }
          : candidate,
      );
    }
    state.game = transition.state;
    state.eliminationConversions = eliminationConversions;
    state.seats = seats;
    if (state.game.phase === "board_complete") {
      state.phase = "complete";
    }
    return { failure: null, event: transition.event };
  } catch (error) {
    if (error instanceof GameTransitionError) {
      return {
        failure: failed(
          state,
          error.reason === "wrong_phase" || error.reason === "board_complete"
            ? "wrong_phase"
            : error.reason === "wrong_team"
              ? "unauthorized"
              : "invalid_command",
          error.message,
        ),
        event: null,
      };
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
    const actorSnapshot: RoomActor = {
      playerId: actor.playerId,
      hostAuthority: actor.hostAuthority,
    };
    const commandTimestamp = now.getTime();
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

    const seat = authorize(this.#state, actorSnapshot, parsed.data.command);
    if (seat === null) {
      return failed(this.#state, "unauthorized", "Actor is not authorized");
    }

    const next = clone(this.#state);
    const nextSeat = next.seats.find(
      (candidate) => candidate.playerId === seat.playerId,
    )!;
    const actorTeam = nextSeat.teamId;
    let transitionEvent: GameTransitionEvent | null = null;
    let mutationFailure: CommandResult | null;
    if (
      isHostCommand(parsed.data.command) &&
      parsed.data.command.type !== "resolve_challenge" &&
      parsed.data.command.type !== "pause_room" &&
      parsed.data.command.type !== "resume_room"
    ) {
      mutationFailure = applyLobbyCommand(
        next,
        parsed.data.command,
        this.#cardPool,
      );
    } else {
      const mutation = applyGameplayCommand(
        next,
        parsed.data.command,
        nextSeat,
      );
      mutationFailure = mutation.failure;
      transitionEvent = mutation.event;
    }
    if (mutationFailure !== null) {
      return { ...mutationFailure, revision: this.#state.revision };
    }

    next.revision = this.#state.revision + 1;
    next.lastActivity = new Date(commandTimestamp).toISOString();
    const entry = historyEntry(
      parsed.data.command,
      actorTeam,
      transitionEvent,
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
      teamCount: this.#state.teamCount,
      configuredTeams: this.#state.configuredTeams,
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
