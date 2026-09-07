import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ClientProjection } from "@cipher-party/protocol";
import { LobbyView } from "./LobbyView";

function makeLobbyProjection(
  overrides?: Partial<ClientProjection>
): ClientProjection {
  return {
    protocolVersion: 1,
    revision: 1,
    code: "K7M2X9",
    inviteUrl: "http://127.0.0.1:5173/room/K7M2X9",
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
        teamId: "red",
        role: "operative",
        connected: true
      },
      {
        playerId: "p-3",
        displayName: "Charlie",
        teamId: "blue",
        role: "clue-giver",
        connected: true
      },
      {
        playerId: "p-4",
        displayName: "Diana",
        teamId: "blue",
        role: "operative",
        connected: true
      },
      {
        playerId: "p-5",
        displayName: "Eve",
        teamId: null,
        role: "spectator",
        connected: false
      }
    ],
    publicHistory: [],
    board: null,
    ...overrides
  };
}

describe("LobbyView", () => {
  it("renders all connected and disconnected seats with their status", () => {
    const projection = makeLobbyProjection();
    render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    expect(screen.getByText("Host Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Diana")).toBeInTheDocument();
    expect(screen.getByText("Eve")).toBeInTheDocument();

    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("exposes red, blue, and spectator/unassigned team panels", () => {
    const projection = makeLobbyProjection();
    render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    expect(
      screen.getByRole("region", { name: /red team/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /blue team/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /spectators/i })
    ).toBeInTheDocument();
  });

  it("renders assignment, role, lock, and start controls only when host", () => {
    const onSendCommand = vi.fn();
    const projection = makeLobbyProjection();
    render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    expect(
      screen.getByRole("button", { name: /start game/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /lock room/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /randomize teams/i })
    ).toBeInTheDocument();
  });

  it("disables start with an explicit reason until each team has at least one clue-giver and operative", () => {
    const incompleteProjection = makeLobbyProjection({
      seats: [
        {
          playerId: "p-host",
          displayName: "Host Alice",
          teamId: "red",
          role: "clue-giver",
          connected: true
        },
        {
          playerId: "p-3",
          displayName: "Charlie",
          teamId: "blue",
          role: "clue-giver",
          connected: true
        }
      ]
    });

    render(
      <LobbyView
        projection={incompleteProjection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    const startButton = screen.getByRole("button", { name: /start game/i });
    expect(startButton).toBeDisabled();
    expect(
      screen.getByText(
        /each team must have at least one clue-giver and one operative/i
      )
    ).toBeInTheDocument();
  });

  it("shows role and team but no moderation or start controls for non-host player", () => {
    const nonHostProjection = makeLobbyProjection({
      viewer: {
        playerId: "p-2",
        teamId: "red",
        role: "operative",
        isHost: false
      },
      permissions: {
        configure: false,
        moderate: false,
        submitClue: false,
        challengeClue: false,
        nominate: false,
        confirmReveal: false,
        endTurn: false,
        resolveChallenge: false,
        pause: false,
        resume: false
      }
    });

    render(
      <LobbyView
        projection={nonHostProjection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    expect(
      screen.queryByRole("button", { name: /start game/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /lock room/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /randomize teams/i })
    ).not.toBeInTheDocument();
  });

  it("copies invite link using projection.inviteUrl with neutral origin and /room/CODE only", async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true
    });

    const projection = makeLobbyProjection();
    render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    const copyBtn = screen.getByRole("button", { name: /copy invite/i });
    await user.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/room/K7M2X9"
    );
    expect(projection.inviteUrl).toMatch(
      /^https?:\/\/[^/]+\/room\/[0-9A-Z]{6}$/
    );
  });

  it("announces reconnecting and offline statuses through a polite live region", () => {
    const projection = makeLobbyProjection();
    render(
      <LobbyView
        projection={projection}
        connectionState="reconnecting"
        onSendCommand={vi.fn()}
      />
    );

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveTextContent(/reconnecting/i);
  });

  it("randomize teams sends command only after host confirmation", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");

    // Case 1: Cancel confirmation
    confirmSpy.mockReturnValueOnce(false);
    const projection = makeLobbyProjection();
    const { rerender } = render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    await user.click(screen.getByRole("button", { name: /randomize teams/i }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onSendCommand).not.toHaveBeenCalled();

    // Case 2: Accept confirmation
    confirmSpy.mockReturnValueOnce(true);
    rerender(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    await user.click(screen.getByRole("button", { name: /randomize teams/i }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(onSendCommand).toHaveBeenCalledWith({
      type: "randomize_teams"
    });
  });

  it("lock room toggles between lock and unlock", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeLobbyProjection({ locked: false });

    const { rerender } = render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    await user.click(screen.getByRole("button", { name: /lock room/i }));
    expect(onSendCommand).toHaveBeenCalledWith({
      type: "lock_room",
      locked: true
    });

    rerender(
      <LobbyView
        projection={{ ...projection, locked: true }}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    expect(screen.getByText(/room is locked/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /unlock room/i }));
    expect(onSendCommand).toHaveBeenCalledWith({
      type: "lock_room",
      locked: false
    });
  });

  it("start game sends start_board command when ready", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeLobbyProjection();

    render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    await user.click(screen.getByRole("button", { name: /start game/i }));
    expect(onSendCommand).toHaveBeenCalledWith({
      type: "start_board"
    });
  });

  it("assigns seat to another team when move button is clicked", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeLobbyProjection();

    render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const moveBobToBlue = screen.getByRole("button", {
      name: /move bob to blue/i
    });
    await user.click(moveBobToBlue);

    expect(onSendCommand).toHaveBeenCalledWith({
      type: "assign_seat",
      playerId: "p-2",
      teamId: "blue"
    });
  });

  it("assigns role when role select is changed", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeLobbyProjection();

    render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const bobRoleSelect = screen.getByRole("combobox", {
      name: /role for bob/i
    });
    await user.selectOptions(bobRoleSelect, "clue-giver");

    expect(onSendCommand).toHaveBeenCalledWith({
      type: "set_role",
      playerId: "p-2",
      role: "clue-giver"
    });
  });

  it("disables all interactive controls while command is pending", () => {
    const projection = makeLobbyProjection();

    render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
        isCommandPending={true}
      />
    );

    expect(screen.getByRole("button", { name: /start game/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /lock room/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /randomize teams/i })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /move bob to blue/i })
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: /role for bob/i })
    ).toBeDisabled();
  });

  it("satisfies colorblind accessibility with semantic and text labels", () => {
    const projection = makeLobbyProjection();

    render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    // Color-independent labels
    expect(screen.getByText(/red team \(ruby\)/i)).toBeInTheDocument();
    expect(screen.getByText(/blue team \(cobalt\)/i)).toBeInTheDocument();
    expect(screen.getByText(/spectators & unassigned/i)).toBeInTheDocument();
  });

  it("public lobby DOM never contains durable seat or host tokens", () => {
    const projection = makeLobbyProjection();

    const { container } = render(
      <LobbyView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    const html = container.innerHTML;
    expect(html).not.toContain("seatToken");
    expect(html).not.toContain("hostToken");
    expect(html).not.toContain("seat-token");
    expect(html).not.toContain("host-token");
  });
});
