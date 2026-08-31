import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  ClientProjectionSchema,
  ServerMessageSchema,
  type ClientProjection,
  type CommandEnvelope,
  type CommandResult,
} from "@cipher-party/protocol";

const DESKTOP_VIEWPORT = { width: 1280, height: 900 } as const;
const PHONE_VIEWPORT = { width: 320, height: 780 } as const;

type JsonRecord = Record<string, unknown>;

export interface ObservedCommandResult {
  commandId: string;
  result: CommandResult;
}

export interface ObservedProjectionFrame {
  projection: ClientProjection;
  socketIndex: number;
  socketProjectionIndex: number;
}

export interface ObservedHttpFailure {
  method: string;
  path: string;
  status: number;
}

export interface ObservedServerFrameOutcome {
  outcome:
    | "projection_accepted"
    | "command_result_accepted"
    | "error_accepted"
    | "invalid_projection_payload"
    | "invalid_server_message"
    | "malformed_json"
    | "non_object_message"
    | "non_text_frame";
  socketIndex: number;
  socketProjectionIndex?: number;
}

export interface RoomFrameObserver {
  projections: ClientProjection[];
  projectionFrames: ObservedProjectionFrame[];
  projectionViolations: string[];
  serverMessageViolations: string[];
  serverFrameOutcomes: ObservedServerFrameOutcome[];
  sentCommands: CommandEnvelope[];
  commandResults: ObservedCommandResult[];
  privacyViolations: string[];
  ticketRequests: number;
  socketCount: number;
  consoleIssues: string[];
  consoleIssuePaths: (string | null)[];
  httpFailures: ObservedHttpFailure[];
}

export interface ObservedSeat {
  context: BrowserContext;
  page: Page;
  frames: RoomFrameObserver;
}

export interface ConnectedClassicRoom {
  code: string;
  host: ObservedSeat;
  redOperative: ObservedSeat;
  blueClueGiver: ObservedSeat;
  blueOperative: ObservedSeat;
  spectator: ObservedSeat;
  seats: ObservedSeat[];
}

interface CreateConnectedClassicRoomOptions {
  browser: Browser;
  baseURL: string;
  beforeStart?(code: string): Promise<void>;
}

interface ObserveRoomPageOptions {
  expectedViewRole?: ClientProjection["viewRole"];
  publicObserver?: boolean;
}

interface CreateObservedSeatOptions extends ObserveRoomPageOptions {
  phone?: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonFrame(payload: string | Buffer): JsonRecord | null {
  if (typeof payload !== "string") {
    return null;
  }
  try {
    const value: unknown = JSON.parse(payload);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function redactCredentials(value: string): string {
  return value.replace(/[A-Za-z0-9_-]{43}/gu, "[credential-redacted]");
}

function safePathname(value: string): string | null {
  if (value === "") {
    return null;
  }
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

export function auditPublicProjection(
  projection: unknown,
  observer: RoomFrameObserver,
  expectedViewRole?: "operative" | "spectator",
): void {
  if (expectedViewRole === undefined) {
    return;
  }

  if (
    isRecord(projection) &&
    (projection.roomPhase === "playing" ||
      projection.roomPhase === "complete") &&
    projection.viewRole !== expectedViewRole
  ) {
    observer.privacyViolations.push("unexpected_public_view_role");
  }

  const visit = (value: unknown, path: (string | number)[]): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (!isRecord(value)) {
      return;
    }

    for (const [field, nested] of Object.entries(value)) {
      const normalizedField = field.toLowerCase().replace(/[^a-z]/gu, "");
      if (normalizedField === "owner") {
        const boardCardOwner =
          path.length === 3 &&
          path[0] === "board" &&
          path[1] === "cards" &&
          typeof path[2] === "number";
        const revealedBoardCardOwner =
          boardCardOwner && value.revealed === true;
        const publicRevealOwner =
          path.length === 2 &&
          path[0] === "publicHistory" &&
          typeof path[1] === "number" &&
          value.type === "card_revealed";
        if (!revealedBoardCardOwner && !publicRevealOwner) {
          observer.privacyViolations.push(
            boardCardOwner
              ? "owner_on_unrevealed_board_card"
              : "owner_outside_public_reveal",
          );
        }
        continue;
      }
      if (
        normalizedField === "key" ||
        normalizedField.endsWith("key") ||
        normalizedField.includes("keyowner") ||
        normalizedField.includes("ownerkey") ||
        normalizedField.includes("ownership") ||
        normalizedField.endsWith("owners") ||
        normalizedField.includes("ownermap")
      ) {
        observer.privacyViolations.push("forbidden_hidden_field");
        continue;
      }
      visit(nested, [...path, field]);
    }
  };

  visit(projection, []);
}

function recordProjection(
  projection: ClientProjection,
  observer: RoomFrameObserver,
  options: ObserveRoomPageOptions,
  socketIndex: number,
  socketProjectionIndex: number,
): void {
  if (
    options.expectedViewRole !== undefined &&
    (projection.roomPhase === "playing" ||
      projection.roomPhase === "complete") &&
    projection.viewRole !== options.expectedViewRole
  ) {
    observer.projectionViolations.push("unexpected_projection_view_role");
  }
  observer.projections.push(projection);
  observer.projectionFrames.push({
    projection,
    socketIndex,
    socketProjectionIndex,
  });
}

function recordReceivedRoomFrame(
  payload: string | Buffer,
  observer: RoomFrameObserver,
  options: ObserveRoomPageOptions,
  socketIndex: number,
  socketProjectionIndex: number,
): number {
  if (typeof payload !== "string") {
    observer.serverMessageViolations.push("non_text_server_frame");
    observer.serverFrameOutcomes.push({
      outcome: "non_text_frame",
      socketIndex,
    });
    return socketProjectionIndex;
  }

  let rawMessage: unknown;
  try {
    rawMessage = JSON.parse(payload);
  } catch {
    observer.serverMessageViolations.push("malformed_json_server_frame");
    observer.serverFrameOutcomes.push({
      outcome: "malformed_json",
      socketIndex,
    });
    return socketProjectionIndex;
  }

  if (!isRecord(rawMessage)) {
    observer.serverMessageViolations.push("non_object_server_message");
    observer.serverFrameOutcomes.push({
      outcome: "non_object_message",
      socketIndex,
    });
    return socketProjectionIndex;
  }

  if (rawMessage.type === "projection") {
    const rawProjectionIndex = socketProjectionIndex;
    const nextProjectionIndex = socketProjectionIndex + 1;
    const rawProjection = rawMessage.projection;
    if (options.publicObserver === true) {
      auditPublicProjection(
        rawProjection,
        observer,
        options.expectedViewRole === "operative" ||
          options.expectedViewRole === "spectator"
          ? options.expectedViewRole
          : undefined,
      );
    }

    const parsedProjection = ClientProjectionSchema.safeParse(rawProjection);
    if (!parsedProjection.success) {
      observer.projectionViolations.push("projection_schema_invalid");
    }
    const parsedMessage = ServerMessageSchema.safeParse(rawMessage);
    if (!parsedMessage.success) {
      observer.serverMessageViolations.push("invalid_server_message");
    }
    if (!parsedProjection.success || !parsedMessage.success) {
      observer.serverFrameOutcomes.push({
        outcome: "invalid_projection_payload",
        socketIndex,
        socketProjectionIndex: rawProjectionIndex,
      });
      return nextProjectionIndex;
    }

    recordProjection(
      parsedProjection.data,
      observer,
      options,
      socketIndex,
      rawProjectionIndex,
    );
    observer.serverFrameOutcomes.push({
      outcome: "projection_accepted",
      socketIndex,
      socketProjectionIndex: rawProjectionIndex,
    });
    return nextProjectionIndex;
  }

  const parsedMessage = ServerMessageSchema.safeParse(rawMessage);
  if (!parsedMessage.success) {
    observer.serverMessageViolations.push("invalid_server_message");
    observer.serverFrameOutcomes.push({
      outcome: "invalid_server_message",
      socketIndex,
    });
    return socketProjectionIndex;
  }

  if (parsedMessage.data.type === "command_result") {
    observer.commandResults.push({
      commandId: parsedMessage.data.commandId,
      result: parsedMessage.data.result,
    });
    observer.serverFrameOutcomes.push({
      outcome: "command_result_accepted",
      socketIndex,
    });
    return socketProjectionIndex;
  }

  observer.serverFrameOutcomes.push({
    outcome: "error_accepted",
    socketIndex,
  });
  return socketProjectionIndex;
}

export function observeRoomPage(
  page: Page,
  options: ObserveRoomPageOptions = {},
): RoomFrameObserver {
  const observer: RoomFrameObserver = {
    projections: [],
    projectionFrames: [],
    projectionViolations: [],
    serverMessageViolations: [],
    serverFrameOutcomes: [],
    sentCommands: [],
    commandResults: [],
    privacyViolations: [],
    ticketRequests: 0,
    socketCount: 0,
    consoleIssues: [],
    consoleIssuePaths: [],
    httpFailures: [],
  };

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/tickets")) {
      observer.ticketRequests += 1;
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      observer.consoleIssues.push(
        `${message.type()}: ${redactCredentials(message.text())}`,
      );
      observer.consoleIssuePaths.push(safePathname(message.location().url));
    }
  });
  page.on("pageerror", (error) => {
    observer.consoleIssues.push(
      `pageerror: ${redactCredentials(error.message)}`,
    );
    observer.consoleIssuePaths.push(null);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      observer.httpFailures.push({
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });
  page.on("websocket", (socket) => {
    const socketPath = new URL(socket.url()).pathname;
    if (!socketPath.endsWith("/connect")) {
      return;
    }
    const socketIndex = observer.socketCount + 1;
    observer.socketCount = socketIndex;
    let socketProjectionIndex = 0;
    socket.on("framesent", ({ payload }) => {
      const frame = parseJsonFrame(payload);
      if (
        frame !== null &&
        frame.protocolVersion === 1 &&
        typeof frame.commandId === "string" &&
        isRecord(frame.command)
      ) {
        observer.sentCommands.push(frame as unknown as CommandEnvelope);
      }
    });
    socket.on("framereceived", ({ payload }) => {
      socketProjectionIndex = recordReceivedRoomFrame(
        payload,
        observer,
        options,
        socketIndex,
        socketProjectionIndex,
      );
    });
  });

  return observer;
}

async function createObservedSeat(
  browser: Browser,
  baseURL: string,
  options: CreateObservedSeatOptions,
): Promise<ObservedSeat> {
  const context = await browser.newContext({
    baseURL,
    viewport: options.phone === true ? PHONE_VIEWPORT : DESKTOP_VIEWPORT,
  });
  try {
    const page = await context.newPage();
    const frames = observeRoomPage(page, options);
    return { context, page, frames };
  } catch (error) {
    await Promise.allSettled([context.close()]);
    throw error;
  }
}

export function latestProjection(
  observer: RoomFrameObserver,
): ClientProjection | null {
  return observer.projections.at(-1) ?? null;
}

export async function waitForProjection(
  observer: RoomFrameObserver,
  predicate: (projection: ClientProjection) => boolean,
  message = "authoritative room projection did not arrive",
): Promise<ClientProjection> {
  let matched: ClientProjection | null = null;
  await expect
    .poll(
      () => {
        matched = observer.projections.findLast(predicate) ?? null;
        return matched !== null;
      },
      { message, timeout: 20_000 },
    )
    .toBe(true);
  return matched!;
}

export async function waitForNewerProjection(
  observer: RoomFrameObserver,
  revision: number,
): Promise<ClientProjection> {
  return waitForProjection(
    observer,
    (projection) => projection.revision > revision,
    "a newer authoritative room revision did not arrive",
  );
}

async function waitForConnectedLobby(seat: ObservedSeat): Promise<void> {
  await expect(seat.page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(
    seat.page.getByRole("heading", { name: "Teams at a glance" }),
  ).toBeVisible();
  await waitForProjection(
    seat.frames,
    (projection) => projection.roomPhase === "lobby",
  );
}

async function joinSeat(
  seat: ObservedSeat,
  code: string,
  displayName: string,
  asSpectator: boolean,
): Promise<void> {
  await seat.page.goto(`/room/${code}`);
  await seat.page.getByLabel("Display name").fill(displayName);
  if (asSpectator) {
    await seat.page.getByLabel("Join as spectator").check();
  }
  await seat.page.getByRole("button", { name: "Join this room" }).click();
  await waitForConnectedLobby(seat);
}

async function updateAssignment(
  host: ObservedSeat,
  label: string,
  value: string,
): Promise<void> {
  const control = host.page.getByLabel(label, { exact: true });
  await expect(control).toBeEnabled();
  const before = latestProjection(host.frames)?.revision ?? -1;
  await control.selectOption(value);
  await waitForNewerProjection(host.frames, before);
  await expect(control).toHaveValue(value);
  await expect(control).toBeEnabled();
}

export async function createConnectedClassicRoom({
  browser,
  baseURL,
  beforeStart,
}: CreateConnectedClassicRoomOptions): Promise<ConnectedClassicRoom> {
  const seats: ObservedSeat[] = [];
  try {
    const host = await createObservedSeat(browser, baseURL, {
      expectedViewRole: "clue-giver",
    });
    seats.push(host);
    const redOperative = await createObservedSeat(browser, baseURL, {
      expectedViewRole: "operative",
      phone: true,
      publicObserver: true,
    });
    seats.push(redOperative);
    const blueClueGiver = await createObservedSeat(browser, baseURL, {
      expectedViewRole: "clue-giver",
    });
    seats.push(blueClueGiver);
    const blueOperative = await createObservedSeat(browser, baseURL, {
      expectedViewRole: "operative",
      publicObserver: true,
    });
    seats.push(blueOperative);
    const spectator = await createObservedSeat(browser, baseURL, {
      expectedViewRole: "spectator",
      publicObserver: true,
    });
    seats.push(spectator);

    await host.page.goto("/");
    await host.page.getByLabel("Your display name").fill("Avery");
    await host.page.getByRole("button", { name: "Create Room" }).click();
    await waitForConnectedLobby(host);
    const roomPath = new URL(host.page.url()).pathname;
    const code = /^\/room\/([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6})$/u.exec(
      roomPath,
    )?.[1];
    if (code === undefined) {
      throw new Error("Room creation did not navigate to a canonical room URL");
    }

    await joinSeat(redOperative, code, "Rin", false);
    await joinSeat(blueClueGiver, code, "Mina", false);
    await joinSeat(blueOperative, code, "Kai", false);
    await joinSeat(spectator, code, "Jules", true);
    await waitForProjection(
      host.frames,
      (projection) => projection.seats.length === 5,
      "the host did not observe all five isolated seats",
    );

    await updateAssignment(host, "Team for Avery", "red");
    await updateAssignment(host, "Role for Avery", "clue-giver");
    await updateAssignment(host, "Team for Rin", "red");
    await updateAssignment(host, "Role for Rin", "operative");
    await updateAssignment(host, "Team for Mina", "blue");
    await updateAssignment(host, "Role for Mina", "clue-giver");
    await updateAssignment(host, "Team for Kai", "blue");
    await updateAssignment(host, "Role for Kai", "operative");

    const beforeLock = latestProjection(host.frames)?.revision ?? -1;
    await host.page.getByRole("button", { name: "Lock room" }).click();
    await waitForProjection(
      host.frames,
      (projection) => projection.revision > beforeLock && projection.locked,
    );
    await expect(
      host.page.getByText("Entry locked", { exact: true }),
    ).toBeVisible();

    await beforeStart?.(code);

    await expect(
      host.page.getByRole("button", { name: "Start board" }),
    ).toBeEnabled();
    await host.page.getByRole("button", { name: "Start board" }).click();
    await Promise.all(
      seats.map(async (seat) => {
        await waitForProjection(
          seat.frames,
          (projection) =>
            projection.roomPhase === "playing" && projection.board !== null,
          "a seat did not receive the started Classic board",
        );
        await expect(
          seat.page.getByRole("region", { name: "Classic board" }),
        ).toBeVisible();
      }),
    );

    return {
      code,
      host,
      redOperative,
      blueClueGiver,
      blueOperative,
      spectator,
      seats,
    };
  } catch (error) {
    await Promise.allSettled(seats.map((seat) => seat.context.close()));
    throw error;
  }
}

export async function closeConnectedClassicRoom(
  room: ConnectedClassicRoom,
): Promise<void> {
  await Promise.allSettled(room.seats.map((seat) => seat.context.close()));
}
