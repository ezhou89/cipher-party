import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ClientProjection } from "@cipher-party/protocol";

import {
  auditPublicProjection,
  closeConnectedClassicRoom,
  createConnectedClassicRoom,
  latestProjection,
  observeRoomPage,
  unexpectedServerOutcomes,
  waitForProjection,
  waitForNewerProjection,
  type ConnectedClassicRoom,
  type ObservedSeat,
  type RoomFrameObserver,
} from "./helpers/room";

const SECRET_OWNER_TEXT = /(?:Red|Blue|Neutral|Hazard) key$/u;
const REJECTION_CONSOLE_STATUS =
  /Failed to load resource: the server responded with a status of (\d{3})/u;

// Room creation returns durable browser-local credentials. Keep the repository
// default for other tests, but never record this credential-bearing flow.
test.use({ trace: "off", screenshot: "off" });

function emptyFrameObserver(): RoomFrameObserver {
  return {
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
}

function observeSyntheticRoomFrames(
  options: {
    expectedViewRole?: "operative" | "spectator";
    publicObserver?: boolean;
  } = {},
) {
  const pageListeners = new Map<string, (event: unknown) => void>();
  const socketListeners = new Map<string, (event: unknown) => void>();
  const fakePage = {
    on(event: string, listener: (event: unknown) => void) {
      pageListeners.set(event, listener);
      return fakePage;
    },
  } as unknown as Page;
  const observer = observeRoomPage(fakePage, options);
  const fakeSocket = {
    url: () => "ws://room.test/api/rooms/ABC123/connect",
    on(event: string, listener: (event: unknown) => void) {
      socketListeners.set(event, listener);
      return fakeSocket;
    },
  };
  pageListeners.get("websocket")?.(fakeSocket);

  return {
    observer,
    receive(payload: string | Buffer) {
      socketListeners.get("framereceived")?.({ payload });
    },
  };
}

function validSpectatorProjection(revision: number): ClientProjection {
  return {
    protocolVersion: 1,
    revision,
    code: "ABC123",
    inviteUrl: "http://room.test/room/ABC123",
    roomPhase: "playing",
    locked: true,
    viewer: {
      playerId: "spectator",
      teamId: null,
      role: "spectator",
      isHost: false,
    },
    permissions: {
      configure: false,
      moderate: false,
      submitClue: false,
      challengeClue: false,
      nominate: false,
      confirmReveal: false,
      endTurn: false,
      resolveChallenge: false,
      pause: false,
      resume: false,
    },
    seats: [],
    publicHistory: [],
    board: null,
    viewRole: "spectator",
  };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function boardOf(projection: ClientProjection | null) {
  if (projection?.board === null || projection?.board === undefined) {
    throw new Error("Expected an authoritative Classic board projection");
  }
  return projection.board;
}

interface ExpectedHttpFailure {
  method: string;
  path: string;
  status: number;
}

function unexpectedConsoleIssues(
  observer: RoomFrameObserver,
  expected?: ExpectedHttpFailure,
): string[] {
  if (expected === undefined) {
    return observer.httpFailures.length === 0
      ? [...observer.consoleIssues]
      : [...observer.consoleIssues, "unexpected_http_failure"];
  }

  const exactExpectedResponses = observer.httpFailures.filter(
    (failure) =>
      failure.method === expected.method &&
      failure.path === expected.path &&
      failure.status === expected.status,
  ).length;
  if (
    observer.httpFailures.length !== 1 ||
    exactExpectedResponses !== observer.httpFailures.length
  ) {
    return [...observer.consoleIssues, "unexpected_http_failure"];
  }

  let correlatedResponses = exactExpectedResponses;
  return observer.consoleIssues.filter((issue, index) => {
    const status = Number(REJECTION_CONSOLE_STATUS.exec(issue)?.[1]);
    const locationPath = observer.consoleIssuePaths[index] ?? null;
    if (
      correlatedResponses === 0 ||
      status !== expected.status ||
      (locationPath !== null && locationPath !== expected.path)
    ) {
      return true;
    }
    correlatedResponses -= 1;
    return false;
  });
}

function expectPlayingAndCompleteRole(
  seat: ObservedSeat,
  expectedRole: ClientProjection["viewRole"],
): void {
  const activeProjections = seat.frames.projections.filter(
    (projection) =>
      projection.roomPhase === "playing" || projection.roomPhase === "complete",
  );
  expect(activeProjections.length).toBeGreaterThan(0);
  expect(
    activeProjections.every(
      (projection) => projection.viewRole === expectedRole,
    ),
  ).toBe(true);
}

async function submitClue(
  seat: ObservedSeat,
  word: string,
  count: number,
): Promise<void> {
  const before = latestProjection(seat.frames)?.revision ?? -1;
  await seat.page.getByLabel("Clue word").fill(word);
  await seat.page.getByLabel("Clue count").fill(String(count));
  await seat.page.getByRole("button", { name: "Submit clue" }).click();
  await waitForProjection(
    seat.frames,
    (projection) =>
      projection.revision > before && projection.board?.phase === "guess",
    "the submitted clue did not advance the room to guessing",
  );
}

async function endTurn(seat: ObservedSeat): Promise<void> {
  const before = latestProjection(seat.frames)?.revision ?? -1;
  await seat.page.getByRole("button", { name: "End turn" }).click();
  const dialog = seat.page.getByRole("dialog", { name: "Confirm end turn" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm end turn" }).click();
  await waitForNewerProjection(seat.frames, before);
}

type SecretExtraction<T> = { ok: true; value: T } | { ok: false };

interface SecretReadActions<T> {
  reveal(): Promise<boolean>;
  extract(): Promise<SecretExtraction<T>>;
  conceal(): Promise<boolean>;
  makeArtifactSafe(): Promise<void>;
}

async function readWithSecretConcealed<T>(
  actions: SecretReadActions<T>,
): Promise<T> {
  let completed = false;
  let value: T | undefined;
  let initiatingError: unknown;
  try {
    if (!(await actions.reveal())) {
      throw new Error("secret_key_reveal_failed");
    }
    const extraction = await actions.extract();
    if (!extraction.ok) {
      throw new Error("secret_key_extraction_failed");
    }
    value = extraction.value;
    completed = true;
  } catch (error) {
    initiatingError = error;
  }

  let concealed: boolean;
  try {
    concealed = await actions.conceal();
  } catch {
    concealed = false;
  }
  if (!concealed) {
    await Promise.allSettled([
      Promise.resolve().then(() => actions.makeArtifactSafe()),
    ]);
  }

  if (!completed) {
    throw initiatingError;
  }
  if (!concealed) {
    throw new Error("secret_key_conceal_failed");
  }
  return value as T;
}

async function toggleSecretKeyWithoutLocatorFailure(
  page: Page,
  label: "Show secret key" | "Hide secret key",
): Promise<boolean> {
  return page
    .evaluate((expectedLabel) => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === expectedLabel,
      );
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return false;
      }
      button.click();
      return true;
    }, label)
    .catch(() => false);
}

async function waitForSecretKeyDomState(
  page: Page,
  state: "visible" | "concealed",
): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  do {
    const matches = await page
      .evaluate((expectedState) => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const ownerCount = document.querySelectorAll(".key-owner").length;
        const statusTexts = Array.from(
          document.querySelectorAll<HTMLElement>("p"),
        ).map((element) => element.textContent?.trim());
        if (expectedState === "visible") {
          return statusTexts.includes("Secret ownership is visible.");
        }
        return (
          buttons.some(
            (button) => button.textContent?.trim() === "Show secret key",
          ) && ownerCount === 0
        );
      }, state)
      .catch(() => false);
    if (matches) {
      return true;
    }
    await page.waitForTimeout(25).catch(() => {});
  } while (Date.now() < deadline);
  return false;
}

async function makeSecretPageArtifactSafe(page: Page): Promise<void> {
  const blanked = await page
    .evaluate(() => {
      const head = document.createElement("head");
      const body = document.createElement("body");
      document.documentElement.replaceChildren(head, body);
      return document.body.childElementCount === 0;
    })
    .catch(() => false);
  if (!blanked) {
    await Promise.allSettled([page.close({ runBeforeUnload: false })]);
  }
}

async function extractRedTargetsWithoutAssertions(
  page: Page,
): Promise<SecretExtraction<string[]>> {
  return page
    .evaluate((): SecretExtraction<string[]> => {
      const board = document.querySelector('[aria-label="Classic board"]');
      const items = board?.querySelectorAll("li");
      if (items === undefined || items.length !== 25) {
        return { ok: false };
      }
      const labels: string[] = [];
      for (const item of items) {
        const isRedTarget = Array.from(
          item.querySelectorAll<HTMLElement>(".key-owner"),
        ).some((owner) => owner.textContent?.trim().endsWith("Red key"));
        if (!isRedTarget) {
          continue;
        }
        const label = item
          .querySelector<HTMLElement>(".board-card-label")
          ?.textContent?.trim();
        if (label === undefined || label === "") {
          return { ok: false };
        }
        labels.push(label);
      }
      return labels.length === 8 || labels.length === 9
        ? { ok: true, value: labels }
        : { ok: false };
    })
    .catch(() => ({ ok: false }));
}

async function readRedTargetLabels(page: Page): Promise<string[]> {
  return readWithSecretConcealed({
    reveal: async () => {
      if (
        !(await toggleSecretKeyWithoutLocatorFailure(page, "Show secret key"))
      ) {
        return false;
      }
      return waitForSecretKeyDomState(page, "visible");
    },
    extract: () => extractRedTargetsWithoutAssertions(page),
    conceal: async () => {
      if (
        !(await toggleSecretKeyWithoutLocatorFailure(page, "Hide secret key"))
      ) {
        return false;
      }
      return waitForSecretKeyDomState(page, "concealed");
    },
    makeArtifactSafe: () => makeSecretPageArtifactSafe(page),
  });
}

async function expectPublicDomHasNoHiddenOwnership(page: Page): Promise<void> {
  const board = page.getByRole("region", { name: "Classic board" });
  await expect(board.getByText(SECRET_OWNER_TEXT)).toHaveCount(0);
  const html = (
    await board.evaluate((element) => element.innerHTML)
  ).toLowerCase();
  expect(html).not.toContain("key-owner");
  expect(html).not.toContain("owner-");
}

async function expectSpectatorModerationActionsAbsent(
  page: Page,
): Promise<void> {
  for (const name of [
    "Pause room",
    "Resume room",
    "Accept clue",
    "Reject clue",
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  }
}

async function cancelReveal(seat: ObservedSeat, label: string): Promise<void> {
  const cardName = new RegExp(
    `^${escapeRegularExpression(label)}(?:, nominated)?$`,
    "u",
  );
  const card = seat.page.getByRole("button", { name: cardName });
  const before = latestProjection(seat.frames)?.revision ?? -1;
  await card.click();
  await waitForProjection(
    seat.frames,
    (projection) =>
      projection.revision > before &&
      projection.board?.nomination?.cardId ===
        projection.board.cards.find((candidate) => candidate.label === label)
          ?.id,
  );
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await card.click();
  const dialog = seat.page.getByRole("dialog", {
    name: `Confirm reveal of ${label}`,
  });
  await expect(dialog).toBeVisible();
  const confirmsBefore = seat.frames.sentCommands.filter(
    (envelope) => envelope.command.type === "confirm_reveal",
  ).length;
  await dialog.getByRole("button", { name: "Cancel reveal" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveAttribute("aria-pressed", "true");
  expect(
    seat.frames.sentCommands.filter(
      (envelope) => envelope.command.type === "confirm_reveal",
    ),
  ).toHaveLength(confirmsBefore);
  const projectedCard = boardOf(latestProjection(seat.frames)).cards.find(
    (candidate) => candidate.label === label,
  );
  expect(projectedCard?.revealed).toBe(false);
}

async function revealTarget(
  seat: ObservedSeat,
  label: string,
  alreadyNominated = false,
): Promise<string> {
  const cardName = new RegExp(
    `^${escapeRegularExpression(label)}(?:, nominated)?$`,
    "u",
  );
  const card = seat.page.getByRole("button", { name: cardName });
  if (!alreadyNominated) {
    const beforeNomination = latestProjection(seat.frames)?.revision ?? -1;
    await card.click();
    await waitForProjection(
      seat.frames,
      (projection) =>
        projection.revision > beforeNomination &&
        projection.board?.cards.some(
          (candidate) =>
            candidate.label === label &&
            projection.board?.nomination?.cardId === candidate.id,
        ) === true,
    );
    await expect(card).toHaveAttribute("aria-pressed", "true");
  }

  await card.click();
  const dialog = seat.page.getByRole("dialog", {
    name: `Confirm reveal of ${label}`,
  });
  await expect(dialog).toBeVisible();
  const confirmsBefore = seat.frames.sentCommands.filter(
    (envelope) => envelope.command.type === "confirm_reveal",
  ).length;
  await dialog.getByRole("button", { name: "Confirm reveal" }).click();
  await expect
    .poll(
      () =>
        seat.frames.sentCommands.filter(
          (envelope) => envelope.command.type === "confirm_reveal",
        ).length,
      { message: "the reveal command was not observed on the real socket" },
    )
    .toBe(confirmsBefore + 1);
  const command = seat.frames.sentCommands.filter(
    (envelope) => envelope.command.type === "confirm_reveal",
  )[confirmsBefore]!;
  await expect
    .poll(
      () =>
        seat.frames.commandResults.filter(
          (result) => result.commandId === command.commandId,
        ).length,
      { message: "the reveal command did not receive its socket result" },
    )
    .toBe(1);
  await waitForProjection(
    seat.frames,
    (projection) =>
      projection.board?.cards.some(
        (candidate) =>
          candidate.id === command.command.cardId && candidate.revealed,
      ) === true,
    "the confirmed card did not become publicly revealed",
  );
  return command.commandId;
}

async function expectConvergedRevision(
  room: ConnectedClassicRoom,
): Promise<number> {
  expectNondecreasingProjectionRevisions(room);

  let revision = -1;
  await expect
    .poll(
      () => {
        const revisions = room.seats.map(
          (seat) => latestProjection(seat.frames)?.revision ?? -1,
        );
        revision = revisions[0] ?? -1;
        return revision >= 0 && new Set(revisions).size === 1;
      },
      {
        message: "all isolated clients did not converge on one room revision",
        timeout: 20_000,
      },
    )
    .toBe(true);
  expectNondecreasingProjectionRevisions(room);
  return revision;
}

function expectNondecreasingProjectionRevisions(
  room: ConnectedClassicRoom,
): void {
  for (const seat of room.seats) {
    for (let index = 1; index < seat.frames.projections.length; index += 1) {
      if (
        seat.frames.projections[index]!.revision <
        seat.frames.projections[index - 1]!.revision
      ) {
        throw new Error("observed projection revision regressed");
      }
    }
  }
}

async function assertPhoneBoard(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport?.width).toBe(320);
  const documentWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(documentWidth.scroll).toBeLessThanOrEqual(documentWidth.client);

  const cards = page
    .getByRole("region", { name: "Classic board" })
    .locator(".board-card");
  await expect(cards).toHaveCount(25);
  const boxes = await Promise.all(
    Array.from({ length: 25 }, (_, index) => cards.nth(index).boundingBox()),
  );
  expect(boxes.every((box) => box !== null)).toBe(true);
  const rectangles = boxes.filter((box) => box !== null);
  for (const rectangle of rectangles) {
    expect(rectangle.x).toBeGreaterThanOrEqual(0);
    expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(320.5);
    expect(rectangle.width).toBeGreaterThanOrEqual(44);
    expect(rectangle.height).toBeGreaterThanOrEqual(44);
  }
  for (let index = 0; index < rectangles.length; index += 1) {
    const rectangle = rectangles[index]!;
    const row = Math.floor(index / 5);
    const column = index % 5;
    if (column > 0) {
      expect(rectangle.x).toBeGreaterThan(rectangles[index - 1]!.x);
      expect(Math.abs(rectangle.y - rectangles[index - 1]!.y)).toBeLessThan(2);
    }
    if (row > 0) {
      expect(rectangle.y).toBeGreaterThan(rectangles[index - 5]!.y);
      expect(Math.abs(rectangle.x - rectangles[index - 5]!.x)).toBeLessThan(2);
    }
  }

  const turnStatus = await page
    .getByRole("region", { name: "Turn status" })
    .boundingBox();
  expect(turnStatus).not.toBeNull();
  expect(turnStatus!.y).toBeLessThan(rectangles[0]!.y);
  expect(rectangles[0]!.y + rectangles[0]!.height).toBeLessThanOrEqual(
    viewport!.height,
  );

  const endTurn = await page
    .getByRole("button", { name: "End turn" })
    .boundingBox();
  expect(endTurn).not.toBeNull();
  expect(endTurn!.x).toBeGreaterThanOrEqual(0);
  expect(endTurn!.x + endTurn!.width).toBeLessThanOrEqual(320.5);
  expect(endTurn!.height).toBeGreaterThanOrEqual(44);
}

async function expectHealthyRenderedPage(seat: ObservedSeat): Promise<void> {
  await expect(seat.page).toHaveTitle("Cipher Party");
  const url = new URL(seat.page.url());
  expect(url.search).toBe("");
  expect(url.hash).toBe("");
  await expect(seat.page.locator("#root")).not.toBeEmpty();
  await expect(seat.page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(
    seat.page.locator('[data-nextjs-dialog-overlay="true"]'),
  ).toHaveCount(0);
}

async function installSyntheticSecretKeyPage(
  page: Page,
  cardCount: number,
  concealUnavailable = false,
): Promise<void> {
  await page.setContent(`
    <button type="button">Show secret key</button>
    <p data-secret-status>Secret ownership is hidden.</p>
    <section aria-label="Classic board">
      <ul>
        ${Array.from(
          { length: cardCount },
          (_, index) =>
            `<li><span class="board-card-label">Synthetic card ${index + 1}</span></li>`,
        ).join("")}
      </ul>
    </section>
  `);
  await page.evaluate((shouldDisableConceal) => {
    const button = document.querySelector("button")!;
    const status = document.querySelector<HTMLElement>("[data-secret-status]")!;
    document.body.dataset.concealAttempts = "0";
    button.addEventListener("click", () => {
      if (button.textContent === "Show secret key") {
        button.textContent = "Hide secret key";
        status.textContent = "Secret ownership is visible.";
        document.querySelectorAll("li").forEach((item, index) => {
          const owner = document.createElement("span");
          owner.className = "key-owner";
          owner.textContent = index < 9 ? "Red key" : "Blue key";
          item.append(owner);
        });
        if (shouldDisableConceal) {
          button.setAttribute("disabled", "");
        }
        return;
      }
      document.body.dataset.concealAttempts = String(
        Number(document.body.dataset.concealAttempts ?? "0") + 1,
      );
      button.textContent = "Show secret key";
      status.textContent = "Secret ownership is hidden.";
      document
        .querySelectorAll(".key-owner")
        .forEach((owner) => owner.remove());
    });
  }, concealUnavailable);
}

async function syntheticSecretKeyState(page: Page): Promise<{
  concealAttempts: number;
  hidden: boolean;
}> {
  return page.evaluate(() => ({
    concealAttempts: Number(document.body.dataset.concealAttempts ?? "0"),
    hidden:
      document.querySelector("button")?.textContent === "Show secret key" &&
      document.querySelector("[data-secret-status]")?.textContent ===
        "Secret ownership is hidden." &&
      document.querySelectorAll(".key-owner").length === 0,
  }));
}

async function blankIfSecretKeyVisible(
  page: Page,
  state: { hidden: boolean },
): Promise<void> {
  if (!state.hidden) {
    await page.evaluate(() => document.body.replaceChildren());
  }
}

test("sensitive multiplayer spec disables automatic failure artifacts", ({
  trace,
  screenshot,
}) => {
  expect(trace).toBe("off");
  expect(screenshot).toBe("off");
});

test("secret-key reader conceals the veil before returning targets", async ({
  page,
}) => {
  await installSyntheticSecretKeyPage(page, 25);

  const labels = await readRedTargetLabels(page);
  const state = await syntheticSecretKeyState(page);
  await blankIfSecretKeyVisible(page, state);

  expect(state).toEqual({ concealAttempts: 1, hidden: true });
  expect(labels.length).toBe(9);
});

test("secret-key reader conceals the veil and keeps diagnostics value-free after extraction failure", async ({
  page,
}) => {
  await installSyntheticSecretKeyPage(page, 0);

  let extractionError: unknown;
  try {
    await readRedTargetLabels(page);
  } catch (error) {
    extractionError = error;
  }
  const state = await syntheticSecretKeyState(page);
  await blankIfSecretKeyVisible(page, state);
  const diagnostic =
    extractionError instanceof Error ? extractionError.message : "no_error";

  expect({ ...state, diagnostic }).toEqual({
    concealAttempts: 1,
    hidden: true,
    diagnostic: "secret_key_extraction_failed",
  });
  expect(diagnostic).not.toMatch(/Synthetic card|(?:Red|Blue) key/u);
});

test("secret-key reader makes the page artifact-safe when concealment fails during extraction failure", async ({
  page,
}) => {
  await installSyntheticSecretKeyPage(page, 0, true);

  let extractionError: unknown;
  try {
    await readRedTargetLabels(page);
  } catch (error) {
    extractionError = error;
  }
  const artifactSafe = await page.evaluate(
    () => document.body.childElementCount === 0,
  );
  if (!artifactSafe) {
    await page.evaluate(() => document.body.replaceChildren());
  }
  const diagnostic =
    extractionError instanceof Error ? extractionError.message : "no_error";

  expect({ artifactSafe, diagnostic }).toEqual({
    artifactSafe: true,
    diagnostic: "secret_key_extraction_failed",
  });
  expect(diagnostic).not.toMatch(/Synthetic card|(?:Red|Blue) key/u);
});

test("public projection auditing ignores a frame's claimed role and rejects nested ownership", () => {
  const observer = emptyFrameObserver();

  auditPublicProjection(
    {
      roomPhase: "playing",
      viewRole: "clue-giver",
      key: {},
      nested: {
        keyOwner: "synthetic",
        owners: {},
        ownership: {},
      },
      board: {
        cards: [
          { revealed: false, owner: "synthetic" },
          { revealed: true, owner: "synthetic" },
        ],
      },
      publicHistory: [
        { type: "card_revealed", owner: "synthetic" },
        { type: "room_paused", owner: "synthetic" },
      ],
    },
    observer,
    "operative",
  );

  expect(observer.privacyViolations).toEqual([
    "unexpected_public_view_role",
    "forbidden_hidden_field",
    "forbidden_hidden_field",
    "forbidden_hidden_field",
    "forbidden_hidden_field",
    "owner_on_unrevealed_board_card",
    "owner_outside_public_reveal",
  ]);
});

test("room observer audits and indexes every raw projection before strict validation", () => {
  const { observer, receive } = observeSyntheticRoomFrames({
    expectedViewRole: "spectator",
    publicObserver: true,
  });

  receive(
    JSON.stringify({
      type: "projection",
      projection: [{ nested: { key: {} } }, { owner: "synthetic" }],
    }),
  );
  receive(
    JSON.stringify({
      type: "projection",
      projection: validSpectatorProjection(1),
    }),
  );

  expect(observer.privacyViolations).toEqual([
    "forbidden_hidden_field",
    "owner_outside_public_reveal",
  ]);
  expect(observer.projectionViolations).toEqual(["projection_schema_invalid"]);
  expect(observer.serverMessageViolations).toEqual(["invalid_server_message"]);
  expect(observer.serverFrameOutcomes).toEqual([
    {
      outcome: "invalid_projection_payload",
      socketIndex: 1,
      socketProjectionIndex: 0,
    },
    {
      outcome: "projection_accepted",
      socketIndex: 1,
      socketProjectionIndex: 1,
    },
  ]);
  expect(observer.projectionFrames).toHaveLength(1);
  expect(observer.projectionFrames[0]!.socketProjectionIndex).toBe(1);
});

test("room observer records malformed, non-object, and non-text frame outcomes", () => {
  const { observer, receive } = observeSyntheticRoomFrames();

  receive("{");
  receive("[]");
  receive(Buffer.from("binary-room-frame"));

  expect(observer.serverMessageViolations).toEqual([
    "malformed_json_server_frame",
    "non_object_server_message",
    "non_text_server_frame",
  ]);
  expect(observer.serverFrameOutcomes).toEqual([
    { outcome: "malformed_json", socketIndex: 1 },
    { outcome: "non_object_message", socketIndex: 1 },
    { outcome: "non_text_frame", socketIndex: 1 },
  ]);
});

test("live success validation rejects a valid server error before a later projection", async () => {
  const { observer, receive } = observeSyntheticRoomFrames();
  receive(
    JSON.stringify({
      type: "error",
      code: "internal_error",
      message: "synthetic public error",
    }),
  );
  receive(
    JSON.stringify({
      type: "projection",
      projection: validSpectatorProjection(2),
    }),
  );
  expect(unexpectedServerOutcomes(observer)).toEqual([
    "unexpected_server_outcome",
  ]);
  expect(observer.serverFrameOutcomes.at(-1)?.outcome).toBe(
    "projection_accepted",
  );
});

test("convergence rejects a regressing raw projection sequence", () => {
  const seatWithRevisions = (revisions: number[]): ObservedSeat => {
    const frames = emptyFrameObserver();
    frames.projections = revisions.map(
      (revision) => ({ revision }) as ClientProjection,
    );
    return { frames } as ObservedSeat;
  };
  const room = {
    seats: [
      seatWithRevisions([12, 11, 13]),
      seatWithRevisions([13]),
      seatWithRevisions([13]),
      seatWithRevisions([13]),
      seatWithRevisions([13]),
    ],
  } as ConnectedClassicRoom;
  expect(() => expectNondecreasingProjectionRevisions(room)).toThrow(
    "observed projection revision regressed",
  );
});

test("console filtering preserves an uncorrelated matching status failure", () => {
  const observer = emptyFrameObserver();
  const unrelatedIssue =
    "error: Failed to load resource: the server responded with a status of 409";
  observer.consoleIssues.push(unrelatedIssue);

  expect(unexpectedConsoleIssues(observer)).toEqual([unrelatedIssue]);
});

test("console filtering suppresses only the correlated endpoint failure", () => {
  const observer = emptyFrameObserver();
  const genericFailure =
    "error: Failed to load resource: the server responded with a status of 409";
  observer.consoleIssues.push(genericFailure, genericFailure);
  observer.consoleIssuePaths.push(null, "/unrelated.css");
  observer.httpFailures.push({
    method: "POST",
    path: "/api/rooms/ABC123/join",
    status: 409,
  });
  expect(
    unexpectedConsoleIssues(observer, {
      method: "POST",
      path: "/api/rooms/ABC123/join",
      status: 409,
    }),
  ).toEqual([genericFailure]);
});

test("console filtering rejects an ambiguous extra same-status HTTP failure", () => {
  const observer = emptyFrameObserver();
  const genericFailure =
    "error: Failed to load resource: the server responded with a status of 409";
  observer.consoleIssues.push(genericFailure);
  observer.consoleIssuePaths.push(null);
  observer.httpFailures.push(
    { method: "POST", path: "/api/rooms/ABC123/join", status: 409 },
    { method: "GET", path: "/unrelated.css", status: 409 },
  );

  expect(
    unexpectedConsoleIssues(observer, {
      method: "POST",
      path: "/api/rooms/ABC123/join",
      status: 409,
    }),
  ).toEqual([genericFailure, "unexpected_http_failure"]);
});

test("room setup failure closes every helper-created context", async ({
  browser,
  baseURL,
}) => {
  const initialContexts = new Set(browser.contexts());
  let setupError: unknown;

  try {
    try {
      await createConnectedClassicRoom({
        browser,
        baseURL: baseURL!,
        beforeStart: async () => {
          throw new Error("synthetic setup failure");
        },
      });
    } catch (error) {
      setupError = error;
    }

    expect(setupError).toBeInstanceOf(Error);
    expect((setupError as Error).message).toBe("synthetic setup failure");
    expect(
      browser.contexts().filter((context) => !initialContexts.has(context))
        .length,
    ).toBe(0);
  } finally {
    await Promise.allSettled(
      browser
        .contexts()
        .filter((context) => !initialContexts.has(context))
        .map((context) => context.close()),
    );
  }
});

test("seat setup preserves its original error when context cleanup also fails", async () => {
  const setupError = new Error("synthetic page setup failure");
  let closeAttempts = 0;
  const browser = {
    async newContext() {
      return {
        async newPage() {
          throw setupError;
        },
        async close() {
          closeAttempts += 1;
          throw new Error("synthetic context close failure");
        },
      };
    },
  } as unknown as Browser;

  let receivedError: unknown;
  try {
    await createConnectedClassicRoom({
      browser,
      baseURL: "http://room.test",
    });
  } catch (error) {
    receivedError = error;
  }

  expect(receivedError).toBe(setupError);
  expect(closeAttempts).toBe(1);
});

test("wrong room code reports a focused public error", async ({ page }) => {
  const frames = observeRoomPage(page);
  await page.goto("/");
  await page.getByLabel("Room code").fill("ZZZZZZ");
  await page.getByLabel("Join display name").fill("Noa");
  await page.getByRole("button", { name: "Join Room" }).click();
  const error = page.getByRole("alert");
  await expect(error).toContainText("Room is unavailable.");
  await expect(error).toBeFocused();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  expect(frames.projections).toHaveLength(0);
  expect(
    unexpectedConsoleIssues(frames, {
      method: "POST",
      path: "/api/rooms/ZZZZZZ/join",
      status: 404,
    }),
  ).toEqual([]);
});

test("five isolated clients complete Connected Classic without hidden-data or duplicate-reveal leaks", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000);
  let room: ConnectedClassicRoom | undefined;
  try {
    room = await createConnectedClassicRoom({
      browser,
      baseURL: baseURL!,
      beforeStart: async (code) => {
        const context = await browser.newContext({
          baseURL: baseURL!,
          viewport: { width: 1024, height: 768 },
        });
        try {
          const page = await context.newPage();
          const frames = observeRoomPage(page);
          await page.goto(`/room/${code}`);
          await page.getByLabel("Display name").fill("Late player");
          await page.getByRole("button", { name: "Join this room" }).click();
          const error = page.getByRole("alert");
          await expect(error).toContainText("Room is locked.");
          await expect(error).toBeFocused();
          expect(frames.ticketRequests).toBe(0);
          expect(frames.projections).toHaveLength(0);
          expect(
            unexpectedConsoleIssues(frames, {
              method: "POST",
              path: `/api/rooms/${code}/join`,
              status: 409,
            }),
          ).toEqual([]);
        } finally {
          await context.close();
        }
      },
    });

    const redTargets = await readRedTargetLabels(room.host.page);
    const hostKeyConcealed = await waitForSecretKeyDomState(
      room.host.page,
      "concealed",
    );
    if (!hostKeyConcealed) {
      await makeSecretPageArtifactSafe(room.host.page);
    }
    expect(hostKeyConcealed).toBe(true);
    await expectPublicDomHasNoHiddenOwnership(room.redOperative.page);
    await expectPublicDomHasNoHiddenOwnership(room.blueOperative.page);
    await expectPublicDomHasNoHiddenOwnership(room.spectator.page);
    expect(room.redOperative.frames.privacyViolations).toEqual([]);
    expect(room.blueOperative.frames.privacyViolations).toEqual([]);
    expect(room.spectator.frames.privacyViolations).toEqual([]);
    expect(room.redOperative.frames.projections.length).toBeGreaterThan(0);
    expect(room.blueOperative.frames.projections.length).toBeGreaterThan(0);
    expect(room.spectator.frames.projections.length).toBeGreaterThan(0);

    await expectSpectatorModerationActionsAbsent(room.spectator.page);

    await expect(
      room.spectator.page.getByRole("region", { name: "Clue controls" }),
    ).toHaveCount(0);
    await expect(
      room.spectator.page.getByRole("region", { name: "Guess controls" }),
    ).toHaveCount(0);
    await expect(
      room.spectator.page
        .getByRole("region", { name: "Classic board" })
        .getByRole("button"),
    ).toHaveCount(0);

    const openingTeam = boardOf(latestProjection(room.host.frames)).activeTeam;
    expect(redTargets.length).toBe(openingTeam === "red" ? 9 : 8);
    if (openingTeam === "blue") {
      await submitClue(room.blueClueGiver, "Compass", 1);
      await endTurn(room.blueOperative);
      await waitForProjection(
        room.host.frames,
        (projection) =>
          projection.board?.activeTeam === "red" &&
          projection.board.phase === "clue",
      );
    }

    await submitClue(room.host, "Archive", redTargets.length);
    await waitForProjection(
      room.redOperative.frames,
      (projection) =>
        projection.board?.activeTeam === "red" &&
        projection.board.phase === "guess",
    );
    await assertPhoneBoard(room.redOperative.page);

    const beforePause = latestProjection(room.host.frames)?.revision ?? -1;
    await room.host.page.getByRole("button", { name: "Pause room" }).click();
    await Promise.all(
      room.seats.map((seat) =>
        waitForProjection(
          seat.frames,
          (projection) =>
            projection.revision > beforePause &&
            projection.board?.phase === "paused",
        ),
      ),
    );
    await expect(
      room.spectator.page.getByText("Game actions are paused.", {
        exact: true,
      }),
    ).toBeVisible();
    await expectSpectatorModerationActionsAbsent(room.spectator.page);
    const desktopScreenshot = `/tmp/cipher-party-task12-${testInfo.project.name}-desktop.png`;
    await room.spectator.page.screenshot({ path: desktopScreenshot });

    const beforeResume = latestProjection(room.host.frames)?.revision ?? -1;
    await room.host.page.getByRole("button", { name: "Resume room" }).click();
    await Promise.all(
      room.seats.map((seat) =>
        waitForProjection(
          seat.frames,
          (projection) =>
            projection.revision > beforeResume &&
            projection.board?.phase === "guess",
        ),
      ),
    );

    const firstTarget = redTargets[0]!;
    await cancelReveal(room.redOperative, firstTarget);
    const firstRevealCommandId = await revealTarget(
      room.redOperative,
      firstTarget,
      true,
    );
    const afterFirstReveal = latestProjection(room.redOperative.frames)!;
    const viewerPlayerId = afterFirstReveal.viewer.playerId;
    const turnBeforeRefresh = boardOf(afterFirstReveal).activeTeam;
    const ticketRequestsBeforeRefresh = room.redOperative.frames.ticketRequests;
    const socketsBeforeRefresh = room.redOperative.frames.socketCount;

    await room.redOperative.page.reload({ waitUntil: "domcontentloaded" });
    const recoveredSocketIndex = socketsBeforeRefresh + 1;
    let firstRecoveredFrame = room.redOperative.frames.projectionFrames.find(
      (frame) => frame.socketIndex === recoveredSocketIndex,
    );
    await expect
      .poll(
        () => {
          firstRecoveredFrame = room.redOperative.frames.projectionFrames.find(
            (frame) => frame.socketIndex === recoveredSocketIndex,
          );
          return firstRecoveredFrame !== undefined;
        },
        {
          message:
            "the first projection on the refreshed room socket did not arrive",
          timeout: 20_000,
        },
      )
      .toBe(true);
    expect(firstRecoveredFrame!.socketProjectionIndex).toBe(0);
    const recovered = firstRecoveredFrame!.projection;
    expect(recovered.revision).toBeGreaterThan(afterFirstReveal.revision);
    expect(recovered.viewer.playerId).toBe(viewerPlayerId);
    expect(recovered.board?.activeTeam).toBe(turnBeforeRefresh);
    expect(recovered.board?.phase).toBe("guess");
    expect(room.redOperative.frames.ticketRequests).toBeGreaterThan(
      ticketRequestsBeforeRefresh,
    );
    expect(room.redOperative.frames.socketCount).toBe(recoveredSocketIndex);
    const recoveredRevision = await expectConvergedRevision(room);
    expect(recoveredRevision).toBeGreaterThan(afterFirstReveal.revision);
    const mobileScreenshot = `/tmp/cipher-party-task12-${testInfo.project.name}-320.png`;
    await room.redOperative.page.screenshot({ path: mobileScreenshot });
    await assertPhoneBoard(room.redOperative.page);

    const revealCommandIds = [firstRevealCommandId];
    for (const label of redTargets.slice(1)) {
      revealCommandIds.push(await revealTarget(room.redOperative, label));
    }

    const winningRevision = await expectConvergedRevision(room);
    for (const seat of room.seats) {
      const projection = latestProjection(seat.frames)!;
      expect(projection.revision).toBe(winningRevision);
      expect(projection.roomPhase).toBe("complete");
      expect(projection.board?.winner).toBe("red");
      expect(projection.board?.completionReason).toBe("targets");
      const result = seat.page.getByRole("region", { name: "Board result" });
      await expect(
        result.getByRole("heading", { name: "Red wins" }),
      ).toBeVisible();
      await expect(result).toContainText(
        "All of the winning team’s targets were revealed.",
      );
      await expectHealthyRenderedPage(seat);
    }

    expect(new Set(revealCommandIds).size).toBe(redTargets.length);
    const finalProjection = latestProjection(room.redOperative.frames)!;
    const revealHistory = finalProjection.publicHistory.filter(
      (entry) => entry.type === "card_revealed",
    );
    expect(revealHistory).toHaveLength(redTargets.length);
    expect(new Set(revealHistory.map((entry) => entry.cardId)).size).toBe(
      redTargets.length,
    );
    for (const commandId of revealCommandIds) {
      const envelope = room.redOperative.frames.sentCommands.find(
        (candidate) => candidate.commandId === commandId,
      )!;
      const results = room.redOperative.frames.commandResults.filter(
        (candidate) => candidate.commandId === commandId,
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.result.ok).toBe(true);
      const command = envelope.command;
      expect(command.type).toBe("confirm_reveal");
      if (command.type !== "confirm_reveal") {
        throw new Error("Expected a captured confirm_reveal command");
      }
      expect(
        revealHistory.filter(
          (entry) =>
            entry.revision === results[0]!.result.revision &&
            entry.cardId === command.cardId,
        ),
      ).toHaveLength(1);
    }

    const expectedRoles: [ObservedSeat, ClientProjection["viewRole"]][] = [
      [room.host, "clue-giver"],
      [room.redOperative, "operative"],
      [room.blueClueGiver, "clue-giver"],
      [room.blueOperative, "operative"],
      [room.spectator, "spectator"],
    ];
    for (const [seat, expectedRole] of expectedRoles) {
      expectPlayingAndCompleteRole(seat, expectedRole);
      expect(seat.frames.projectionViolations).toEqual([]);
      expect(seat.frames.serverMessageViolations).toEqual([]);
      expect(seat.frames.serverFrameOutcomes.length).toBeGreaterThan(0);
      expect(unexpectedServerOutcomes(seat.frames)).toEqual([]);
    }
    for (const publicSeat of [
      room.redOperative,
      room.blueOperative,
      room.spectator,
    ]) {
      expect(publicSeat.frames.privacyViolations).toEqual([]);
    }
    expect(room.spectator.frames.sentCommands).toHaveLength(0);
    for (const seat of room.seats) {
      expect(unexpectedConsoleIssues(seat.frames)).toEqual([]);
      expect(seat.frames.httpFailures).toEqual([]);
    }
  } finally {
    if (room !== undefined) {
      await closeConnectedClassicRoom(room);
    }
  }
});
