import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { createAppRoutes } from "../../app/router";
import type { SeatCredentials, SeatStore } from "../../lib/seat-store";

const HOST_RESPONSE = {
  code: "ABC123",
  inviteUrl: "https://play.example/room/ABC123",
  playerId: "host-player",
  seatToken: "host-seat-token".padEnd(43, "x"),
  hostToken: "host-authority-token".padEnd(43, "x"),
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function seatStore(
  put: (credentials: SeatCredentials) => Promise<void> = async () => {},
): SeatStore {
  return {
    get: async () => undefined,
    put,
    delete: async () => {},
  };
}

function renderApp(store: SeatStore = seatStore()) {
  const router = createMemoryRouter(createAppRoutes({ seatStore: store }), {
    initialEntries: ["/"],
  });
  render(<App router={router} />);
  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HomePage", () => {
  it("offers distinct create and join forms without future-mode controls", () => {
    renderApp();

    expect(screen.getByRole("form", { name: "Create Room" })).toBeVisible();
    expect(screen.getByRole("form", { name: "Join Room" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create Room" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Join Room" })).toBeEnabled();
    expect(
      screen.queryByRole("button", {
        name: /pack|image|ai|blitz|campaign|matchmaking/iu,
      }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /pack builder|image upload|AI assist|Blitz|campaign|public matchmaking/iu,
    );
  });

  it("posts the trimmed host name, persists both tokens, then navigates", async () => {
    const write = deferred<void>();
    const persisted: SeatCredentials[] = [];
    const store = seatStore(async (credentials) => {
      persisted.push(credentials);
      await write.promise;
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(HOST_RESPONSE, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    const router = renderApp(store);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your display name"), "  Mina  ");
    await user.click(screen.getByRole("button", { name: "Create Room" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Mina" }),
    });
    expect(persisted).toEqual([
      {
        code: "ABC123",
        playerId: "host-player",
        seatToken: "host-seat-token".padEnd(43, "x"),
        hostToken: "host-authority-token".padEnd(43, "x"),
      },
    ]);
    expect(router.state.location.pathname).toBe("/");
    expect(
      screen.getByRole("button", { name: "Creating room…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Join Room" })).toBeDisabled();

    write.resolve();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/room/ABC123"),
    );
  });

  it("normalizes lowercase Crockford aliases, stores the seat, and uses the server code", async () => {
    const persisted: SeatCredentials[] = [];
    const store = seatStore(async (credentials) => {
      persisted.push(credentials);
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        code: "01ABCD",
        playerId: "guest-player",
        seatToken: "guest-seat-token".padEnd(43, "x"),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const router = renderApp(store);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Room code"), "  olabcd  ");
    await user.type(screen.getByLabelText("Join display name"), "  Kenji  ");
    await user.click(screen.getByRole("button", { name: "Join Room" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/room/01ABCD"),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms/01ABCD/join", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Kenji", asSpectator: false }),
    });
    expect(persisted).toEqual([
      {
        code: "01ABCD",
        playerId: "guest-player",
        seatToken: "guest-seat-token".padEnd(43, "x"),
      },
    ]);
  });

  it("submits the create form from the keyboard", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(HOST_RESPONSE, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your display name"), "Mina{Enter}");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it("rejects Unicode room-code expansion before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Room code"), "ßabcde");
    await user.type(screen.getByLabelText("Join display name"), "Guest");
    await user.click(screen.getByRole("button", { name: "Join Room" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/six ASCII letters or numbers/iu);
    expect(alert).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an API error visible and focuses the public summary", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: { code: "room_locked", message: "Room is locked" },
        },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Room code"), "ABC123");
    await user.type(screen.getByLabelText("Join display name"), "Guest");
    await user.click(screen.getByRole("button", { name: "Join Room" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Room is locked");
    expect(alert).toHaveFocus();
    expect(alert.textContent).not.toContain("token");
  });

  it("treats malformed token-bearing success data as a public API failure", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ...HOST_RESPONSE, privateKey: "must-not-render" }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    const router = renderApp();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your display name"), "Mina");
    await user.click(screen.getByRole("button", { name: "Create Room" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unexpected response/iu);
    expect(alert).toHaveFocus();
    expect(document.body.textContent).not.toContain("must-not-render");
    expect(router.state.location.pathname).toBe("/");
  });

  it("does not treat inherited object names as trusted public error codes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: {
            code: "toString",
            message: "durable-seat-token-must-not-be-reflected",
          },
        },
        400,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Room code"), "ABC123");
    await user.type(screen.getByLabelText("Join display name"), "Guest");
    await user.click(screen.getByRole("button", { name: "Join Room" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unexpected response/iu);
    expect(alert.textContent).not.toContain("durable-seat-token");
  });
});
