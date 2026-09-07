import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { createSeatStore } from "../../lib/seat-store";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  const seatStore = createSeatStore();

  beforeEach(() => {
    vi.restoreAllMocks();
    indexedDB = new IDBFactory(); // Reset fake IndexedDB between tests
  });

  function renderHomePage() {
    const router = createMemoryRouter(
      [
        { path: "/", element: <HomePage seatStore={seatStore} /> },
        {
          path: "/room/:code",
          element: <div data-testid="room-page">Room View</div>
        }
      ],
      { initialEntries: ["/"] }
    );
    return { ...render(<RouterProvider router={router} />), router };
  }

  it("renders Create Room and Join Room forms with accessible names", () => {
    renderHomePage();

    expect(
      screen.getByRole("heading", { name: /create room/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^create room$/i })
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: /join room/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^join room$/i })
    ).toBeInTheDocument();
  });

  it("submitting a trimmed display name calls POST /api/rooms", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "K7M2X9",
        inviteUrl: "http://127.0.0.1:5173/room/K7M2X9",
        playerId: "p-host",
        seatToken: "seat-token-123",
        hostToken: "host-token-456"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHomePage();

    const nameInput = screen.getByLabelText(/your name/i, {
      selector: "#create-name"
    });
    await user.type(nameInput, "  Agent Alice  ");

    const createButton = screen.getByRole("button", { name: /^create room$/i });
    await user.click(createButton);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ displayName: "Agent Alice" })
      })
    );
  });

  it("successful creation stores both tokens and navigates to /room/CODE", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "K7M2X9",
        inviteUrl: "http://127.0.0.1:5173/room/K7M2X9",
        playerId: "p-host",
        seatToken: "seat-token-123",
        hostToken: "host-token-456"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHomePage();

    const nameInput = screen.getByLabelText(/your name/i, {
      selector: "#create-name"
    });
    await user.type(nameInput, "Host Player");

    await user.click(screen.getByRole("button", { name: /^create room$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("room-page")).toBeInTheDocument();
    });

    const stored = await seatStore.get("K7M2X9");
    expect(stored).toEqual({
      code: "K7M2X9",
      playerId: "p-host",
      seatToken: "seat-token-123",
      hostToken: "host-token-456"
    });
  });

  it("joining by code normalizes lowercase and whitespace and navigates", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "K7M2X9",
        playerId: "p-guest",
        seatToken: "seat-token-guest"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHomePage();

    const codeInput = screen.getByLabelText(/room code/i);
    const nameInput = screen.getByLabelText(/your name/i, {
      selector: "#join-name"
    });

    await user.type(codeInput, "  k7m-2x9  ");
    await user.type(nameInput, "  Guest Bob  ");

    await user.click(screen.getByRole("button", { name: /^join room$/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/K7M2X9/join",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ displayName: "Guest Bob", asSpectator: false })
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("room-page")).toBeInTheDocument();
    });

    const stored = await seatStore.get("K7M2X9");
    expect(stored).toEqual({
      code: "K7M2X9",
      playerId: "p-guest",
      seatToken: "seat-token-guest"
    });
  });

  it("API errors remain visible and focus the error summary", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: "invalid_name",
          message: "Display name has control characters"
        }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHomePage();

    const nameInput = screen.getByLabelText(/your name/i, {
      selector: "#create-name"
    });
    await user.type(nameInput, "Bad Name");

    await user.click(screen.getByRole("button", { name: /^create room$/i }));

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent("Display name has control characters");
    expect(document.activeElement).toBe(errorAlert);
  });

  it("contains no pack builder, image, AI, Blitz, campaign, or public matchmaking controls", () => {
    renderHomePage();

    const text = document.body.textContent?.toLowerCase() ?? "";
    expect(text).not.toContain("pack builder");
    expect(text).not.toContain("upload image");
    expect(text).not.toContain("ai clue");
    expect(text).not.toContain("blitz");
    expect(text).not.toContain("campaign");
    expect(text).not.toContain("matchmaking");
    expect(text).not.toContain("find match");
  });
});
