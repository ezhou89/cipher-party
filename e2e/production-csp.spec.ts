import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import type { Env } from "../apps/worker/src/env";
import { secureResponse } from "../apps/worker/src/http/security";

const ORIGIN = "https://cipher-party.test";
const dist = fileURLToPath(new URL("../apps/web/dist/", import.meta.url));
const publicPaths = ["/", "/room/ABC123"];
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test.use({
  baseURL: ORIGIN,
  serviceWorkers: "block",
  trace: "off",
  screenshot: "off",
  video: "off",
});

const artifacts = new Map<string, { body: Buffer; contentType: string }>();
test.beforeAll(async () => {
  // check:release builds these files first. Exercise the real bundled entry,
  // including eager schema evaluation; the development server lacks this CSP.
  for (const file of await readdir(dist, { recursive: true })) {
    if (file !== "index.html" && !/\.(js|css)$/u.test(file)) continue;
    artifacts.set(`/${file.split(sep).join("/")}`, {
      body: await readFile(join(dist, file)),
      contentType:
        file === "index.html"
          ? "text/html; charset=utf-8"
          : file.endsWith(".css")
            ? "text/css"
            : "application/javascript",
    });
  }
  expect(
    artifacts.has("/index.html"),
    "build the web app before this test",
  ).toBe(true);
});

for (const path of publicPaths) {
  test(`built public page ${path} starts without CSP violations or room requests`, async ({
    context,
    page,
  }) => {
    const failures = {
      unexpectedRequests: 0,
      sockets: 0,
      consoleErrors: 0,
      pageErrors: 0,
      failedRequests: 0,
      errorResponses: 0,
    };
    await page.addInitScript(() => {
      const violations: { directive: string; kind: string }[] = [];
      window.addEventListener("securitypolicyviolation", (event) => {
        violations.push({
          directive: event.effectiveDirective,
          kind: event.blockedURI === "eval" ? "eval" : "resource",
        });
      });
      Object.defineProperty(window, "__cipherProductionCspViolations", {
        get: () => violations,
      });
    });
    await page.routeWebSocket("**/*", (socket) => {
      failures.sockets += 1;
      socket.close();
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const artifact = artifacts.get(
        publicPaths.includes(url.pathname) ? "/index.html" : url.pathname,
      );
      // All responses are local bytes on a reserved .test origin. Never fall
      // through to a network, API, room creation, ticket, or external script.
      if (
        request.method() !== "GET" ||
        url.origin !== ORIGIN ||
        url.search !== "" ||
        artifact === undefined
      ) {
        failures.unexpectedRequests += 1;
        await route.abort();
        return;
      }
      const secured = secureResponse(
        new Request(url),
        { CANONICAL_ORIGIN: ORIGIN } as Env,
        new Response(null, {
          headers: {
            "Content-Type": artifact.contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        }),
      );
      await route.fulfill({
        status: secured.status,
        headers: Object.fromEntries(secured.headers),
        body: artifact.body,
      });
    });
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
    expect(response?.headers()["content-security-policy"]).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' wss://cipher-party.test; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    expect(response?.headers()["cache-control"]).toBe("no-store, no-transform");
    expect(hash(await response!.body())).toBe(
      hash(artifacts.get("/index.html")!.body),
    );
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
    await expect(page.locator(".key-owner")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __cipherProductionCspViolations: unknown[] })
            .__cipherProductionCspViolations,
      ),
    ).toEqual([]);
    expect(failures).toEqual({
      unexpectedRequests: 0,
      sockets: 0,
      consoleErrors: 0,
      pageErrors: 0,
      failedRequests: 0,
      errorResponses: 0,
    });
  });
}
