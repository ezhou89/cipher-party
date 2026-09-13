import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import worker from "../src/index";

const ORIGIN = "https://staging.oddlyuseful.studio";
const IP = "192.0.2.10";
const limiterNames = [
  "CREATE_BY_IP",
  "JOIN_BY_IP",
  "JOIN_BY_ROOM",
  "TICKET_BY_IP",
  "TICKET_BY_ROOM",
  "CONNECT_BY_IP",
  "CONNECT_BY_ROOM",
] as const;

function fixture() {
  const rooms = (env as unknown as Env).ROOMS;
  const idFromName = vi.fn((code: string) => rooms.idFromName(code));
  const get = vi.fn((id: DurableObjectId) => rooms.get(id));
  const assets = vi.fn(
    async () =>
      new Response("<!doctype html><title>Cipher Party</title>", {
        headers: { "Content-Type": "text/html", "Cache-Control": "public" },
      }),
  );
  const limits = Object.fromEntries(
    limiterNames.map((name) => [
      name,
      {
        limit: vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(
          async () => ({ success: true }),
        ),
      },
    ]),
  ) as Record<
    (typeof limiterNames)[number],
    {
      limit: ReturnType<
        typeof vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>
      >;
    }
  >;
  const bindings = {
    ...env,
    CANONICAL_ORIGIN: ORIGIN,
    ASSETS: { fetch: assets },
    ROOMS: { idFromName, get },
    ...limits,
  } as unknown as Env & typeof limits;
  return { bindings, limits, assets, idFromName, get, rooms };
}

function request(
  bindings: Env,
  path: string,
  init: RequestInit = {},
  origin = ORIGIN,
) {
  return worker.fetch(
    new Request(`${origin}${path}`, {
      ...init,
      headers: {
        "CF-Connecting-IP": IP,
        "Content-Type": "application/json",
        ...init.headers,
      },
    }),
    bindings,
  );
}

function post(bindings: Env, path = "/api/rooms") {
  return request(bindings, path, {
    method: "POST",
    body: JSON.stringify(
      path === "/api/rooms"
        ? { displayName: "Player" }
        : { displayName: "Player", asSpectator: false },
    ),
  });
}

function expectHeaders(response: Response, secure = true) {
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' wss://staging.oddlyuseful.studio; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("Permissions-Policy")).toBe(
    "camera=(), geolocation=(), microphone=(), payment=()",
  );
  expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  expect(response.headers.get("Strict-Transport-Security")).toBe(
    secure ? "max-age=31536000" : null,
  );
}

describe("staging transport and response policy", () => {
  it.each(["/", "/room/ABC123?view=invite", "/assets/app.js"])(
    "redirects canonical HTTP app request %s without serving assets",
    async (path) => {
      const { bindings, assets, idFromName } = fixture();
      const response = await request(
        bindings,
        path,
        {},
        ORIGIN.replace("https:", "http:"),
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("Location")).toBe(`${ORIGIN}${path}`);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expectHeaders(response, false);
      expect(assets).not.toHaveBeenCalled();
      expect(idFromName).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/api/rooms",
    "/api/rooms/ABC123/join",
    "/api/rooms/ABC123/tickets",
    "/api/rooms/ABC123/connect?ticket=unused",
  ])(
    "rejects insecure API %s before reading credentials or rooms",
    async (path) => {
      const { bindings, limits, idFromName } = fixture();
      const response = await request(
        bindings,
        path,
        { method: "POST", body: "unused" },
        ORIGIN.replace("https:", "http:"),
      );
      expect(response.status).toBe(426);
      expect(response.headers.get("Location")).toBeNull();
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expectHeaders(response, false);
      expect(idFromName).not.toHaveBeenCalled();
      for (const limiter of Object.values(limits))
        expect(limiter.limit).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://attacker.invalid",
    "https://attacker.invalid",
    "https://staging.oddlyuseful.studio:444",
  ])(
    "rejects noncanonical origin %s without an open redirect",
    async (origin) => {
      const { bindings, assets, idFromName } = fixture();
      const response = await request(
        bindings,
        "/api/rooms",
        { method: "POST" },
        origin,
      );
      expect(response.status).toBe(421);
      expect(response.headers.get("Location")).toBeNull();
      expect(assets).not.toHaveBeenCalled();
      expect(idFromName).not.toHaveBeenCalled();
    },
  );

  it("keeps local HTTP app and room creation usable without staging bindings", async () => {
    const { bindings, assets } = fixture();
    bindings.CANONICAL_ORIGIN = "http://127.0.0.1:5173";
    for (const name of limiterNames)
      delete (bindings as Partial<typeof bindings>)[name];
    const page = await worker.fetch(
      new Request("http://127.0.0.1:5173/"),
      bindings,
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("Strict-Transport-Security")).toBeNull();
    expect(assets).toHaveBeenCalledOnce();
    const created = await worker.fetch(
      new Request("http://request.invalid/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Host" }),
      }),
      bindings,
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    ["/", "no-store, no-transform"],
    ["/room/ABC123", "no-store, no-transform"],
    ["/api/health", "no-store"],
    ["/api/rooms/invalid/join", "no-store"],
  ])(
    "secures %s without caching or transforming HTML",
    async (path, cacheControl) => {
      const { bindings } = fixture();
      const response = path.endsWith("join")
        ? await post(bindings, path)
        : await request(bindings, path);
      expectHeaders(response);
      expect(response.headers.get("Cache-Control")).toBe(cacheControl);
    },
  );

  it("preserves HTML bytes and disables transformations even on an HTML error", async () => {
    const { bindings, assets } = fixture();
    const html = "<!doctype html><title>Unavailable</title>";
    assets.mockResolvedValueOnce(
      new Response(html, {
        status: 404,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      }),
    );
    const response = await request(bindings, "/missing");
    expect(response.status).toBe(404);
    expectHeaders(response);
    expect(response.headers.get("Cache-Control")).toBe(
      "no-store, no-transform",
    );
    expect(await response.text()).toBe(html);
  });

  it.each([
    ["js", "application/javascript", "console.log('public')"],
    ["css", "text/css", "body { color: black; }"],
  ])(
    "preserves hashed %s bytes and successful asset caching while adding headers",
    async (extension, contentType, bytes) => {
      const { bindings, assets } = fixture();
      assets.mockResolvedValueOnce(
        new Response(bytes, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        }),
      );
      const response = await request(
        bindings,
        `/assets/index-abc123.${extension}`,
      );
      expectHeaders(response);
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(await response.text()).toBe(bytes);
    },
  );

  it.each([
    "/api",
    "/api/missing",
    "/api/rooms//join",
    "/api/rooms/ABC123/join/extra",
  ])("does not serve the SPA for unmatched API path %s", async (path) => {
    const { bindings, assets } = fixture();
    const response = await request(bindings, path, { method: "POST" });
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expectHeaders(response);
    expect(assets).not.toHaveBeenCalled();
  });

  it("preserves a real successful WebSocket upgrade and initial projection", async () => {
    const { bindings } = fixture();
    const created = await request(bindings, "/api/rooms", {
      method: "POST",
      body: JSON.stringify({ displayName: "Host" }),
    });
    expect(created.status).toBe(201);
    const seat = (await created.json()) as { code: string; seatToken: string };
    const ticketResponse = await request(
      bindings,
      `/api/rooms/${seat.code}/tickets`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${seat.seatToken}` },
      },
    );
    expect(ticketResponse.headers.get("Cache-Control")).toBe("no-store");
    const { ticket } = (await ticketResponse.json()) as { ticket: string };
    const response = await request(
      bindings,
      `/api/rooms/${seat.code}/connect?ticket=${ticket}`,
      {
        headers: { Upgrade: "websocket" },
      },
    );
    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();
    const socket = response.webSocket!;
    const firstMessage = new Promise<string>((resolve) =>
      socket.addEventListener(
        "message",
        (event) => resolve(String(event.data)),
        { once: true },
      ),
    );
    socket.accept();
    try {
      expect(JSON.parse(await firstMessage)).toMatchObject({
        type: "projection",
      });
    } finally {
      socket.close(1000, "test complete");
    }
  });
});

describe("staging admission limits", () => {
  it("rejects malformed upgrade syntax without charging connect counters or looking up a room", async () => {
    const { bindings, limits, idFromName } = fixture();
    const ticket = "a".repeat(43);
    for (const [path, init] of [
      [
        `/api/rooms/ABC123/connect?ticket=${ticket}`,
        { method: "POST", headers: { Upgrade: "websocket" } },
      ],
      [`/api/rooms/ABC123/connect?ticket=${ticket}`, {}],
      [
        `/api/rooms/invalid/connect?ticket=${ticket}`,
        { headers: { Upgrade: "websocket" } },
      ],
      [
        "/api/rooms/ABC123/connect?ticket=bad",
        { headers: { Upgrade: "websocket" } },
      ],
      [
        `/api/rooms/ABC123/connect?ticket=${ticket}&extra=1`,
        { headers: { Upgrade: "websocket" } },
      ],
    ] as const)
      expect((await request(bindings, path, init)).status).toBe(401);
    expect(limits.CONNECT_BY_IP.limit).not.toHaveBeenCalled();
    expect(limits.CONNECT_BY_ROOM.limit).not.toHaveBeenCalled();
    expect(idFromName).not.toHaveBeenCalled();
  });

  it.each(["deny", "fail", "missing"] as const)(
    "blocks upgrades before room lookup when a connect limiter is %s",
    async (mode) => {
      for (const name of ["CONNECT_BY_IP", "CONNECT_BY_ROOM"] as const) {
        const { bindings, limits, idFromName, get } = fixture();
        if (mode === "deny")
          limits[name].limit.mockResolvedValue({ success: false });
        if (mode === "fail")
          limits[name].limit.mockRejectedValue(new Error("unavailable"));
        if (mode === "missing")
          delete (bindings as Partial<typeof bindings>)[name];
        const response = await request(
          bindings,
          `/api/rooms/ABC123/connect?ticket=${"a".repeat(43)}`,
          { headers: { Upgrade: "websocket" } },
        );
        expect(response.status).toBe(429);
        expect(response.headers.get("Retry-After")).toBe("60");
        expect(idFromName).not.toHaveBeenCalled();
        expect(get).not.toHaveBeenCalled();
        const other =
          name === "CONNECT_BY_IP" ? "CONNECT_BY_ROOM" : "CONNECT_BY_IP";
        expect(limits[other].limit).toHaveBeenCalledOnce();
        expect(limits[other].limit.mock.calls[0]![0].key).toMatch(
          /^cipher-party:https:\/\/staging\.oddlyuseful\.studio:connect:(?:ip|room):[a-f0-9]{64}$/u,
        );
      }
    },
  );

  it.each([
    ["/api/rooms", "CREATE_BY_IP"],
    ["/api/rooms/ABC123/join", "JOIN_BY_IP"],
    ["/api/rooms/ABC123/join", "JOIN_BY_ROOM"],
    ["/api/rooms/ABC123/tickets", "TICKET_BY_IP"],
    ["/api/rooms/ABC123/tickets", "TICKET_BY_ROOM"],
  ] as const)(
    "denies %s on exhausted %s before any room lookup",
    async (path, name) => {
      const { bindings, limits, idFromName, get } = fixture();
      limits[name].limit.mockResolvedValue({ success: false });
      const response = await post(bindings, path);
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({
        error: { code: "rate_limited" },
      });
      expectHeaders(response);
      expect(idFromName).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("awaits both IP and room outcomes even when the IP outcome denies", async () => {
    const { bindings, limits, idFromName } = fixture();
    limits.JOIN_BY_IP.limit.mockResolvedValue({ success: false });
    let finishRoom!: (value: { success: boolean }) => void;
    limits.JOIN_BY_ROOM.limit.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRoom = resolve;
        }),
    );
    let finished = false;
    const pending = post(bindings, "/api/rooms/ABC123/join").then(
      (response) => {
        finished = true;
        return response;
      },
    );
    await vi.waitFor(() =>
      expect(limits.JOIN_BY_ROOM.limit).toHaveBeenCalledOnce(),
    );
    expect(finished).toBe(false);
    expect(idFromName).not.toHaveBeenCalled();
    finishRoom({ success: true });
    expect((await pending).status).toBe(429);
  });

  it("normalizes aliases before room accounting and ignores invalid room codes", async () => {
    const { bindings, limits } = fixture();
    await post(bindings, "/api/rooms/olabcd/join");
    await post(bindings, "/api/rooms/01ABCD/join");
    expect(limits.JOIN_BY_ROOM.limit).toHaveBeenCalledTimes(2);
    expect(limits.JOIN_BY_ROOM.limit.mock.calls[0]?.[0]).toEqual(
      limits.JOIN_BY_ROOM.limit.mock.calls[1]?.[0],
    );
    expect(limits.JOIN_BY_ROOM.limit.mock.calls[0]?.[0].key).toMatch(
      /^cipher-party:https:\/\/staging\.oddlyuseful\.studio:join:room:[a-f0-9]{64}$/u,
    );
    expect((await post(bindings, "/api/rooms/invalid/join")).status).toBe(404);
    expect((await post(bindings, "/api/rooms/%2FABCDE/join")).status).toBe(404);
    expect(limits.JOIN_BY_IP.limit).toHaveBeenCalledTimes(4);
    expect(limits.JOIN_BY_ROOM.limit).toHaveBeenCalledTimes(2);
  });

  it("uses only the trusted IP and scopes hashed keys by origin and purpose", async () => {
    const { bindings, limits } = fixture();
    await post(bindings);
    await request(bindings, "/api/rooms", {
      method: "POST",
      headers: {
        "X-Forwarded-For": "203.0.113.1",
        Origin: "https://attacker.invalid",
      },
    });
    expect(limits.CREATE_BY_IP.limit).toHaveBeenCalledTimes(2);
    const first = limits.CREATE_BY_IP.limit.mock.calls[0]?.[0].key;
    expect(first).toMatch(
      /^cipher-party:https:\/\/staging\.oddlyuseful\.studio:create:ip:[a-f0-9]{64}$/u,
    );
    expect(first).not.toContain(IP);
    expect(limits.CREATE_BY_IP.limit.mock.calls[1]?.[0].key).toBe(first);
    await request(bindings, "/api/rooms", {
      method: "POST",
      headers: { "CF-Connecting-IP": "192.0.2.11" },
    });
    expect(limits.CREATE_BY_IP.limit.mock.calls[2]?.[0].key).not.toBe(first);
    await post(bindings, "/api/rooms/ABC123/join");
    expect(limits.JOIN_BY_IP.limit.mock.calls[0]?.[0].key).not.toBe(first);
    bindings.CANONICAL_ORIGIN = "https://another.invalid";
    await request(
      bindings,
      "/api/rooms",
      { method: "POST" },
      "https://another.invalid",
    );
    expect(limits.CREATE_BY_IP.limit.mock.calls[3]?.[0].key).not.toBe(first);
  });

  it.each([undefined, "", "   "])(
    "fails closed when the trusted IP is %s",
    async (ip) => {
      const { bindings, idFromName } = fixture();
      const response = await worker.fetch(
        new Request(`${ORIGIN}/api/rooms`, {
          method: "POST",
          headers: {
            ...(ip === undefined ? {} : { "CF-Connecting-IP": ip }),
            "X-Forwarded-For": IP,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ displayName: "Host" }),
        }),
        bindings,
      );
      expect(response.status).toBe(429);
      expect(idFromName).not.toHaveBeenCalled();
    },
  );

  it.each([
    "CREATE_BY_IP",
    "JOIN_BY_IP",
    "JOIN_BY_ROOM",
    "TICKET_BY_IP",
    "TICKET_BY_ROOM",
  ] as const)("fails closed with missing staging binding %s", async (name) => {
    const { bindings, idFromName } = fixture();
    delete (bindings as Partial<typeof bindings>)[name];
    const path = name.startsWith("CREATE")
      ? "/api/rooms"
      : `/api/rooms/ABC123/${name.startsWith("JOIN") ? "join" : "tickets"}`;
    expect((await post(bindings, path)).status).toBe(429);
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("fails closed and waits for all applicable bindings when a limiter throws", async () => {
    const { bindings, limits, idFromName } = fixture();
    limits.JOIN_BY_IP.limit.mockRejectedValue(
      new Error("platform unavailable"),
    );
    expect((await post(bindings, "/api/rooms/ABC123/join")).status).toBe(429);
    expect(limits.JOIN_BY_ROOM.limit).toHaveBeenCalledOnce();
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("leaves existing room state unchanged when a join or ticket is denied", async () => {
    const { bindings, limits, rooms } = fixture();
    const created = await request(bindings, "/api/rooms", {
      method: "POST",
      body: JSON.stringify({ displayName: "Host" }),
    });
    const seat = (await created.json()) as { code: string; seatToken: string };
    const room = rooms.get(rooms.idFromName(seat.code));
    const before = await room.getSnapshot();
    limits.JOIN_BY_ROOM.limit.mockResolvedValue({ success: false });
    limits.TICKET_BY_ROOM.limit.mockResolvedValue({ success: false });
    expect((await post(bindings, `/api/rooms/${seat.code}/join`)).status).toBe(
      429,
    );
    expect(
      (
        await request(bindings, `/api/rooms/${seat.code}/tickets`, {
          method: "POST",
          headers: { Authorization: `Bearer ${seat.seatToken}` },
        })
      ).status,
    ).toBe(429);
    expect(await room.getSnapshot()).toEqual(before);
  });
});
