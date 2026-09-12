import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import {
  installPublicSmokeTransport,
  type PublicSmokeTransportFailures,
} from "../staging/public-smoke-transport";

interface LocalServer {
  close: () => Promise<void>;
  hits: Record<string, number>;
  origin: string;
}

async function startServer(
  respond: (
    request: IncomingMessage,
    response: ServerResponse,
    hits: Record<string, number>,
  ) => void,
): Promise<LocalServer> {
  const hits: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    hits[path] = (hits[path] ?? 0) + 1;
    respond(request, response, hits);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      }),
    hits,
    origin: `http://127.0.0.1:${port}`,
  };
}

function failures(): PublicSmokeTransportFailures {
  return { unexpectedRequests: 0, redirects: 0 };
}

let publicServer: LocalServer;
let externalServer: LocalServer;

test.use({
  baseURL: undefined,
  serviceWorkers: "block",
  trace: "off",
  screenshot: "off",
  video: "off",
});

test.beforeAll(async () => {
  externalServer = await startServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("external destination reached");
  });
  publicServer = await startServer((request, response) => {
    if (request.url === "/allowed") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'",
        "X-Smoke-Policy": "preserved",
      });
      response.end("<!doctype html><title>Allowed</title><p>allowed bytes</p>");
      return;
    }
    if (request.url === "/redirect-external") {
      response.writeHead(302, {
        Location: `${externalServer.origin}/redirect-target`,
      });
      response.end();
      return;
    }
    if (request.url === "/redirect-query") {
      response.writeHead(307, { Location: "/query-target?unexpected=1" });
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("unexpected destination reached");
  });
});

test.afterAll(async () => {
  await Promise.all([publicServer.close(), externalServer.close()]);
});

test("preserves allowed response status, headers, CSP, and bytes", async ({
  context,
  page,
}) => {
  const counters = failures();
  await installPublicSmokeTransport(context, publicServer.origin, counters);

  const response = await page.goto(`${publicServer.origin}/allowed`);

  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toBe(
    "default-src 'none'",
  );
  expect(response?.headers()["x-smoke-policy"]).toBe("preserved");
  expect((await response!.body()).toString()).toBe(
    "<!doctype html><title>Allowed</title><p>allowed bytes</p>",
  );
  expect(counters).toEqual({ unexpectedRequests: 0, redirects: 0 });
});

test("blocks unsafe methods, queries, and origins before contact", async ({
  context,
  page,
}) => {
  const counters = failures();
  await installPublicSmokeTransport(context, publicServer.origin, counters);

  await page
    .goto(`${publicServer.origin}/query-target?unexpected=1`)
    .catch(() => null);
  await page.goto(`${externalServer.origin}/direct-target`).catch(() => null);
  await page.evaluate(async (url) => {
    await fetch(url, { method: "POST", mode: "no-cors" }).catch(() => null);
  }, `${publicServer.origin}/post-target`);

  expect(publicServer.hits["/query-target?unexpected=1"] ?? 0).toBe(0);
  expect(publicServer.hits["/post-target"] ?? 0).toBe(0);
  expect(externalServer.hits["/direct-target"] ?? 0).toBe(0);
  expect(counters).toEqual({ unexpectedRequests: 3, redirects: 0 });
});

test("blocks an external redirect destination before contact", async ({
  context,
  page,
}) => {
  const counters = failures();
  await installPublicSmokeTransport(context, publicServer.origin, counters);

  await page.goto(`${publicServer.origin}/redirect-external`).catch(() => null);

  expect(publicServer.hits["/redirect-external"]).toBe(1);
  expect(externalServer.hits["/redirect-target"] ?? 0).toBe(0);
  expect(counters).toEqual({ unexpectedRequests: 0, redirects: 1 });
});

test("blocks a same-origin query redirect destination before contact", async ({
  context,
  page,
}) => {
  const counters = failures();
  await installPublicSmokeTransport(context, publicServer.origin, counters);

  await page.goto(`${publicServer.origin}/redirect-query`).catch(() => null);

  expect(publicServer.hits["/redirect-query"]).toBe(1);
  expect(publicServer.hits["/query-target?unexpected=1"] ?? 0).toBe(0);
  expect(counters).toEqual({ unexpectedRequests: 0, redirects: 1 });
});
