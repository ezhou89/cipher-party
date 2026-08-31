import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type {
  ClientProjection,
  CommandEnvelope,
  CommandResult,
} from "@cipher-party/protocol";

const DESKTOP_VIEWPORT = { width: 1280, height: 900 } as const;
const PHONE_VIEWPORT = { width: 320, height: 780 } as const;

type JsonRecord = Record<string, unknown>;

export interface ObservedCommandResult {
  commandId: string;
  result: CommandResult;
}

export interface RoomFrameObserver {
  projections: ClientProjection[];
  sentCommands: CommandEnvelope[];
  commandResults: ObservedCommandResult[];
  privacyViolations: string[];
  ticketRequests: number;
  socketCount: number;
  consoleIssues: string[];
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

function auditPublicProjection(
  projection: JsonRecord,
  observer: RoomFrameObserver,
): void {
  if (
    projection.viewRole !== "operative" &&
    projection.viewRole !== "spectator"
  ) {
    return;
  }
  if (Object.hasOwn(projection, "key")) {
    observer.privacyViolations.push(
      `${String(projection.viewRole)} projection contained a key field`,
    );
  }
  const board = projection.board;
  if (!isRecord(board) || !Array.isArray(board.cards)) {
    return;
  }
  for (const card of board.cards) {
    if (
      isRecord(card) &&
      card.revealed !== true &&
      Object.hasOwn(card, "owner")
    ) {
      observer.privacyViolations.push(
        `${String(projection.viewRole)} projection contained an owner on an unrevealed card`,
      );
    }
  }
}

export function observeRoomPage(page: Page): RoomFrameObserver {
  const observer: RoomFrameObserver = {
    projections: [],
    sentCommands: [],
    commandResults: [],
    privacyViolations: [],
    ticketRequests: 0,
    socketCount: 0,
    consoleIssues: [],
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
    }
  });
  page.on("pageerror", (error) => {
    observer.consoleIssues.push(
      `pageerror: ${redactCredentials(error.message)}`,
    );
  });
  page.on("websocket", (socket) => {
    observer.socketCount += 1;
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
      const frame = parseJsonFrame(payload);
      if (frame?.type === "projection" && isRecord(frame.projection)) {
        auditPublicProjection(frame.projection, observer);
        observer.projections.push(
          frame.projection as unknown as ClientProjection,
        );
        return;
      }
      if (
        frame?.type === "command_result" &&
        typeof frame.commandId === "string" &&
        isRecord(frame.result)
      ) {
        observer.commandResults.push({
          commandId: frame.commandId,
          result: frame.result as unknown as CommandResult,
        });
      }
    });
  });

  return observer;
}

async function createObservedSeat(
  browser: Browser,
  baseURL: string,
  phone = false,
): Promise<ObservedSeat> {
  const context = await browser.newContext({
    baseURL,
    viewport: phone ? PHONE_VIEWPORT : DESKTOP_VIEWPORT,
  });
  const page = await context.newPage();
  const frames = observeRoomPage(page);
  return { context, page, frames };
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
  const host = await createObservedSeat(browser, baseURL);
  const redOperative = await createObservedSeat(browser, baseURL, true);
  const blueClueGiver = await createObservedSeat(browser, baseURL);
  const blueOperative = await createObservedSeat(browser, baseURL);
  const spectator = await createObservedSeat(browser, baseURL);
  const seats = [host, redOperative, blueClueGiver, blueOperative, spectator];

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
}

export async function closeConnectedClassicRoom(
  room: ConnectedClassicRoom,
): Promise<void> {
  await Promise.allSettled(room.seats.map((seat) => seat.context.close()));
}
