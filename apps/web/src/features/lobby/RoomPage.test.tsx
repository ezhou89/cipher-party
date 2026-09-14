import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { ClientProjection, ServerMessage } from "@cipher-party/protocol";
import { createSeatStore } from "../../lib/seat-store";
import { RoomPage } from "./RoomPage";

type MockListener = (event: Event | MessageEvent | CloseEvent) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  private listeners: Record<string, MockListener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.dispatchEvent("open", new Event("open"));
    }, 0);
  }

  addEventListener(type: string, listener: MockListener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: MockListener) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(type: string, event: Event | MessageEvent | CloseEvent) {
    const list = this.listeners[type] || [];
    for (const listener of list) {
      listener(event);
    }
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.dispatchEvent("close", new CloseEvent("close", { code, reason }));
  }

  simulateServerMessage(msg: ServerMessage) {
    this.dispatchEvent(
      "message",
      new MessageEvent("message", { data: JSON.stringify(msg) })
    );
  }
}

function sampleLobbyProjection(code: string): ClientProjection {
  return {
    protocolVersion: 1,
    revision: 1,
    code,
    inviteUrl: `http://127.0.0.1:5173/room/${code}`,
    roomPhase: "lobby",
    locked: false,
    viewRole: "clue-giver",
    key: {},
    viewer: {
      playerId: "p-host",
      teamId: "red",
      role: "clue-giver",
      isHost: true
    },
    permissions: {
      configure: true,
      moderate: true,
      submitClue: false,
      challengeClue: false,
      nominate: false,
      confirmReveal: false,
      endTurn: false,
      resolveChallenge: false,
      pause: false,
      resume: false
    },
    seats: [
      {
        playerId: "p-host",
        displayName: "Host Alice",
        teamId: "red",
        role: "clue-giver",
        connected: true
      },
      {
        playerId: "p-2",
        displayName: "Bob",
        teamId: "blue",
        role: "clue-giver",
        connected: true
      }
    ],
    publicHistory: [],
    board: null
  };
}

describe("RoomPage", () => {
  const seatStore = createSeatStore();

  beforeEach(() => {
    vi.restoreAllMocks();
    MockWebSocket.instances = [];
    indexedDB = new IDBFactory();
  });

  function renderRoomPage(code = "K7M2X9") {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/tickets")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ticket: "ticket-1",
            expiresAt: Date.now() + 60_000
          })
        });
      }
      if (url.includes("/join")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            code,
            playerId: "p-joined",
            seatToken: "seat-token-joined"
          })
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const router = createMemoryRouter(
      [
        {
          path: "/room/:code",
          element: (
            <RoomPage
              seatStore={seatStore}
              roomOptions={{
                fetchFn: fetchMock,
                wsFactory: (url) =>
                  new MockWebSocket(url) as unknown as WebSocket
              }}
            />
          )
        }
      ],
      { initialEntries: [`/room/${code}`] }
    );

    return { ...render(<RouterProvider router={router} />), fetchMock };
  }

  it("keeps /room/CODE as a browser join fallback when no native app opens it", async () => {
    renderRoomPage("ABC234");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /join room abc234/i })
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /^join room$/i })
    ).toBeInTheDocument();
  });

  it("submitting in-page join form connects to room and shows lobby", async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderRoomPage("ABC234");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /join room abc234/i })
      ).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/your name/i);
    await user.type(nameInput, "New Player");

    await user.click(screen.getByRole("button", { name: /^join room$/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/ABC234/join",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ displayName: "New Player", asSpectator: false })
      })
    );

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1);
    });

    const ws = MockWebSocket.instances[0]!;
    ws.simulateServerMessage({
      type: "projection",
      projection: sampleLobbyProjection("ABC234")
    });

    await waitFor(() => {
      expect(screen.getByText("Host Alice")).toBeInTheDocument();
    });
  });

  it("automatically connects and renders lobby when stored credentials exist", async () => {
    await seatStore.put({
      code: "K7M2X9",
      playerId: "p-host",
      seatToken: "stored-seat-token",
      hostToken: "stored-host-token"
    });

    renderRoomPage("K7M2X9");

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1);
    });

    const ws = MockWebSocket.instances[0]!;
    ws.simulateServerMessage({
      type: "projection",
      projection: sampleLobbyProjection("K7M2X9")
    });

    await waitFor(() => {
      expect(screen.getByText("Host Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });
  });

  it("renders game board when projection phase is playing", async () => {
    await seatStore.put({
      code: "K7M2X9",
      playerId: "p-host",
      seatToken: "stored-seat-token",
      hostToken: "stored-host-token"
    });

    renderRoomPage("K7M2X9");

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1);
    });

    const ws = MockWebSocket.instances[0]!;
    const lobby = sampleLobbyProjection("K7M2X9");
    const cards = Array.from({ length: 25 }, (_, i) => ({
      id: `card-${i}`,
      label: `WORD ${i}`,
      revealed: false
    }));

    ws.simulateServerMessage({
      type: "projection",
      projection: {
        ...lobby,
        roomPhase: "playing",
        board: {
          order: cards.map((c) => c.id),
          cards,
          activeTeam: "red",
          phase: "clue",
          clue: null,
          guessesRemaining: 0,
          nomination: null,
          winner: null,
          completionReason: null
        }
      }
    });

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: /game board/i })
      ).toBeInTheDocument();
      expect(screen.getByText("WORD 0")).toBeInTheDocument();
    });
  });
});
