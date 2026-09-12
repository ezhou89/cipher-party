import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { installPublicSmokeTransport } from "./public-smoke-transport";

const origin = "https://staging.oddlyuseful.studio";
const publicPaths = ["/", "/room/ABC123"] as const;
const builtIndex = fileURLToPath(
  new URL("../apps/web/dist/index.html", import.meta.url),
);
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

let builtIndexHash = "";

test.beforeAll(async () => {
  builtIndexHash = sha256(await readFile(builtIndex));
});

for (const path of publicPaths) {
  test(`public page ${path} matches the build without browser errors or private traffic`, async ({
    context,
    page,
  }) => {
    const failures = {
      unexpectedRequests: 0,
      redirects: 0,
      sockets: 0,
      cspViolations: 0,
      consoleErrors: 0,
      pageErrors: 0,
      failedRequests: 0,
      errorResponses: 0,
    };

    await page.addInitScript(() => {
      let violations = 0;
      window.addEventListener("securitypolicyviolation", () => {
        violations += 1;
      });
      Object.defineProperty(window, "__cipherPublicSmokeCspViolations", {
        get: () => violations,
      });
    });
    await page.routeWebSocket("**/*", (socket) => {
      failures.sockets += 1;
      socket.close();
    });
    await installPublicSmokeTransport(context, origin, failures);
    page.on("console", (message) => {
      if (message.type() === "error") failures.consoleErrors += 1;
    });
    page.on("pageerror", () => {
      failures.pageErrors += 1;
    });
    page.on("requestfailed", () => {
      failures.failedRequests += 1;
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failures.errorResponses += 1;
    });

    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    expect(sha256(await response!.body())).toBe(builtIndexHash);

    if (path === "/") {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Gather your crew. Find the connection.",
      );
      await expect(
        page.getByRole("button", { name: "Create Room", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Join Room", exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", { name: "Room ABC123", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Display name", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Join this room", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("radio", { name: "Join as player", exact: true }),
      ).toBeChecked();
    }

    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => {
        const focused = document.activeElement;
        return (
          focused !== null &&
          focused !== document.body &&
          focused.matches(":focus-visible") &&
          getComputedStyle(focused).outlineStyle !== "none"
        );
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ) <= window.innerWidth,
      ),
    ).toBe(true);

    failures.cspViolations = await page.evaluate(
      () =>
        (
          window as Window & {
            __cipherPublicSmokeCspViolations: number;
          }
        ).__cipherPublicSmokeCspViolations,
    );
    expect(failures).toEqual({
      unexpectedRequests: 0,
      redirects: 0,
      sockets: 0,
      cspViolations: 0,
      consoleErrors: 0,
      pageErrors: 0,
      failedRequests: 0,
      errorResponses: 0,
    });
  });
}
