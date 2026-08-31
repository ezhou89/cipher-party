import type {
  ClientCommand,
  ClientProjection,
  CommandResult,
} from "@cipher-party/protocol";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { createAppRoutes } from "../../app/router";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import type {
  RoomConnectionSnapshot,
  RoomConnectionState,
} from "../../lib/room-socket";
import type { SeatCredentials, SeatStore } from "../../lib/seat-store";
import globalCss from "../../styles/globals.css?raw";
import tokenCss from "../../styles/tokens.css?raw";
import { LobbyView } from "./LobbyView";

const NO_PERMISSIONS = {
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
};

const HOST_PERMISSIONS = {
  ...NO_PERMISSIONS,
  configure: true,
  moderate: true,
};

const lobbySeats: ClientProjection["seats"] = [
  {
    playerId: "host",
    displayName: "Mina",
    teamId: "red",
    role: "clue-giver",
    connected: true,
  },
  {
    playerId: "red-op",
    displayName: "Rin",
    teamId: "red",
    role: "operative",
    connected: true,
  },
  {
    playerId: "blue-clue",
    displayName: "Aki",
    teamId: "blue",
    role: "clue-giver",
    connected: true,
  },
  {
    playerId: "blue-op",
    displayName: "Kai",
    teamId: "blue",
    role: "operative",
    connected: false,
  },
  {
    playerId: "waiting",
    displayName: "Noa",
    teamId: null,
    role: "unassigned",
    connected: true,
  },
  {
    playerId: "spectator",
    displayName: "Jules",
    teamId: null,
    role: "spectator",
    connected: false,
  },
];

function hostProjection(
  overrides: Partial<ClientProjection> = {},
): ClientProjection {
  return {
    protocolVersion: 1,
    revision: 7,
    code: "ABC123",
    inviteUrl: "https://play.example/room/ABC123",
    roomPhase: "lobby",
    locked: false,
    viewRole: "clue-giver",
    viewer: {
      playerId: "host",
      teamId: "red",
      role: "clue-giver",
      isHost: true,
    },
    permissions: HOST_PERMISSIONS,
    seats: lobbySeats,
    publicHistory: [],
    board: null,
    key: {},
    ...overrides,
  } as ClientProjection;
}

function readyProjection(): ClientProjection {
  return hostProjection({
    seats: lobbySeats
      .filter((seat) => seat.playerId !== "waiting")
      .map((seat) =>
        seat.playerId === "blue-op" ? { ...seat, connected: true } : seat,
      ),
  });
}

function renderLobby(
  projection = hostProjection(),
  options: {
    connection?: RoomConnectionState;
    pending?: boolean;
    send?: (command: ClientCommand) => void;
  } = {},
) {
  const send = options.send ?? vi.fn();
  render(
    <LobbyView
      projection={projection}
      connection={options.connection ?? "open"}
      pending={options.pending ?? false}
      send={send}
    />,
  );
  return { send };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeRoomSocket {
  readonly connect = vi.fn(async () => {});
  readonly send = vi.fn(() => "command-id");
  readonly close = vi.fn();
  readonly unsubscribe = vi.fn();
  #listener: ((snapshot: RoomConnectionSnapshot) => void) | null = null;

  constructor(private readonly snapshot: RoomConnectionSnapshot) {}

  subscribe(listener: (snapshot: RoomConnectionSnapshot) => void) {
    this.#listener = listener;
    listener(this.snapshot);
    return this.unsubscribe;
  }

  emit(snapshot: RoomConnectionSnapshot) {
    this.#listener?.(snapshot);
  }
}

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const style = document.createElement("style");
style.textContent = `${tokenCss}\n${globalCss}`;
document.head.append(style);

function mediaCssRule(condition: string, selector: string): CSSStyleRule {
  const media = Array.from(style.sheet?.cssRules ?? []).find(
    (candidate): candidate is CSSMediaRule =>
      "conditionText" in candidate && candidate.conditionText === condition,
  );
  const rule = Array.from(media?.cssRules ?? []).find(
    (candidate): candidate is CSSStyleRule =>
      "selectorText" in candidate && candidate.selectorText === selector,
  );
  if (rule === undefined) {
    throw new Error(`CSS rule ${selector} in ${condition} was not parsed`);
  }
  return rule;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalClipboardDescriptor === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  }
});

describe("LobbyView authoritative projection", () => {
  it("groups every seat under symbol-and-label team regions with text status", () => {
    renderLobby();

    const red = screen.getByRole("region", { name: "◆ Red team" });
    const blue = screen.getByRole("region", { name: "● Blue team" });
    const waiting = screen.getByRole("region", {
      name: "◇ Waiting & spectators",
    });
    expect(within(red).getByText("Mina")).toBeVisible();
    expect(within(red).getByText("Clue-giver")).toBeVisible();
    expect(within(red).getAllByText("Online")).not.toHaveLength(0);
    expect(within(blue).getByText("Kai")).toBeVisible();
    expect(within(blue).getByText("Offline")).toBeVisible();
    expect(within(waiting).getByText("Noa")).toBeVisible();
    expect(within(waiting).getByText("Jules")).toBeVisible();
    expect(within(waiting).getByText("Spectator")).toBeVisible();
  });

  it("shows host assignment, role, randomize, lock, and start controls only from permissions", () => {
    const { rerender } = render(
      <LobbyView
        projection={hostProjection()}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );

    expect(screen.getByRole("group", { name: "Host controls" })).toBeVisible();
    expect(screen.getByLabelText("Team for Mina")).toBeVisible();
    expect(screen.getByLabelText("Role for Rin")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Randomize teams" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Lock room" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Start board" })).toBeVisible();

    const guest = hostProjection({
      viewRole: "clue-giver",
      viewer: {
        playerId: "blue-clue",
        teamId: "blue",
        role: "clue-giver",
        isHost: false,
      },
      permissions: NO_PERMISSIONS,
      key: {},
    });
    rerender(
      <LobbyView
        projection={guest}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );

    expect(screen.getByText("You are Blue · Clue-giver")).toBeVisible();
    expect(
      screen.queryByRole("group", { name: "Host controls" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Team for Mina")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start board" }),
    ).not.toBeInTheDocument();
  });

  it("emits exact assignment, role, and lock commands without moving projected seats", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    renderLobby(hostProjection(), { send });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Team for Mina"), "blue");
    expect(send).toHaveBeenLastCalledWith({
      type: "assign_seat",
      playerId: "host",
      teamId: "blue",
    });
    expect(
      within(screen.getByRole("region", { name: "◆ Red team" })).getByText(
        "Mina",
      ),
    ).toBeVisible();

    await user.selectOptions(
      screen.getByLabelText("Role for Rin"),
      "clue-giver",
    );
    expect(send).toHaveBeenLastCalledWith({
      type: "set_role",
      playerId: "red-op",
      role: "clue-giver",
    });
    expect(
      within(screen.getByRole("region", { name: "◆ Red team" })).getByText(
        "Operative",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Lock room" }));
    expect(send).toHaveBeenLastCalledWith({
      type: "lock_room",
      locked: true,
    });
  });

  it("disables every authoritative control while one command is pending", () => {
    renderLobby(hostProjection(), { pending: true });
    const controls = screen.getByRole("group", { name: "Host controls" });

    const authoritativeControls = [
      ...within(controls).getAllByRole("button"),
      ...within(controls).getAllByRole("combobox"),
    ];
    for (const control of authoritativeControls) {
      expect(control).toBeDisabled();
    }
  });

  it("keeps authoritative controls unavailable while the room reconnects", () => {
    renderLobby(hostProjection(), { connection: "reconnecting" });
    const controls = screen.getByRole("group", { name: "Host controls" });
    const authoritativeControls = [
      ...within(controls).getAllByRole("button"),
      ...within(controls).getAllByRole("combobox"),
    ];

    for (const control of authoritativeControls) {
      expect(control).toBeDisabled();
    }
  });

  it("requires in-page confirmation and sends randomize exactly once", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    renderLobby(hostProjection(), { send });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Randomize teams" }));
    expect(send).not.toHaveBeenCalled();
    expect(
      screen.getByRole("group", { name: "Confirm random team assignment" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Confirm randomize teams" }),
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: "randomize_teams" });
    expect(
      screen.queryByRole("button", { name: "Confirm randomize teams" }),
    ).not.toBeInTheDocument();
  });

  it("associates a precise start reason and emits start only from a ready projection", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const { rerender } = render(
      <LobbyView
        projection={hostProjection()}
        connection="open"
        pending={false}
        send={send}
      />,
    );
    const blocked = screen.getByRole("button", { name: "Start board" });
    expect(blocked).toBeDisabled();
    const reasonId = blocked.getAttribute("aria-describedby");
    expect(reasonId).not.toBeNull();
    expect(document.getElementById(reasonId!)).toHaveTextContent(
      "Every active seat must be online and fully assigned.",
    );

    rerender(
      <LobbyView
        projection={readyProjection()}
        connection="open"
        pending={false}
        send={send}
      />,
    );
    const ready = screen.getByRole("button", { name: "Start board" });
    expect(ready).toBeEnabled();
    expect(
      document.getElementById(ready.getAttribute("aria-describedby")!),
    ).toHaveTextContent(
      "Ready: each team has one clue-giver and at least one operative.",
    );
    await userEvent.setup().click(ready);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: "start_board" });
  });

  it("copies only the projection invite URL and gives accessible confirmation", async () => {
    renderLobby();
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();

    await user.click(screen.getByRole("button", { name: "Copy invite link" }));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("https://play.example/room/ABC123");
    expect(
      within(
        screen.getByRole("region", { name: "Bring your crew to the table" }),
      ).getByRole("status"),
    ).toHaveTextContent("Invite copied");
    expect(screen.getByText("https://play.example/room/ABC123")).toBeVisible();
  });

  it("announces clipboard failure without changing the projected invite", async () => {
    renderLobby();
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("clipboard unavailable"),
    );

    await user.click(screen.getByRole("button", { name: "Copy invite link" }));

    expect(
      within(
        screen.getByRole("region", { name: "Bring your crew to the table" }),
      ).getByRole("status"),
    ).toHaveTextContent("Copy failed. Select the invite link instead.");
    expect(screen.getByText("https://play.example/room/ABC123")).toBeVisible();
  });

  it("keeps private credential material out of the public lobby DOM", () => {
    renderLobby();

    expect(document.body.textContent).not.toContain("durable-seat-token");
    expect(document.body.textContent).not.toContain("durable-host-token");
    expect(document.body.innerHTML).not.toMatch(/seatToken|hostToken|key/iu);
  });

  it("uses actual narrow-layout CSS guards and 44px controls at 320px", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });
    renderLobby();

    const shell = screen.getByRole("main");
    expect(shell).toHaveClass("app-shell");
    expect(getComputedStyle(document.documentElement).overflowX).toBe("hidden");
    expect(getComputedStyle(document.body).overflowX).toBe("hidden");
    expect(getComputedStyle(shell).minWidth).toMatch(/^0(?:px)?$/u);
    expect(
      Number.parseFloat(
        getComputedStyle(
          screen.getByRole("button", { name: "Copy invite link" }),
        ).minHeight,
      ),
    ).toBeGreaterThanOrEqual(44);
    expect(
      mediaCssRule("(max-width: 22rem)", ".app-shell").style.paddingInline,
    ).toBe("0.75rem");
  });
});

describe("ConnectionBadge", () => {
  it("announces each stable connection state through one polite live region", () => {
    const { rerender } = render(<ConnectionBadge connection="idle" />);
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveTextContent("Connection idle");

    for (const [connection, label] of [
      ["connecting", "Connecting to room"],
      ["open", "Connected"],
      ["reconnecting", "Reconnecting to room"],
      ["closed", "Connection closed"],
    ] as const) {
      rerender(<ConnectionBadge connection={connection} />);
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(liveRegion).toHaveTextContent(label);
    }
  });
});

describe("RoomPage invite and socket lifecycle", () => {
  it("joins an invite explicitly as spectator, stores first, then uses the canonical route", async () => {
    const write = deferred<void>();
    const persisted: SeatCredentials[] = [];
    const store: SeatStore = {
      get: async () => undefined,
      put: async (credentials) => {
        persisted.push(credentials);
        await write.promise;
      },
      delete: async () => {},
    };
    const socket = new FakeRoomSocket({
      connection: "idle",
      projection: null,
      lastResult: null,
    });
    const createRoomSocket = vi.fn(() => socket);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        code: "ABC123",
        playerId: "spectator-player",
        seatToken: "spectator-seat-token".padEnd(43, "x"),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const router = createMemoryRouter(
      createAppRoutes({ seatStore: store, createRoomSocket }),
      { initialEntries: ["/room/abc123"] },
    );
    render(<App router={router} />);
    const user = userEvent.setup();

    expect(createRoomSocket).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("form", { name: "Join room ABC123" }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Display name"), "  Jules  ");
    await user.click(screen.getByLabelText("Join as spectator"));
    await user.click(screen.getByRole("button", { name: "Join this room" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms/ABC123/join", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Jules", asSpectator: true }),
    });
    expect(persisted).toEqual([
      {
        code: "ABC123",
        playerId: "spectator-player",
        seatToken: "spectator-seat-token".padEnd(43, "x"),
      },
    ]);
    expect(router.state.location.pathname).toBe("/room/abc123");

    write.resolve();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/room/ABC123"),
    );
    await waitFor(() => expect(createRoomSocket).toHaveBeenCalledOnce());
    expect(socket.connect).toHaveBeenCalledWith(persisted[0]);
  });

  it("keeps an invite join API error visible and focuses its summary", async () => {
    const store: SeatStore = {
      get: async () => undefined,
      put: async () => {},
      delete: async () => {},
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: "room_locked", message: "Room is locked" } },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const router = createMemoryRouter(createAppRoutes({ seatStore: store }), {
      initialEntries: ["/room/ABC123"],
    });
    render(<App router={router} />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Display name"), "Guest");
    await user.click(screen.getByRole("button", { name: "Join this room" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Room is locked");
    expect(alert).toHaveFocus();
  });

  it("creates one socket after valid credentials and closes every subscription on cleanup", async () => {
    const credentials: SeatCredentials = {
      code: "ABC123",
      playerId: "host",
      seatToken: "durable-seat-token".padEnd(43, "x"),
      hostToken: "durable-host-token".padEnd(43, "x"),
    };
    const store: SeatStore = {
      get: vi.fn(async () => credentials),
      put: async () => {},
      delete: async () => {},
    };
    const socket = new FakeRoomSocket({
      connection: "open",
      projection: hostProjection(),
      lastResult: null,
    });
    const createRoomSocket = vi.fn(() => socket);
    const router = createMemoryRouter(
      createAppRoutes({ seatStore: store, createRoomSocket }),
      { initialEntries: ["/room/ABC123"] },
    );

    const view = render(<App router={router} />);

    await waitFor(() => expect(createRoomSocket).toHaveBeenCalledOnce());
    expect(createRoomSocket).toHaveBeenCalledOnce();
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(socket.connect).toHaveBeenCalledWith(credentials);
    view.unmount();
    expect(socket.unsubscribe).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("lets a player discard malformed stored credentials and rejoin without opening a socket", async () => {
    const deleteCredential = vi.fn(async () => {});
    const store: SeatStore = {
      get: async () => ({
        code: "ABC123",
        playerId: "host",
        seatToken: "not-a-real-token",
      }),
      put: async () => {},
      delete: deleteCredential,
    };
    const createRoomSocket = vi.fn(
      () =>
        new FakeRoomSocket({
          connection: "idle",
          projection: null,
          lastResult: null,
        }),
    );
    const router = createMemoryRouter(
      createAppRoutes({ seatStore: store, createRoomSocket }),
      { initialEntries: ["/room/ABC123"] },
    );
    render(<App router={router} />);
    const user = userEvent.setup();

    expect(
      await screen.findByRole("heading", {
        name: "Saved seat needs attention",
      }),
    ).toBeVisible();
    expect(document.body.textContent).not.toContain("not-a-real-token");
    await user.click(
      screen.getByRole("button", { name: "Forget saved seat and rejoin" }),
    );

    expect(deleteCredential).toHaveBeenCalledWith("ABC123");
    expect(
      await screen.findByRole("form", { name: "Join room ABC123" }),
    ).toBeVisible();
    expect(createRoomSocket).not.toHaveBeenCalled();
  });

  it("keeps controls pending through result-first delivery until the fresh projection", async () => {
    const credentials: SeatCredentials = {
      code: "ABC123",
      playerId: "host",
      seatToken: "durable-seat-token".padEnd(43, "x"),
      hostToken: "durable-host-token".padEnd(43, "x"),
    };
    const store: SeatStore = {
      get: async () => credentials,
      put: async () => {},
      delete: async () => {},
    };
    const socket = new FakeRoomSocket({
      connection: "open",
      projection: hostProjection(),
      lastResult: null,
    });
    const router = createMemoryRouter(
      createAppRoutes({ seatStore: store, createRoomSocket: () => socket }),
      { initialEntries: ["/room/ABC123"] },
    );
    render(<App router={router} />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Lock room" });

    await user.click(screen.getByRole("button", { name: "Lock room" }));
    expect(screen.getByRole("button", { name: "Lock room" })).toBeDisabled();
    const accepted: CommandResult = { ok: true, revision: 8 };
    socket.emit({
      connection: "open",
      projection: hostProjection(),
      lastResult: accepted,
    });
    expect(screen.getByRole("button", { name: "Lock room" })).toBeDisabled();

    socket.emit({
      connection: "open",
      projection: hostProjection({ revision: 8, locked: true }),
      lastResult: accepted,
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unlock room" })).toBeEnabled(),
    );
  });
});
