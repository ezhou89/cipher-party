import { expect, test, type Page } from "@playwright/test";
import type { ClientProjection } from "@cipher-party/protocol";

import {
  closeConnectedClassicRoom,
  createConnectedClassicRoom,
  latestProjection,
  observeRoomPage,
  waitForProjection,
  waitForNewerProjection,
  type ConnectedClassicRoom,
  type ObservedSeat,
  type RoomFrameObserver,
} from "./helpers/room";

const SECRET_OWNER_TEXT = /(?:Red|Blue|Neutral|Hazard) key$/u;
const EXPECTED_REJECTION_CONSOLE =
  /Failed to load resource: the server responded with a status of (?:404|409)/u;

// Room creation returns durable browser-local credentials. Keep the repository
// default for other tests, but never record this credential-bearing flow.
test.use({ trace: "off" });

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function boardOf(projection: ClientProjection | null) {
  if (projection?.board === null || projection?.board === undefined) {
    throw new Error("Expected an authoritative Classic board projection");
  }
  return projection.board;
}

function unexpectedConsoleIssues(observer: RoomFrameObserver): string[] {
  return observer.consoleIssues.filter(
    (issue) => !EXPECTED_REJECTION_CONSOLE.test(issue),
  );
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

async function readRedTargetLabels(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "Show secret key" }).click();
  await expect(
    page.getByText("Secret ownership is visible.", { exact: true }),
  ).toBeVisible();
  const items = page
    .getByRole("region", { name: "Classic board" })
    .getByRole("listitem");
  await expect(items).toHaveCount(25);
  const labels: string[] = [];
  for (let index = 0; index < 25; index += 1) {
    const item = items.nth(index);
    if ((await item.getByText(/Red key$/u).count()) === 1) {
      labels.push(await item.locator(".board-card-label").innerText());
    }
  }
  expect(labels.length === 8 || labels.length === 9).toBe(true);
  return labels;
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
  return revision;
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
  expect(unexpectedConsoleIssues(frames)).toEqual([]);
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
          expect(unexpectedConsoleIssues(frames)).toEqual([]);
        } finally {
          await context.close();
        }
      },
    });

    const redTargets = await readRedTargetLabels(room.host.page);
    await expectPublicDomHasNoHiddenOwnership(room.redOperative.page);
    await expectPublicDomHasNoHiddenOwnership(room.spectator.page);
    expect(room.redOperative.frames.privacyViolations).toEqual([]);
    expect(room.spectator.frames.privacyViolations).toEqual([]);
    expect(room.redOperative.frames.projections.length).toBeGreaterThan(0);
    expect(room.spectator.frames.projections.length).toBeGreaterThan(0);

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
    const recovered = await waitForProjection(
      room.redOperative.frames,
      (projection) =>
        projection.revision > afterFirstReveal.revision &&
        projection.viewer.playerId === viewerPlayerId &&
        projection.board?.activeTeam === turnBeforeRefresh &&
        projection.board.phase === "guess",
      "the refreshed operative did not recover the same seat and turn",
    );
    expect(recovered.viewer.playerId).toBe(viewerPlayerId);
    expect(room.redOperative.frames.ticketRequests).toBeGreaterThan(
      ticketRequestsBeforeRefresh,
    );
    expect(room.redOperative.frames.socketCount).toBeGreaterThan(
      socketsBeforeRefresh,
    );
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

    expect(room.redOperative.frames.privacyViolations).toEqual([]);
    expect(room.spectator.frames.privacyViolations).toEqual([]);
    for (const seat of room.seats) {
      expect(seat.frames.consoleIssues).toEqual([]);
    }
  } finally {
    if (room !== undefined) {
      await closeConnectedClassicRoom(room);
    }
  }
});
