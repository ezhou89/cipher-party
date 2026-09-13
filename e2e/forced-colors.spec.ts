import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ colorScheme: "light", forcedColors: "active" });

test("light forced colors remap Amber, muted status copy, and the turn clue", async ({
  browserName,
  page,
}) => {
  test.skip(
    browserName !== "chromium",
    "Forced-colors emulation is Chromium-only",
  );

  const [tokens, globals] = await Promise.all([
    readFile(
      new URL("../apps/web/src/styles/tokens.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../apps/web/src/styles/globals.css", import.meta.url),
      "utf8",
    ),
  ]);
  await page.setContent(`
    <style>${tokens}\n${globals}</style>
    <div
      data-testid="system-colors"
      style="forced-color-adjust: none; background: Canvas; color: CanvasText"
    >System colors</div>
    <section class="team-panel team-panel-yellow" data-testid="yellow-panel">
      <p class="team-callsign" data-testid="panel-amber">■ Amber</p>
      <span class="seat-role" data-testid="panel-muted">Clue-giver</span>
    </section>
    <section class="team-score">
      <strong class="team-score-yellow" data-testid="yellow-score">
        <span class="team-callsign" data-testid="score-amber">■ Amber</span>
        <span data-testid="score-muted">Yellow revealed targets 2</span>
      </strong>
    </section>
    <section
      class="turn-status turn-status-yellow"
      data-testid="yellow-turn"
    >
      <span class="turn-clue" data-testid="turn-clue">Signal · 2</span>
    </section>
  `);
  await page.emulateMedia({ colorScheme: "light", forcedColors: "active" });

  await expect
    .poll(() =>
      page.evaluate(() => matchMedia("(forced-colors: active)").matches),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches),
    )
    .toBe(true);

  const systemColors = await page
    .getByTestId("system-colors")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, text: style.color };
    });
  expect(systemColors).toEqual({
    background: "rgb(255, 255, 255)",
    text: "rgb(0, 0, 0)",
  });

  for (const testId of [
    "panel-amber",
    "panel-muted",
    "score-amber",
    "score-muted",
    "turn-clue",
  ]) {
    await expect(page.getByTestId(testId)).toHaveCSS(
      "color",
      systemColors.text,
    );
  }
  for (const [testId, borderProperty] of [
    ["yellow-panel", "border-top-style"],
    ["yellow-score", "border-left-style"],
    ["yellow-turn", "border-top-style"],
  ] as const) {
    const element = page.getByTestId(testId);
    await expect(element).toHaveCSS(
      "background-color",
      systemColors.background,
    );
    await expect(element).toHaveCSS(borderProperty, "dotted");
  }
});
