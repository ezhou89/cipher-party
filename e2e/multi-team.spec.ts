import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { ClientProjection } from "@cipher-party/protocol";

import {
  auditFuturePublicProjectionFrames,
  latestProjection,
  observeRoomPage,
  unexpectedServerOutcomes,
  waitForProjection,
  waitForNewerProjection,
  type ObservedSeat,
} from "./helpers/room";

const DESKTOP_VIEWPORT = { width: 1280, height: 900 } as const;
const PHONE_VIEWPORT = { width: 320, height: 780 } as const;
const TEAM_IDS = ["red", "blue", "green", "yellow"] as const;
const TEAM_LABELS = {
  red: "Red",
  blue: "Blue",
  green: "Green",
  yellow: "Yellow",
} as const;
// The production-generated board seed remains opaque. Fixed room inputs plus
// selection of the key's unique hazard make this test-only scenario repeatable.
const FIXED_HAZARD_FIXTURE = {
  clue: { word: "Beacon", count: "1" },
  seats: {
    red: { clueGiver: "Avery", operative: "Rin" },
    blue: { clueGiver: "Mina", operative: "Kai" },
    green: { clueGiver: "Gita", operative: "Noor" },
    yellow: { clueGiver: "Yara", operative: "Zed" },
  },
} as const;

type TeamId = (typeof TEAM_IDS)[number];
type SecretRead<T> = { ok: true; value: T } | { ok: false };
type SecretAction =
  | "nominate"
  | "nomination_visible"
  | "open_dialog"
  | "dialog_visible"
  | "confirm";
type SecretActionResult = "done" | "ready" | "pending" | "unavailable";
type SecretHazardDiagnostic =
  | "secret_hazard_command_failed"
  | "secret_hazard_command_result_failed"
  | "secret_hazard_confirm_action_failed"
  | "secret_hazard_dialog_action_failed"
  | "secret_hazard_dialog_failed"
  | "secret_hazard_nomination_action_failed"
  | "secret_hazard_nomination_projection_failed"
  | "secret_hazard_nomination_render_failed"
  | "secret_hazard_reveal_failed";

interface TeamSeats {
  clueGiver: ObservedSeat;
  operative: ObservedSeat;
}

interface FourTeamRoom {
  code: string;
  host: ObservedSeat;
  teams: Record<TeamId, TeamSeats>;
  seats: ObservedSeat[];
}

interface SecretRevealRecord {
  beforeRevision: number;
  beforeHistoryLength: number;
  commandId: string;
  cardId: string;
}

// Room creation retains durable credentials and the clue-giver page briefly
// renders the complete key. Never let Playwright retain automatic artifacts.
test.use({ trace: "off", screenshot: "off" });

function boardOf(projection: ClientProjection | null) {
  if (projection?.board === null || projection?.board === undefined) {
    throw new Error("Expected an authoritative four-team board projection");
  }
  return projection.board;
}

async function createObservedSeat(
  browser: Browser,
  baseURL: string,
  viewport: typeof PHONE_VIEWPORT | typeof DESKTOP_VIEWPORT,
  publicObserver: boolean,
): Promise<ObservedSeat> {
  const context = await browser.newContext({
    baseURL,
    viewport,
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    const frames = observeRoomPage(page, { publicObserver });
    return { context, page, frames };
  } catch (error) {
    await Promise.allSettled([context.close()]);
    throw error;
  }
}

async function waitForLobby(seat: ObservedSeat): Promise<void> {
  await expect(seat.page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(
    seat.page.getByRole("heading", { name: "Teams at a glance" }),
  ).toBeVisible();
  await waitForProjection(
    seat.frames,
    (projection) => projection.roomPhase === "lobby",
  );
}

async function joinActiveSeat(
  seat: ObservedSeat,
  code: string,
  displayName: string,
): Promise<void> {
  await seat.page.goto(`/room/${code}`);
  await seat.page.getByLabel("Display name").fill(displayName);
  await seat.page.getByRole("button", { name: "Join this room" }).click();
  await waitForLobby(seat);
}

async function updateSelection(
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

async function createFourTeamRoom(
  browser: Browser,
  baseURL: string,
  beforeStart: (room: FourTeamRoom) => Promise<void>,
): Promise<FourTeamRoom> {
  const seats: ObservedSeat[] = [];
  try {
    const host = await createObservedSeat(
      browser,
      baseURL,
      DESKTOP_VIEWPORT,
      false,
    );
    seats.push(host);
    const redOperative = await createObservedSeat(
      browser,
      baseURL,
      PHONE_VIEWPORT,
      true,
    );
    seats.push(redOperative);
    const blueClueGiver = await createObservedSeat(
      browser,
      baseURL,
      DESKTOP_VIEWPORT,
      false,
    );
    seats.push(blueClueGiver);
    const blueOperative = await createObservedSeat(
      browser,
      baseURL,
      DESKTOP_VIEWPORT,
      true,
    );
    seats.push(blueOperative);
    const greenClueGiver = await createObservedSeat(
      browser,
      baseURL,
      DESKTOP_VIEWPORT,
      false,
    );
    seats.push(greenClueGiver);
    const greenOperative = await createObservedSeat(
      browser,
      baseURL,
      DESKTOP_VIEWPORT,
      true,
    );
    seats.push(greenOperative);
    const yellowClueGiver = await createObservedSeat(
      browser,
      baseURL,
      DESKTOP_VIEWPORT,
      false,
    );
    seats.push(yellowClueGiver);
    const yellowOperative = await createObservedSeat(
      browser,
      baseURL,
      DESKTOP_VIEWPORT,
      true,
    );
    seats.push(yellowOperative);

    const room: FourTeamRoom = {
      code: "",
      host,
      teams: {
        red: { clueGiver: host, operative: redOperative },
        blue: { clueGiver: blueClueGiver, operative: blueOperative },
        green: { clueGiver: greenClueGiver, operative: greenOperative },
        yellow: { clueGiver: yellowClueGiver, operative: yellowOperative },
      },
      seats,
    };

    await host.page.goto("/");
    await host.page
      .getByLabel("Your display name")
      .fill(FIXED_HAZARD_FIXTURE.seats.red.clueGiver);
    await host.page.getByRole("button", { name: "Create Room" }).click();
    await waitForLobby(host);
    const roomPath = new URL(host.page.url()).pathname;
    const code = /^\/room\/([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6})$/u.exec(
      roomPath,
    )?.[1];
    if (code === undefined) {
      throw new Error("Four-team room did not use a canonical room URL");
    }
    room.code = code;

    await updateSelection(host, "Number of teams", "4");
    await joinActiveSeat(
      redOperative,
      code,
      FIXED_HAZARD_FIXTURE.seats.red.operative,
    );
    await joinActiveSeat(
      blueClueGiver,
      code,
      FIXED_HAZARD_FIXTURE.seats.blue.clueGiver,
    );
    await joinActiveSeat(
      blueOperative,
      code,
      FIXED_HAZARD_FIXTURE.seats.blue.operative,
    );
    await joinActiveSeat(
      greenClueGiver,
      code,
      FIXED_HAZARD_FIXTURE.seats.green.clueGiver,
    );
    await joinActiveSeat(
      greenOperative,
      code,
      FIXED_HAZARD_FIXTURE.seats.green.operative,
    );
    await joinActiveSeat(
      yellowClueGiver,
      code,
      FIXED_HAZARD_FIXTURE.seats.yellow.clueGiver,
    );
    await joinActiveSeat(
      yellowOperative,
      code,
      FIXED_HAZARD_FIXTURE.seats.yellow.operative,
    );

    await waitForProjection(
      host.frames,
      (projection) =>
        projection.roomPhase === "lobby" && projection.seats.length === 8,
      "the host did not observe all eight fixed fixture seats",
    );

    for (const teamId of TEAM_IDS) {
      const fixture = FIXED_HAZARD_FIXTURE.seats[teamId];
      await updateSelection(host, `Team for ${fixture.clueGiver}`, teamId);
      await updateSelection(
        host,
        `Role for ${fixture.clueGiver}`,
        "clue-giver",
      );
      await updateSelection(host, `Team for ${fixture.operative}`, teamId);
      await updateSelection(host, `Role for ${fixture.operative}`, "operative");
    }

    await Promise.all(
      seats.map((seat) =>
        waitForProjection(
          seat.frames,
          (projection) =>
            projection.roomPhase === "lobby" &&
            projection.teamCount === 4 &&
            projection.configuredTeams.join(",") === "red,blue,green,yellow" &&
            projection.seats.length === 8,
          "a fixture seat did not receive the configured four-team lobby",
        ),
      ),
    );

    await beforeStart(room);

    const beforeLock = latestProjection(host.frames)?.revision ?? -1;
    await host.page.getByRole("button", { name: "Lock room" }).click();
    await waitForProjection(
      host.frames,
      (projection) => projection.revision > beforeLock && projection.locked,
    );
    await expect(
      host.page.getByText("Entry locked", { exact: true }),
    ).toBeVisible();
    await expect(
      host.page.getByRole("button", { name: "Start board" }),
    ).toBeEnabled();
    await host.page.getByRole("button", { name: "Start board" }).click();

    await Promise.all(
      seats.map(async (seat) => {
        await waitForProjection(
          seat.frames,
          (projection) =>
            projection.roomPhase === "playing" &&
            projection.board?.teamCount === 4 &&
            projection.board.rows === 6 &&
            projection.board.columns === 6 &&
            projection.board.cards.length === 36,
          "a fixture seat did not receive the fixed 6 by 6 board",
        );
        await expect(
          seat.page.getByRole("region", { name: "Classic board" }),
        ).toBeVisible();
      }),
    );

    return room;
  } catch (error) {
    await Promise.allSettled(seats.map((seat) => seat.context.close()));
    throw error;
  }
}

async function expectNoHorizontalPageOverflow(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  expect(page.viewportSize()).toEqual({ width, height });
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.clientWidth).toBe(width);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
}

async function expectFourTeamBoardLayout(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await expectNoHorizontalPageOverflow(page, width, height);
  const board = page.getByRole("region", { name: "Classic board" });
  const hud = page.locator(".game-status-strip");
  await expect(board).toBeVisible();
  await expect(hud).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Team progress" }).locator("strong"),
  ).toHaveCount(4);
  await expect(board.locator(".board-card")).toHaveCount(36);
  await board.scrollIntoViewIfNeeded();
  await board.evaluate((element) => {
    const overflow =
      element.getBoundingClientRect().bottom - window.innerHeight;
    if (overflow > 0) window.scrollBy(0, Math.ceil(overflow));
  });

  const [boardBox, hudBox] = await Promise.all([
    board.boundingBox(),
    hud.boundingBox(),
  ]);
  expect(boardBox).not.toBeNull();
  expect(hudBox).not.toBeNull();
  expect(boardBox!.x).toBeGreaterThanOrEqual(-0.5);
  expect(boardBox!.x + boardBox!.width).toBeLessThanOrEqual(width + 0.5);
  expect(boardBox!.y).toBeGreaterThanOrEqual(-0.5);
  expect(boardBox!.y + boardBox!.height).toBeLessThanOrEqual(height + 0.5);
  expect(hudBox!.y + hudBox!.height).toBeLessThanOrEqual(boardBox!.y + 1);
  await expectNoHorizontalPageOverflow(page, width, height);
}

async function capturePublicScreenshot(
  page: Page,
  testInfo: TestInfo,
  state: "lobby" | "active" | "eliminated",
  viewport: "320x780" | "1280x900",
): Promise<void> {
  const expectedDimensions =
    viewport === "320x780" ? PHONE_VIEWPORT : DESKTOP_VIEWPORT;
  expect(page.viewportSize()).toEqual(expectedDimensions);
  await expect(page.locator(".key-owner")).toHaveCount(0);
  const screenshot = await page.screenshot({
    path: `/tmp/cipher-party-task7-${testInfo.project.name}-${state}-${viewport}.png`,
    animations: "disabled",
  });
  expect(screenshot.readUInt32BE(16)).toBe(expectedDimensions.width);
  expect(screenshot.readUInt32BE(20)).toBe(expectedDimensions.height);
}

async function setSecretKeyVisibility(
  page: Page,
  expectedLabel: "Show secret key" | "Hide secret key",
): Promise<boolean> {
  return page
    .evaluate((label) => {
      const control = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === label,
      );
      if (!(control instanceof HTMLButtonElement) || control.disabled) {
        return false;
      }
      control.click();
      return true;
    }, expectedLabel)
    .catch(() => false);
}

async function waitForSecretKeyState(
  page: Page,
  state: "visible" | "concealed",
): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  do {
    const ready = await page
      .evaluate((expectedState) => {
        const keyCount = document.querySelectorAll(".key-owner").length;
        const buttonLabels = Array.from(
          document.querySelectorAll("button"),
        ).map((button) => button.textContent?.trim());
        if (expectedState === "visible") {
          return keyCount === 36 && buttonLabels.includes("Hide secret key");
        }
        return keyCount === 0 && buttonLabels.includes("Show secret key");
      }, state)
      .catch(() => false);
    if (ready) return true;
    await page.waitForTimeout(25).catch(() => {});
  } while (Date.now() < deadline);
  return false;
}

async function makeSecretPageArtifactSafe(page: Page): Promise<void> {
  const blanked = await page
    .evaluate(() => {
      document.documentElement.replaceChildren(
        document.createElement("head"),
        document.createElement("body"),
      );
      return document.body.childElementCount === 0;
    })
    .catch(() => false);
  if (!blanked) {
    await Promise.allSettled([page.close({ runBeforeUnload: false })]);
  }
}

async function readHazardLabel(page: Page): Promise<string> {
  let extraction: SecretRead<string> = { ok: false };
  let failure:
    "secret_key_reveal_failed" | "secret_key_extraction_failed" | null = null;
  if (
    !(await setSecretKeyVisibility(page, "Show secret key")) ||
    !(await waitForSecretKeyState(page, "visible"))
  ) {
    failure = "secret_key_reveal_failed";
  } else {
    extraction = await page
      .evaluate((): SecretRead<string> => {
        const board = document.querySelector('[aria-label="Classic board"]');
        const items = board?.querySelectorAll("li");
        if (items === undefined || items.length !== 36) return { ok: false };
        const hazardLabels: string[] = [];
        for (const item of items) {
          const hazard = Array.from(
            item.querySelectorAll<HTMLElement>(".key-owner"),
          ).some((owner) => owner.textContent?.trim().endsWith("Hazard key"));
          if (!hazard) continue;
          const label = item
            .querySelector<HTMLElement>(".board-card-label")
            ?.textContent?.trim();
          if (label === undefined || label === "") return { ok: false };
          hazardLabels.push(label);
        }
        return hazardLabels.length === 1
          ? { ok: true, value: hazardLabels[0]! }
          : { ok: false };
      })
      .catch(() => ({ ok: false }));
    if (!extraction.ok) failure = "secret_key_extraction_failed";
  }

  const concealed =
    (await setSecretKeyVisibility(page, "Hide secret key")) &&
    (await waitForSecretKeyState(page, "concealed"));
  if (!concealed) {
    await makeSecretPageArtifactSafe(page);
    throw new Error("secret_key_conceal_failed");
  }
  if (failure !== null || !extraction.ok) {
    throw new Error(failure ?? "secret_key_extraction_failed");
  }
  return extraction.value;
}

async function interactWithSecretCard(
  page: Page,
  secretLabel: string,
  action: SecretAction,
): Promise<SecretActionResult> {
  return page
    .evaluate<
      SecretActionResult,
      { secretLabel: string; action: SecretAction }
    >(
      ({ secretLabel: label, action: requestedAction }) => {
        const board = document.querySelector('[aria-label="Classic board"]');
        const cardLabel = Array.from(
          board?.querySelectorAll<HTMLElement>(".board-card-label") ?? [],
        ).find((candidate) => candidate.textContent?.trim() === label);
        const card = cardLabel?.closest("button");
        const dialogName = `Confirm reveal of ${label}`;
        const dialog = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"]'),
        ).find((candidate) => {
          const explicitLabel = candidate.getAttribute("aria-label")?.trim();
          const labelledBy = candidate
            .getAttribute("aria-labelledby")
            ?.split(/\s+/u)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .join(" ")
            .trim();
          return explicitLabel === dialogName || labelledBy === dialogName;
        });

        if (
          requestedAction === "nominate" ||
          requestedAction === "open_dialog"
        ) {
          if (!(card instanceof HTMLButtonElement) || card.disabled) {
            return "unavailable";
          }
          card.click();
          return "done";
        }
        if (requestedAction === "nomination_visible") {
          return card instanceof HTMLButtonElement &&
            card.getAttribute("aria-pressed") === "true" &&
            card.querySelector(".public-owner") === null
            ? "ready"
            : "pending";
        }
        if (requestedAction === "dialog_visible") {
          return dialog === undefined ? "pending" : "ready";
        }

        const confirm = Array.from(
          dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        ).find((button) => button.textContent?.trim() === "Confirm reveal");
        if (confirm === undefined || confirm.disabled) return "unavailable";
        confirm.click();
        return "done";
      },
      { secretLabel, action },
    )
    .catch(() => "unavailable");
}

async function waitForValueFreeState(
  check: () => Promise<"ready" | "pending" | "invalid">,
  diagnostic: SecretHazardDiagnostic,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  do {
    const state = await check().catch(() => "invalid" as const);
    if (state === "ready") return;
    if (state === "invalid") throw new Error(diagnostic);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error(diagnostic);
}

async function requireSecretAction(
  page: Page,
  secretLabel: string,
  action: SecretAction,
  expected: SecretActionResult,
  diagnostic: SecretHazardDiagnostic,
): Promise<void> {
  const result = await interactWithSecretCard(page, secretLabel, action);
  if (result !== expected) throw new Error(diagnostic);
}

async function nominateSecretHazard(
  seat: ObservedSeat,
  secretLabel: string,
): Promise<{ beforeRevision: number; beforeHistoryLength: number }> {
  const beforeNomination = latestProjection(seat.frames)?.revision ?? -1;
  await requireSecretAction(
    seat.page,
    secretLabel,
    "nominate",
    "done",
    "secret_hazard_nomination_action_failed",
  );
  await waitForValueFreeState(async () => {
    const projection = latestProjection(seat.frames);
    if (projection === null || projection.revision <= beforeNomination) {
      return "pending";
    }
    const board = projection.board;
    if (board === null) return "invalid";
    const card = board.cards.find(
      (candidate) => candidate.label === secretLabel && !candidate.revealed,
    );
    if (card === undefined) return "invalid";
    return board.nomination?.cardId === card.id ? "ready" : "pending";
  }, "secret_hazard_nomination_projection_failed");
  await waitForValueFreeState(async () => {
    const result = await interactWithSecretCard(
      seat.page,
      secretLabel,
      "nomination_visible",
    );
    return result === "ready"
      ? "ready"
      : result === "pending"
        ? "pending"
        : "invalid";
  }, "secret_hazard_nomination_render_failed");
  await requireSecretAction(
    seat.page,
    secretLabel,
    "open_dialog",
    "done",
    "secret_hazard_dialog_action_failed",
  );
  await waitForValueFreeState(async () => {
    const result = await interactWithSecretCard(
      seat.page,
      secretLabel,
      "dialog_visible",
    );
    return result === "ready"
      ? "ready"
      : result === "pending"
        ? "pending"
        : "invalid";
  }, "secret_hazard_dialog_failed");

  const projection = latestProjection(seat.frames);
  if (projection === null) throw new Error("secret_hazard_projection_missing");
  return {
    beforeRevision: projection.revision,
    beforeHistoryLength: projection.publicHistory.length,
  };
}

async function confirmSecretHazard(
  seat: ObservedSeat,
  secretLabel: string,
  beforeRevision: number,
  beforeHistoryLength: number,
): Promise<SecretRevealRecord> {
  const confirmsBefore = seat.frames.sentCommands.filter(
    (envelope) => envelope.command.type === "confirm_reveal",
  ).length;
  await requireSecretAction(
    seat.page,
    secretLabel,
    "confirm",
    "done",
    "secret_hazard_confirm_action_failed",
  );
  await waitForValueFreeState(async () => {
    const count = seat.frames.sentCommands.filter(
      (envelope) => envelope.command.type === "confirm_reveal",
    ).length;
    return count === confirmsBefore + 1
      ? "ready"
      : count <= confirmsBefore
        ? "pending"
        : "invalid";
  }, "secret_hazard_command_failed");
  const envelope = seat.frames.sentCommands.filter(
    (candidate) => candidate.command.type === "confirm_reveal",
  )[confirmsBefore];
  if (envelope?.command.type !== "confirm_reveal") {
    throw new Error("secret_hazard_command_missing");
  }
  const cardId = envelope.command.cardId;
  await waitForValueFreeState(async () => {
    const matches = seat.frames.commandResults.filter(
      (result) => result.commandId === envelope.commandId,
    ).length;
    return matches === 1 ? "ready" : matches === 0 ? "pending" : "invalid";
  }, "secret_hazard_command_result_failed");
  await waitForValueFreeState(async () => {
    const projection = latestProjection(seat.frames);
    if (projection === null || projection.revision <= beforeRevision) {
      return "pending";
    }
    const board = projection.board;
    if (board === null) return "invalid";
    const card = board.cards.find(
      (candidate) => candidate.id === cardId && candidate.revealed,
    );
    return card?.owner === "hazard" ? "ready" : "pending";
  }, "secret_hazard_reveal_failed");

  return {
    beforeRevision,
    beforeHistoryLength,
    commandId: envelope.commandId,
    cardId,
  };
}

async function submitOpeningClue(seat: ObservedSeat): Promise<void> {
  const before = latestProjection(seat.frames)?.revision ?? -1;
  await seat.page.getByLabel("Clue word").fill(FIXED_HAZARD_FIXTURE.clue.word);
  await seat.page
    .getByLabel("Clue count")
    .fill(FIXED_HAZARD_FIXTURE.clue.count);
  await seat.page.getByRole("button", { name: "Submit clue" }).click();
  await waitForProjection(
    seat.frames,
    (projection) =>
      projection.revision > before && projection.board?.phase === "guess",
    "the four-team opening clue did not advance to guessing",
  );
}

function expectNondecreasingRevisions(room: FourTeamRoom): void {
  for (const seat of room.seats) {
    for (let index = 1; index < seat.frames.projections.length; index += 1) {
      expect(seat.frames.projections[index]!.revision).toBeGreaterThanOrEqual(
        seat.frames.projections[index - 1]!.revision,
      );
    }
  }
}

async function expectConvergedRevision(room: FourTeamRoom): Promise<number> {
  expectNondecreasingRevisions(room);
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
        message: "all eight fixture seats did not converge on one revision",
        timeout: 20_000,
      },
    )
    .toBe(true);
  expectNondecreasingRevisions(room);
  return revision;
}

test("multi-team browser spec disables automatic credential and key artifacts", ({
  trace,
  screenshot,
}) => {
  expect(trace).toBe("off");
  expect(screenshot).toBe("off");
});

test("eight isolated seats eliminate one team atomically and preserve public responsive privacy", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(240_000);
  let room: FourTeamRoom | undefined;
  try {
    room = await createFourTeamRoom(browser, baseURL!, async (lobbyRoom) => {
      const mobile = lobbyRoom.teams.red.operative.page;
      const desktop = lobbyRoom.teams.blue.operative.page;
      await expectNoHorizontalPageOverflow(mobile, 320, 780);
      await expectNoHorizontalPageOverflow(desktop, 1280, 900);
      await expect(
        mobile.getByRole("region", { name: "■ Yellow team" }),
      ).toBeVisible();
      await expect(mobile.getByText("Amber", { exact: true })).toBeVisible();
      await mobile
        .getByRole("region", { name: "■ Yellow team" })
        .scrollIntoViewIfNeeded();
      await capturePublicScreenshot(mobile, testInfo, "lobby", "320x780");
      await capturePublicScreenshot(desktop, testInfo, "lobby", "1280x900");
    });

    const openingBoard = boardOf(latestProjection(room.host.frames));
    const openingTeam = openingBoard.activeTeam;
    const openingSeats = room.teams[openingTeam];
    const expectedNextTeam =
      TEAM_IDS[(TEAM_IDS.indexOf(openingTeam) + 1) % TEAM_IDS.length]!;

    expect(openingBoard).toMatchObject({
      teamCount: 4,
      rows: 6,
      columns: 6,
      configuredTeams: TEAM_IDS,
      eliminatedTeams: [],
      phase: "clue",
    });
    expect(openingBoard.cards).toHaveLength(36);
    expect(openingBoard.order).toHaveLength(36);

    const secretHazardLabel = await readHazardLabel(
      openingSeats.clueGiver.page,
    );
    await submitOpeningClue(openingSeats.clueGiver);
    await waitForProjection(
      openingSeats.operative.frames,
      (projection) => projection.board?.phase === "guess",
    );

    const mobilePublicPage = room.teams.red.operative.page;
    const desktopPublicPage = room.teams.blue.operative.page;
    await expectFourTeamBoardLayout(mobilePublicPage, 320, 780);
    await expectFourTeamBoardLayout(desktopPublicPage, 1280, 900);
    await capturePublicScreenshot(
      mobilePublicPage,
      testInfo,
      "active",
      "320x780",
    );
    await capturePublicScreenshot(
      desktopPublicPage,
      testInfo,
      "active",
      "1280x900",
    );

    const nomination = await nominateSecretHazard(
      openingSeats.operative,
      secretHazardLabel,
    );
    await waitForProjection(
      openingSeats.clueGiver.frames,
      (projection) =>
        projection.revision === nomination.beforeRevision &&
        projection.board?.nomination !== null &&
        projection.board?.nomination !== undefined,
      "the opening clue-giver did not observe the public nomination boundary",
    );
    auditFuturePublicProjectionFrames(
      openingSeats.clueGiver.frames,
      "spectator",
    );
    const reveal = await confirmSecretHazard(
      openingSeats.operative,
      secretHazardLabel,
      nomination.beforeRevision,
      nomination.beforeHistoryLength,
    );

    const convergedRevision = await expectConvergedRevision(room);
    expect(convergedRevision).toBe(reveal.beforeRevision + 1);
    for (const seat of room.seats) {
      const projection = latestProjection(seat.frames)!;
      const board = boardOf(projection);
      expect(projection.revision).toBe(convergedRevision);
      expect(projection.roomPhase).toBe("playing");
      expect(board.activeTeam).toBe(expectedNextTeam);
      expect(board.phase).toBe("clue");
      expect(board.eliminatedTeams).toEqual([openingTeam]);
      expect(board.winner).toBeNull();
      expect(board.completionReason).toBeNull();
      expect(projection.publicHistory).toHaveLength(
        reveal.beforeHistoryLength + 1,
      );
      expect(
        projection.publicHistory.filter(
          (entry) => entry.revision === convergedRevision,
        ),
      ).toEqual([
        expect.objectContaining({
          revision: convergedRevision,
          type: "card_revealed",
          teamId: openingTeam,
          cardId: reveal.cardId,
          owner: "hazard",
          eliminatedTeam: openingTeam,
        }),
      ]);
      expect(board.cards.find((card) => card.id === reveal.cardId)).toEqual(
        expect.objectContaining({ revealed: true, owner: "hazard" }),
      );
      expect(board).toEqual(boardOf(latestProjection(room.host.frames)));
      expect(projection.publicHistory).toEqual(
        latestProjection(room.host.frames)!.publicHistory,
      );
    }

    const result = openingSeats.operative.frames.commandResults.filter(
      (candidate) => candidate.commandId === reveal.commandId,
    );
    expect(result).toEqual([
      {
        commandId: reveal.commandId,
        result: { ok: true, revision: convergedRevision },
      },
    ]);

    for (const affected of [openingSeats.clueGiver, openingSeats.operative]) {
      const projection = latestProjection(affected.frames)!;
      expect(projection.viewRole).toBe("spectator");
      expect(projection.viewer.teamId).toBeNull();
      expect(projection.viewer.role).toBe("spectator");
      await expect(
        affected.page.getByRole("region", { name: "Turn status" }),
      ).toBeFocused();
      await expect(
        affected.page.getByRole("region", { name: "Guess controls" }),
      ).toHaveCount(0);
    }

    const finalSeats = latestProjection(room.host.frames)!.seats;
    for (const displayName of Object.values(
      FIXED_HAZARD_FIXTURE.seats[openingTeam],
    )) {
      expect(
        finalSeats.find((seat) => seat.displayName === displayName),
      ).toEqual(
        expect.objectContaining({
          teamId: null,
          role: "spectator",
        }),
      );
    }
    await expect(
      mobilePublicPage.getByRole("region", { name: "Team progress" }),
    ).toContainText("Eliminated");
    await expect(
      mobilePublicPage.getByRole("region", { name: "Public game history" }),
    ).toContainText(`${TEAM_LABELS[openingTeam]} was eliminated.`);

    const eliminatedMobilePage = openingSeats.operative.page;
    await eliminatedMobilePage.setViewportSize(PHONE_VIEWPORT);
    const postEliminationDesktopTeam = TEAM_IDS.find(
      (teamId) => teamId !== openingTeam && teamId !== "red",
    )!;
    const postEliminationDesktopPage =
      room.teams[postEliminationDesktopTeam].operative.page;
    await expectFourTeamBoardLayout(eliminatedMobilePage, 320, 780);
    await expectFourTeamBoardLayout(postEliminationDesktopPage, 1280, 900);
    await eliminatedMobilePage
      .locator(`.team-score-${openingTeam}`)
      .scrollIntoViewIfNeeded();
    await capturePublicScreenshot(
      eliminatedMobilePage,
      testInfo,
      "eliminated",
      "320x780",
    );
    await capturePublicScreenshot(
      postEliminationDesktopPage,
      testInfo,
      "eliminated",
      "1280x900",
    );

    for (const teamId of TEAM_IDS) {
      const pair = room.teams[teamId];
      const operativeProjections = pair.operative.frames.projections.filter(
        (projection) => projection.roomPhase === "playing",
      );
      expect(operativeProjections.length).toBeGreaterThan(0);
      expect(
        operativeProjections.every(
          (projection) =>
            projection.viewRole === "operative" ||
            projection.viewRole === "spectator",
        ),
      ).toBe(true);
      expect(pair.operative.frames.privacyViolations).toEqual([]);
    }
    expect(openingSeats.clueGiver.frames.privacyViolations).toEqual([]);

    for (const seat of room.seats) {
      expect(seat.frames.projectionViolations).toEqual([]);
      expect(seat.frames.serverMessageViolations).toEqual([]);
      expect(unexpectedServerOutcomes(seat.frames)).toEqual([]);
      expect(seat.frames.consoleIssues).toEqual([]);
      expect(seat.frames.httpFailures).toEqual([]);
      await expect(seat.page).toHaveTitle("Cipher Party");
      await expect(seat.page.locator("#root")).not.toBeEmpty();
      await expect(seat.page.locator("vite-error-overlay")).toHaveCount(0);
    }
  } finally {
    if (room !== undefined) {
      await Promise.allSettled(room.seats.map((seat) => seat.context.close()));
    }
  }
});
