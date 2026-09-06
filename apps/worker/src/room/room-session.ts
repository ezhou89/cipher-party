import {
  applyGameAction,
  createClassicBoard,
  createClassicGame,
  createSeededRandom,
  GameTransitionError,
  otherTeam,
  shuffled,
  type GameAction
} from "@cipher-party/game-core";
import {
  CommandEnvelopeSchema,
  projectRoomForSeat,
  type ClientProjection,
  type CommandEnvelope,
  type CommandResult,
  type PublicHistoryEntry,
  type RoomProjectionSource,
  type ViewerContext
} from "@cipher-party/protocol";
import { neutralWords } from "../fixtures/neutral-words";
import type { RoomActor, RoomState } from "./room-state";

function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalStringify).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((obj as Record<string, unknown>)[k])}`).join(",")}}`;
}

async function digestPayload(payload: unknown): Promise<string> {
  const json = canonicalStringify(payload);
  const data = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class RoomSession {
  private state: RoomState;

  private constructor(state: RoomState) {
    this.state = state;
  }

  static from(state: RoomState): RoomSession {
    return new RoomSession(structuredClone(state));
  }

  snapshot(): RoomState {
    return structuredClone(this.state);
  }

  project(viewer: ViewerContext): ClientProjection {
    const source: RoomProjectionSource = {
      protocolVersion: this.state.protocolVersion,
      code: this.state.code,
      inviteUrl: this.state.inviteUrl,
      revision: this.state.revision,
      roomPhase: this.state.phase,
      locked: this.state.locked,
      seats: this.state.seats.map((s) => ({
        playerId: s.playerId,
        displayName: s.displayName,
        teamId: s.teamId,
        role: s.role,
        connected: s.connected
      })),
      publicHistory: this.state.publicHistory,
      game: this.state.game
    };
    return projectRoomForSeat(source, viewer);
  }

  async dispatch(
    actor: RoomActor,
    envelope: CommandEnvelope,
    now: Date
  ): Promise<CommandResult> {
    // 1. Validate envelope
    const parsedEnvelope = CommandEnvelopeSchema.safeParse(envelope);
    if (!parsedEnvelope.success) {
      return {
        ok: false,
        revision: this.state.revision,
        code: "invalid_command",
        message: "Invalid command envelope"
      };
    }

    // 2. Check processedCommands by commandId & payloadDigest
    const payloadDigest = await digestPayload(envelope.command);
    const existing = this.state.processedCommands.find(
      (entry) => entry.commandId === envelope.commandId
    );
    if (existing) {
      if (existing.payloadDigest !== payloadDigest) {
        return {
          ok: false,
          revision: this.state.revision,
          code: "invalid_command",
          message: "Command ID reused with different payload"
        };
      }
      return existing.result;
    }

    // 3. Check expectedRevision
    if (envelope.expectedRevision !== this.state.revision) {
      return {
        ok: false,
        revision: this.state.revision,
        code: "stale_revision",
        message: `Expected revision ${envelope.expectedRevision} does not match current revision ${this.state.revision}`
      };
    }

    // 4. Resolve actor to current seat and authorize
    const actorSeat = this.state.seats.find(
      (s) => s.playerId === actor.playerId
    );
    if (!actorSeat) {
      return {
        ok: false,
        revision: this.state.revision,
        code: "unauthorized",
        message: `Player ${actor.playerId} is not in this room`
      };
    }

    const isHost =
      actor.hostAuthority && actor.playerId === this.state.hostPlayerId;
    const command = envelope.command;

    // Check host-only commands
    const hostCommands = [
      "randomize_teams",
      "assign_seat",
      "set_role",
      "lock_room",
      "start_board",
      "resolve_challenge",
      "pause_room",
      "resume_room"
    ];
    if (hostCommands.includes(command.type) && !isHost) {
      return {
        ok: false,
        revision: this.state.revision,
        code: "unauthorized",
        message: "Host authority required for this command"
      };
    }

    // Check phase requirements
    if (this.state.phase === "complete") {
      return {
        ok: false,
        revision: this.state.revision,
        code: "wrong_phase",
        message: "Cannot apply commands to a completed game"
      };
    }

    const lobbyOnlyCommands = [
      "randomize_teams",
      "assign_seat",
      "set_role",
      "start_board"
    ];
    if (
      this.state.phase === "playing" &&
      lobbyOnlyCommands.includes(command.type)
    ) {
      return {
        ok: false,
        revision: this.state.revision,
        code: "wrong_phase",
        message: `Cannot execute ${command.type} after play has started`
      };
    }

    const gameplayCommands = [
      "submit_clue",
      "challenge_clue",
      "resolve_challenge",
      "nominate_card",
      "clear_nomination",
      "confirm_reveal",
      "end_turn",
      "pause_room",
      "resume_room"
    ];
    if (
      this.state.phase === "lobby" &&
      gameplayCommands.includes(command.type)
    ) {
      return {
        ok: false,
        revision: this.state.revision,
        code: "wrong_phase",
        message: `Cannot execute ${command.type} during lobby phase`
      };
    }

    // Role-based authorization for gameplay commands
    if (this.state.phase === "playing" && this.state.game) {
      const game = this.state.game;
      if (command.type === "submit_clue") {
        if (
          !actorSeat.connected ||
          actorSeat.role !== "clue-giver" ||
          actorSeat.teamId !== game.activeTeam
        ) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "unauthorized",
            message: "Only connected active clue-giver can submit clue"
          };
        }
      } else if (command.type === "challenge_clue") {
        if (
          !actorSeat.connected ||
          actorSeat.role !== "clue-giver" ||
          actorSeat.teamId !== otherTeam(game.activeTeam)
        ) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "unauthorized",
            message: "Only opposing clue-giver can challenge clue"
          };
        }
      } else if (
        command.type === "nominate_card" ||
        command.type === "clear_nomination" ||
        command.type === "confirm_reveal" ||
        command.type === "end_turn"
      ) {
        if (
          !actorSeat.connected ||
          actorSeat.role !== "operative" ||
          actorSeat.teamId !== game.activeTeam
        ) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "unauthorized",
            message: "Only connected active operative can perform this action"
          };
        }
      }
    }

    // Clone state before applying mutations
    const nextState: RoomState = structuredClone(this.state);
    const nowIso = now.toISOString();
    const nextRevision = this.state.revision + 1;

    let newHistoryEntry: PublicHistoryEntry | null = null;

    // Execute command branch
    switch (command.type) {
      case "lock_room": {
        nextState.locked = command.locked;
        break;
      }

      case "assign_seat": {
        const targetSeat = nextState.seats.find(
          (s) => s.playerId === command.playerId
        );
        if (!targetSeat) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "invalid_command",
            message: `Seat ${command.playerId} not found`
          };
        }
        if (command.teamId === null) {
          targetSeat.teamId = null;
          targetSeat.role = "unassigned";
        } else {
          targetSeat.teamId = command.teamId;
        }
        break;
      }

      case "set_role": {
        const targetSeat = nextState.seats.find(
          (s) => s.playerId === command.playerId
        );
        if (!targetSeat) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "invalid_command",
            message: `Seat ${command.playerId} not found`
          };
        }
        if (command.role === "spectator") {
          targetSeat.seatClass = "spectator";
          targetSeat.teamId = null;
          targetSeat.role = "spectator";
        } else if (
          command.role === "clue-giver" ||
          command.role === "operative"
        ) {
          if (targetSeat.teamId === null) {
            return {
              ok: false,
              revision: this.state.revision,
              code: "invalid_command",
              message: "Cannot assign active role without a team"
            };
          }
          targetSeat.seatClass = "active";
          targetSeat.role = command.role;
        } else if (command.role === "unassigned") {
          targetSeat.seatClass = "active";
          targetSeat.role = "unassigned";
        }
        break;
      }

      case "randomize_teams": {
        const activeSeats = nextState.seats.filter(
          (s) => s.seatClass === "active"
        );
        const playerIds = activeSeats.map((s) => s.playerId);
        const random = createSeededRandom(
          `${nextState.boardSeed}/teams/${nextState.revision}`
        );
        const shuffledIds = shuffled(playerIds, random);

        shuffledIds.forEach((playerId, index) => {
          const seat = nextState.seats.find((s) => s.playerId === playerId);
          if (seat) {
            seat.teamId = index % 2 === 0 ? "red" : "blue";
            seat.role = "unassigned";
          }
        });
        break;
      }

      case "start_board": {
        if (neutralWords.length < 25) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "invalid_command",
            message: "Fewer than 25 fixture words available"
          };
        }

        const activeSeats = nextState.seats.filter(
          (s) => s.seatClass === "active"
        );
        const disconnectedActive = activeSeats.some((s) => !s.connected);
        if (disconnectedActive) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "invalid_command",
            message: "Cannot start with disconnected active seats"
          };
        }

        const unassignedActive = activeSeats.some(
          (s) => s.role === "unassigned" || s.teamId === null
        );
        if (unassignedActive) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "invalid_command",
            message: "Cannot start with unassigned active seats"
          };
        }

        const redSeats = activeSeats.filter((s) => s.teamId === "red");
        const blueSeats = activeSeats.filter((s) => s.teamId === "blue");

        const redClue = redSeats.filter((s) => s.role === "clue-giver");
        const blueClue = blueSeats.filter((s) => s.role === "clue-giver");
        const redOp = redSeats.filter((s) => s.role === "operative");
        const blueOp = blueSeats.filter((s) => s.role === "operative");

        if (redClue.length !== 1 || blueClue.length !== 1) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "invalid_command",
            message: "Each team must have exactly one clue-giver"
          };
        }

        if (redOp.length < 1 || blueOp.length < 1) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "invalid_command",
            message: "Each team must have at least one operative"
          };
        }

        if (Math.abs(redSeats.length - blueSeats.length) > 1) {
          return {
            ok: false,
            revision: this.state.revision,
            code: "invalid_command",
            message: "Teams are uneven by more than one"
          };
        }

        const board = createClassicBoard({
          cards: neutralWords,
          seed: nextState.boardSeed,
          startingTeam: nextState.startingTeam
        });
        nextState.game = createClassicGame(board);
        nextState.phase = "playing";
        break;
      }

      // Gameplay commands
      case "submit_clue": {
        const action: GameAction = {
          type: "submit_clue",
          teamId: actorSeat.teamId!,
          word: command.word,
          count: command.count
        };
        try {
          nextState.game = applyGameAction(nextState.game!, action);
        } catch (err) {
          if (err instanceof GameTransitionError) {
            return {
              ok: false,
              revision: this.state.revision,
              code:
                err.reason === "wrong_phase"
                  ? "wrong_phase"
                  : "invalid_command",
              message: err.message
            };
          }
          throw err;
        }
        newHistoryEntry = {
          revision: nextRevision,
          at: nowIso,
          type: "clue_submitted",
          teamId: actorSeat.teamId!,
          word: command.word,
          count: command.count
        };
        break;
      }

      case "challenge_clue": {
        const action: GameAction = {
          type: "challenge_clue",
          teamId: actorSeat.teamId!
        };
        try {
          nextState.game = applyGameAction(nextState.game!, action);
        } catch (err) {
          if (err instanceof GameTransitionError) {
            return {
              ok: false,
              revision: this.state.revision,
              code:
                err.reason === "wrong_phase"
                  ? "wrong_phase"
                  : "invalid_command",
              message: err.message
            };
          }
          throw err;
        }
        newHistoryEntry = {
          revision: nextRevision,
          at: nowIso,
          type: "clue_challenged",
          teamId: actorSeat.teamId!
        };
        break;
      }

      case "resolve_challenge": {
        const action: GameAction = {
          type: "resolve_challenge",
          decision: command.decision
        };
        try {
          nextState.game = applyGameAction(nextState.game!, action);
        } catch (err) {
          if (err instanceof GameTransitionError) {
            return {
              ok: false,
              revision: this.state.revision,
              code:
                err.reason === "wrong_phase"
                  ? "wrong_phase"
                  : "invalid_command",
              message: err.message
            };
          }
          throw err;
        }
        newHistoryEntry = {
          revision: nextRevision,
          at: nowIso,
          type: "challenge_resolved",
          decision: command.decision
        };
        break;
      }

      case "nominate_card": {
        const action: GameAction = {
          type: "nominate_card",
          teamId: actorSeat.teamId!,
          playerId: actor.playerId,
          cardId: command.cardId
        };
        try {
          nextState.game = applyGameAction(nextState.game!, action);
        } catch (err) {
          if (err instanceof GameTransitionError) {
            return {
              ok: false,
              revision: this.state.revision,
              code:
                err.reason === "wrong_phase"
                  ? "wrong_phase"
                  : "invalid_command",
              message: err.message
            };
          }
          throw err;
        }
        break;
      }

      case "clear_nomination": {
        const action: GameAction = {
          type: "clear_nomination",
          teamId: actorSeat.teamId!,
          playerId: actor.playerId
        };
        try {
          nextState.game = applyGameAction(nextState.game!, action);
        } catch (err) {
          if (err instanceof GameTransitionError) {
            return {
              ok: false,
              revision: this.state.revision,
              code:
                err.reason === "wrong_phase"
                  ? "wrong_phase"
                  : "invalid_command",
              message: err.message
            };
          }
          throw err;
        }
        break;
      }

      case "confirm_reveal": {
        const action: GameAction = {
          type: "confirm_reveal",
          teamId: actorSeat.teamId!,
          playerId: actor.playerId,
          cardId: command.cardId
        };
        try {
          nextState.game = applyGameAction(nextState.game!, action);
        } catch (err) {
          if (err instanceof GameTransitionError) {
            return {
              ok: false,
              revision: this.state.revision,
              code:
                err.reason === "wrong_phase"
                  ? "wrong_phase"
                  : "invalid_command",
              message: err.message
            };
          }
          throw err;
        }
        const revealedCard = nextState.game.board.cards[command.cardId]!;
        newHistoryEntry = {
          revision: nextRevision,
          at: nowIso,
          type: "card_revealed",
          teamId: actorSeat.teamId!,
          cardId: command.cardId,
          owner: revealedCard.owner
        };
        if (nextState.game.phase === "board_complete") {
          nextState.phase = "complete";
        }
        break;
      }

      case "end_turn": {
        const action: GameAction = {
          type: "end_turn",
          teamId: actorSeat.teamId!
        };
        try {
          nextState.game = applyGameAction(nextState.game!, action);
        } catch (err) {
          if (err instanceof GameTransitionError) {
            return {
              ok: false,
              revision: this.state.revision,
              code:
                err.reason === "wrong_phase"
                  ? "wrong_phase"
                  : "invalid_command",
              message: err.message
            };
          }
          throw err;
        }
        newHistoryEntry = {
          revision: nextRevision,
          at: nowIso,
          type: "turn_ended",
          teamId: actorSeat.teamId!
        };
        break;
      }

      case "pause_room": {
        const action: GameAction = { type: "pause" };
        try {
          nextState.game = applyGameAction(nextState.game!, action);
        } catch (err) {
          if (err instanceof GameTransitionError) {
            return {
              ok: false,
              revision: this.state.revision,
              code:
                err.reason === "wrong_phase"
                  ? "wrong_phase"
                  : "invalid_command",
              message: err.message
            };
          }
          throw err;
        }
        newHistoryEntry = {
          revision: nextRevision,
          at: nowIso,
          type: "room_paused"
        };
        break;
      }

      case "resume_room": {
        const action: GameAction = { type: "resume" };
        try {
          nextState.game = applyGameAction(nextState.game!, action);
        } catch (err) {
          if (err instanceof GameTransitionError) {
            return {
              ok: false,
              revision: this.state.revision,
              code:
                err.reason === "wrong_phase"
                  ? "wrong_phase"
                  : "invalid_command",
              message: err.message
            };
          }
          throw err;
        }
        newHistoryEntry = {
          revision: nextRevision,
          at: nowIso,
          type: "room_resumed"
        };
        break;
      }

      default: {
        const _exhaustiveCheck: never = command;
        throw new Error(
          `Unhandled command: ${JSON.stringify(_exhaustiveCheck)}`
        );
      }
    }

    if (newHistoryEntry) {
      nextState.publicHistory.push(newHistoryEntry);
      if (nextState.publicHistory.length > 100) {
        nextState.publicHistory = nextState.publicHistory.slice(-100);
      }
    }

    nextState.revision = nextRevision;
    nextState.lastActivity = nowIso;

    const result: CommandResult = {
      ok: true,
      revision: nextRevision
    };

    nextState.processedCommands.push({
      commandId: envelope.commandId,
      payloadDigest,
      result
    });
    if (nextState.processedCommands.length > 256) {
      nextState.processedCommands = nextState.processedCommands.slice(-256);
    }

    this.state = nextState;
    return result;
  }
}
