import type {
  ClientCommand,
  ClientProjection,
  CommandResult,
  PublicHistoryEntry,
} from "@cipher-party/protocol";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { startTransition, Suspense, useState } from "react";
import { createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { createAppRoutes } from "../../app/router";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type {
  RoomConnectionSnapshot,
  RoomConnectionState,
} from "../../lib/room-socket";
import type { SeatCredentials, SeatStore } from "../../lib/seat-store";
import globalCss from "../../styles/globals.css?raw";
import tokenCss from "../../styles/tokens.css?raw";
import { GameView } from "./GameView";
import { deriveGameAvailability } from "./game-availability";
import { useGameConfirmation } from "./useGameConfirmation";

const NO_PERMISSIONS: ClientProjection["permissions"] = {
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

type TeamId = ClientProjection["configuredTeams"][number];
type TeamCount = ClientProjection["teamCount"];

const cardIds = Array.from(
  { length: 25 },
  (_, index) => `card-${String(index + 1).padStart(2, "0")}`,
);

const publicCards: NonNullable<ClientProjection["board"]>["cards"] =
  cardIds.map((id, index) => ({
    id,
    label: `Archive ${String(index + 1).padStart(2, "0")}`,
    revealed: false,
  }));

const key = Object.fromEntries(
  cardIds.map((id, index) => [
    id,
    index < 9 ? "red" : index < 17 ? "blue" : index < 24 ? "neutral" : "hazard",
  ]),
) as Extract<ClientProjection, { viewRole: "clue-giver" }>["key"];

const seats: ClientProjection["seats"] = [
  {
    playerId: "red-clue",
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
    connected: true,
  },
  {
    playerId: "spectator",
    displayName: "Jules",
    teamId: null,
    role: "spectator",
    connected: true,
  },
];

const fourTeamIds = Array.from(
  { length: 36 },
  (_, index) => `multi-${String(index + 1).padStart(2, "0")}`,
);

const fourTeamCards: NonNullable<ClientProjection["board"]>["cards"] =
  fourTeamIds.map((id, index) => ({
    id,
    label: `Signal ${String(index + 1).padStart(2, "0")}`,
    revealed: false,
  }));

const fourTeamSeats: ClientProjection["seats"] = [
  ...seats.filter((seat) => seat.role !== "spectator"),
  {
    playerId: "green-clue",
    displayName: "Gia",
    teamId: "green",
    role: "clue-giver",
    connected: true,
  },
  {
    playerId: "green-op",
    displayName: "Nia",
    teamId: "green",
    role: "operative",
    connected: true,
  },
  {
    playerId: "yellow-clue",
    displayName: "Yara",
    teamId: "yellow",
    role: "clue-giver",
    connected: true,
  },
  {
    playerId: "yellow-op",
    displayName: "Omar",
    teamId: "yellow",
    role: "operative",
    connected: true,
  },
];

function fourTeamProjection(options: ProjectionOptions = {}): ClientProjection {
  return projection({
    teamCount: 4,
    configuredTeams: ["red", "blue", "green", "yellow"],
    seats: fourTeamSeats,
    cards: fourTeamCards.map((card) => ({ ...card })),
    ...options,
    board: {
      teamCount: 4,
      rows: 6,
      columns: 6,
      configuredTeams: ["red", "blue", "green", "yellow"],
      eliminatedTeams: [],
      teamSummaries: [
        { teamId: "red", revealedTargets: 0, eliminated: false },
        { teamId: "blue", revealedTargets: 0, eliminated: false },
        { teamId: "green", revealedTargets: 0, eliminated: false },
        { teamId: "yellow", revealedTargets: 0, eliminated: false },
      ],
      order: [...fourTeamIds],
      activeTeam: "yellow",
      ...options.board,
    },
  });
}

interface ProjectionOptions {
  role?: ClientProjection["viewRole"];
  teamId?: TeamId | null;
  playerId?: string;
  isHost?: boolean;
  permissions?: Partial<ClientProjection["permissions"]>;
  teamCount?: TeamCount;
  configuredTeams?: TeamId[];
  seats?: ClientProjection["seats"];
  board?: Partial<NonNullable<ClientProjection["board"]>>;
  cards?: NonNullable<ClientProjection["board"]>["cards"];
  key?: Extract<ClientProjection, { viewRole: "clue-giver" }>["key"];
  publicHistory?: PublicHistoryEntry[];
  roomPhase?: ClientProjection["roomPhase"];
  revision?: number;
  code?: string;
}

function projection(options: ProjectionOptions = {}): ClientProjection {
  const role = options.role ?? "spectator";
  const teamCount = options.teamCount ?? options.board?.teamCount ?? 2;
  const configuredTeams =
    options.configuredTeams ??
    options.board?.configuredTeams ??
    (["red", "blue", "green", "yellow"].slice(0, teamCount) as TeamId[]);
  const teamId =
    options.teamId === undefined
      ? role === "spectator"
        ? null
        : "red"
      : options.teamId;
  const playerId =
    options.playerId ??
    (role === "clue-giver"
      ? teamId === "blue"
        ? "blue-clue"
        : "red-clue"
      : role === "operative"
        ? teamId === "blue"
          ? "blue-op"
          : "red-op"
        : "spectator");
  const cards = options.cards ?? publicCards.map((card) => ({ ...card }));
  const board: NonNullable<ClientProjection["board"]> = {
    teamCount,
    rows: teamCount === 4 ? 6 : 5,
    columns: teamCount === 2 ? 5 : 6,
    configuredTeams,
    eliminatedTeams: [],
    teamSummaries: configuredTeams.map((teamId) => ({
      teamId,
      revealedTargets: 0,
      eliminated: false,
    })),
    order: cards.map((card) => card.id),
    cards,
    activeTeam: "red",
    phase: "guess",
    clue: { word: "Harbor", count: 2 },
    guessesRemaining: 3,
    nomination: null,
    winner: null,
    completionReason: null,
    ...options.board,
  };
  const base = {
    protocolVersion: 2 as const,
    revision: options.revision ?? 12,
    code: options.code ?? "ABC123",
    inviteUrl: "https://play.example/room/ABC123",
    roomPhase: options.roomPhase ?? "playing",
    locked: true,
    teamCount,
    configuredTeams,
    viewer: {
      playerId,
      teamId,
      role,
      isHost: options.isHost ?? false,
    },
    permissions: { ...NO_PERMISSIONS, ...options.permissions },
    seats: options.seats ?? seats,
    publicHistory: options.publicHistory ?? [],
    board,
  };

  switch (role) {
    case "clue-giver":
      return {
        ...base,
        viewRole: "clue-giver",
        key: options.key ?? key,
      };
    case "operative":
      return { ...base, viewRole: "operative" };
    case "unassigned":
      return { ...base, viewRole: "unassigned" };
    case "spectator":
      return { ...base, viewRole: "spectator" };
  }
}

function renderGame(
  current = projection(),
  options: {
    connection?: RoomConnectionState;
    pending?: boolean;
    send?: (command: ClientCommand) => void;
  } = {},
) {
  const send = options.send ?? vi.fn();
  const view = render(
    <GameView
      projection={current}
      connection={options.connection ?? "open"}
      pending={options.pending ?? false}
      send={send}
    />,
  );
  return { ...view, send };
}

const style = document.createElement("style");
style.textContent = `${tokenCss}\n${globalCss}`;
document.head.append(style);

function cssRule(selector: string): CSSStyleRule {
  const rule = Array.from(style.sheet?.cssRules ?? []).find(
    (candidate): candidate is CSSStyleRule =>
      "selectorText" in candidate && candidate.selectorText === selector,
  );
  if (rule === undefined) {
    throw new Error(`CSS rule ${selector} was not parsed`);
  }
  return rule;
}

function mediaCssRule(condition: string, selector: string): CSSStyleRule {
  const media = Array.from(style.sheet?.cssRules ?? []).find(
    (candidate): candidate is CSSMediaRule =>
      "conditionText" in candidate && candidate.conditionText === condition,
  );
  const rule = Array.from(media?.cssRules ?? []).find(
    (candidate): candidate is CSSStyleRule =>
      "selectorText" in candidate &&
      typeof candidate.selectorText === "string" &&
      candidate.selectorText
        .split(",")
        .map((part) => part.trim())
        .includes(selector),
  );
  if (rule === undefined) {
    throw new Error(`CSS rule ${selector} in ${condition} was not parsed`);
  }
  return rule;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("game confirmation ownership", () => {
  it("retires hook intent on identity change even without a workspace remount", () => {
    const current = projection({
      role: "operative",
      permissions: { endTurn: true },
    });
    const send = vi.fn<(command: ClientCommand) => void>();
    const input = {
      roomPhase: current.roomPhase,
      board: current.board!,
      permissions: current.permissions,
    };
    const availability = deriveGameAvailability({
      ...input,
      connection: "open",
      pending: false,
    });
    const { result, rerender } = renderHook(
      ({ identity }) =>
        useGameConfirmation({ ...input, identity, availability, send }),
      { initialProps: { identity: "seat-a" } },
    );
    act(() => result.current.requestEndTurn(document.createElement("button")));
    expect(result.current.dialog).not.toBeNull();
    rerender({ identity: "seat-b" });
    expect(result.current.dialog).toBeNull();
    rerender({ identity: "seat-a" });
    expect(result.current.dialog).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["reconnecting", "pending"] as const)(
    "guards a direct destructive callback during %s without relying on a disabled button",
    (blocked) => {
      const current = projection({
        role: "operative",
        permissions: { confirmReveal: true },
        board: { nomination: { playerId: "red-op", cardId: "card-01" } },
      });
      const send = vi.fn<(command: ClientCommand) => void>();
      const input = {
        identity: "seat-a",
        roomPhase: current.roomPhase,
        board: current.board!,
        permissions: current.permissions,
      };
      const { result, rerender } = renderHook(
        ({
          connection,
          pending,
        }: {
          connection: RoomConnectionState;
          pending: boolean;
        }) =>
          useGameConfirmation({
            ...input,
            availability: deriveGameAvailability({
              ...input,
              connection,
              pending,
            }),
            send,
          }),
        {
          initialProps: {
            connection: "open" as RoomConnectionState,
            pending: false,
          },
        },
      );
      act(() => result.current.handleCardAction("card-01"));
      expect(result.current.dialog).not.toBeNull();
      rerender({
        connection: blocked === "reconnecting" ? "reconnecting" : "open",
        pending: blocked === "pending",
      });
      expect(result.current.dialog?.confirmDisabled).toBe(true);
      act(() => result.current.dialog!.onConfirm());
      expect(send).not.toHaveBeenCalled();
      expect(result.current.dialog).toBeNull();
    },
  );
});

describe("GameView public board", () => {
  it("renders all 25 public cards in authoritative projection order", () => {
    const reversed = [...cardIds].reverse();
    renderGame(projection({ board: { order: reversed } }));

    const board = screen.getByRole("region", { name: "Classic board" });
    const cards = Array.from(board.querySelectorAll(".board-card"));
    expect(cards).toHaveLength(25);
    expect(cards.map((card) => card.textContent)).toEqual(
      reversed.map((id) => {
        const index = cardIds.indexOf(id);
        return `Archive ${String(index + 1).padStart(2, "0")}`;
      }),
    );
    expect(board).not.toHaveAttribute("aria-live");
  });

  it("renders a projection-sized six-column board and all four team summaries", () => {
    renderGame(
      fourTeamProjection({
        teamId: "yellow",
        playerId: "yellow-op",
        role: "operative",
        board: {
          teamSummaries: [
            { teamId: "red", revealedTargets: 2, eliminated: false },
            { teamId: "blue", revealedTargets: 1, eliminated: false },
            { teamId: "green", revealedTargets: 3, eliminated: true },
            { teamId: "yellow", revealedTargets: 4, eliminated: false },
          ],
          eliminatedTeams: ["green"],
        },
      }),
    );

    const board = screen.getByRole("region", { name: "Classic board" });
    expect(board.querySelectorAll(".board-card")).toHaveLength(36);
    expect(board.querySelector<HTMLElement>(".board-grid")).toHaveStyle({
      "--board-columns": "6",
    });
    expect(board).toHaveAttribute("tabindex", "0");
    expect(
      within(board).getByText(/scroll or arrow keys to explore/iu),
    ).toBeVisible();

    const score = screen.getByRole("region", { name: "Team progress" });
    expect(score).toHaveTextContent("Verdant");
    expect(score).toHaveTextContent("Amber");
    expect(score).toHaveTextContent("▲ Green revealed targets 3 Eliminated");
    expect(score).toHaveTextContent("■ Yellow revealed targets 4");
    expect(score.querySelector(".team-score-yellow")).toHaveClass("is-current");
  });

  it("preserves the projected five-by-six card order for three teams", () => {
    const ids = Array.from(
      { length: 30 },
      (_, index) => `tri-${String(index + 1).padStart(2, "0")}`,
    );
    const cards: NonNullable<ClientProjection["board"]>["cards"] = ids.map(
      (id, index) => ({
        id,
        label: `Relay ${String(index + 1).padStart(2, "0")}`,
        revealed: false,
      }),
    );
    renderGame(
      projection({
        teamCount: 3,
        configuredTeams: ["red", "blue", "green"],
        cards,
        board: {
          teamCount: 3,
          rows: 5,
          columns: 6,
          configuredTeams: ["red", "blue", "green"],
          eliminatedTeams: [],
          teamSummaries: [
            { teamId: "red", revealedTargets: 0, eliminated: false },
            { teamId: "blue", revealedTargets: 0, eliminated: false },
            { teamId: "green", revealedTargets: 0, eliminated: false },
          ],
          order: [...ids].reverse(),
        },
      }),
    );

    const board = screen.getByRole("region", { name: "Classic board" });
    expect(board.querySelectorAll(".board-card")).toHaveLength(30);
    expect(board.querySelector<HTMLElement>(".board-grid")).toHaveStyle({
      "--board-columns": "6",
    });
    expect(board.querySelector(".board-card")).toHaveTextContent("Relay 30");
  });

  it("keeps every unrevealed public card free of hidden ownership in text, classes, attributes, and descendants", () => {
    renderGame(
      projection({
        role: "operative",
        permissions: { nominate: true },
        board: {
          nomination: { playerId: "red-op", cardId: "card-01" },
        },
      }),
    );

    const first = screen
      .getByRole("region", { name: "Classic board" })
      .querySelector(".board-card");
    expect(first).not.toBeNull();
    expect(first).toHaveTextContent("Archive 01");
    expect(first).toHaveTextContent("Nominated");
    expect(first?.querySelector("[hidden]")).toBeNull();
    const serialized = first?.outerHTML.toLowerCase() ?? "";
    for (const secret of ["owner", "red", "blue", "neutral", "hazard"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each(["operative", "spectator", "unassigned"] as const)(
    "never reads a hidden-key-shaped property for the %s public branch",
    (role) => {
      const current = projection({ role });
      Object.defineProperty(current, "key", {
        configurable: true,
        get: () => {
          throw new Error("A public branch attempted to read the secret key");
        },
      });

      expect(() => renderGame(current)).not.toThrow();
      expect(
        screen.getByRole("region", { name: "Classic board" }),
      ).toBeVisible();
      expect(document.querySelectorAll(".key-owner")).toHaveLength(0);
    },
  );

  it("keeps a four-team public branch free of secret-key DOM nodes", () => {
    const current = fourTeamProjection({
      role: "operative",
      teamId: "green",
      playerId: "green-op",
    });
    Object.defineProperty(current, "key", {
      configurable: true,
      get: () => {
        throw new Error("A public branch attempted to read the secret key");
      },
    });

    expect(() => renderGame(current)).not.toThrow();
    expect(document.querySelectorAll(".key-owner")).toHaveLength(0);
    expect(document.body.innerHTML).not.toMatch(/green key|yellow key/iu);
  });

  it("shows a revealed public owner through text, symbol, pattern class, and color class", () => {
    const cards = publicCards.map((card, index) =>
      index === 0
        ? ({ ...card, revealed: true, owner: "red" } as const)
        : { ...card },
    );
    renderGame(projection({ cards }));

    const revealed = screen.getByText("Archive 01").closest(".board-card");
    expect(revealed).toHaveTextContent("◆ Red revealed");
    expect(revealed).toHaveClass("owner-red");
    expect(cssRule(".board-card.owner-red").cssText).toContain(
      "repeating-linear-gradient",
    );
    expect(cssRule(".board-card.owner-red").cssText).toContain(
      "var(--color-red)",
    );
  });

  it("shows public turn context and revealed progress without hidden totals", () => {
    const cards = publicCards.map((card, index) =>
      index === 0
        ? ({ ...card, revealed: true, owner: "red" } as const)
        : index === 10
          ? ({ ...card, revealed: true, owner: "blue" } as const)
          : { ...card },
    );
    renderGame(
      projection({
        cards,
        board: {
          teamSummaries: [
            { teamId: "red", revealedTargets: 1, eliminated: false },
            { teamId: "blue", revealedTargets: 1, eliminated: false },
          ],
        },
      }),
      { connection: "reconnecting" },
    );

    expect(screen.getByText("Red team’s turn")).toBeVisible();
    expect(screen.getByText("Guessing phase")).toBeVisible();
    expect(screen.getByText("Harbor · 2")).toBeVisible();
    expect(screen.getByText("3 guesses remaining")).toBeVisible();
    expect(screen.getByText("Reconnecting to room")).toBeVisible();
    const score = screen.getByRole("region", { name: "Team progress" });
    expect(score).toHaveTextContent("◆ Red revealed targets 1");
    expect(score).toHaveTextContent("● Blue revealed targets 1");
    expect(score).not.toHaveTextContent(/remaining|total|\/\s*[89]/iu);
  });

  it("gives a non-host spectator no clue, nomination, confirmation, or moderation actions", () => {
    renderGame(projection({ role: "spectator", isHost: false }));

    for (const name of [
      /submit clue/iu,
      /challenge clue/iu,
      /nominate/iu,
      /confirm reveal/iu,
      /end turn/iu,
      /accept clue/iu,
      /reject clue/iu,
      /pause/iu,
      /resume/iu,
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("formats only allowlisted public history fields in source chronological order", () => {
    const history: PublicHistoryEntry[] = [
      {
        revision: 2,
        at: "2026-08-30T10:00:00.000Z",
        type: "clue_submitted",
        teamId: "red",
        word: "Harbor",
        count: 2,
      },
      {
        revision: 3,
        at: "2026-08-30T10:01:00.000Z",
        type: "clue_challenged",
        teamId: "blue",
      },
      {
        revision: 4,
        at: "2026-08-30T10:02:00.000Z",
        type: "challenge_resolved",
        decision: "accept",
      },
      {
        revision: 5,
        at: "2026-08-30T10:03:00.000Z",
        type: "card_revealed",
        teamId: "red",
        cardId: "card-01",
        owner: "red",
      },
      {
        revision: 6,
        at: "2026-08-30T10:04:00.000Z",
        type: "turn_ended",
        teamId: "red",
      },
      {
        revision: 7,
        at: "2026-08-30T10:05:00.000Z",
        type: "room_paused",
      },
      {
        revision: 8,
        at: "2026-08-30T10:06:00.000Z",
        type: "room_resumed",
      },
    ];
    const withPrivateSentinel = history.map((entry, index) =>
      index === 0 ? { ...entry, internalKey: "SECRET-SENTINEL" } : entry,
    ) as PublicHistoryEntry[];
    renderGame(projection({ publicHistory: withPrivateSentinel }));

    const items = within(
      screen.getByRole("region", { name: "Public game history" }),
    ).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "◆ Red submitted Harbor for 2.",
      "● Blue challenged the clue.",
      "The clue challenge was accepted.",
      "Archive 01 was revealed as ◆ Red by Red.",
      "◆ Red ended its turn.",
      "The room was paused.",
      "The room resumed.",
    ]);
    expect(document.body).not.toHaveTextContent("SECRET-SENTINEL");
  });

  it("formats multi-team history and the composite hazard elimination explicitly", () => {
    renderGame(
      fourTeamProjection({
        publicHistory: [
          {
            revision: 20,
            at: "2026-09-12T10:00:00.000Z",
            type: "clue_submitted",
            teamId: "yellow",
            word: "Lantern",
            count: 2,
          },
          {
            revision: 21,
            at: "2026-09-12T10:01:00.000Z",
            type: "card_revealed",
            teamId: "green",
            cardId: "multi-01",
            owner: "hazard",
            eliminatedTeam: "green",
          },
        ],
      }),
    );

    const items = within(
      screen.getByRole("region", { name: "Public game history" }),
    ).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "■ Yellow submitted Lantern for 2.",
      "Signal 01 was revealed as ✦ Hazard by Green. ▲ Green was eliminated.",
    ]);
  });

  it("keeps the game-event live region initially silent and announces only later public transitions", async () => {
    const initial = projection();
    const { rerender } = renderGame(initial);
    const updates = screen.getByRole("status", { name: "Game updates" });
    expect(updates).toHaveAttribute("aria-live", "polite");
    expect(updates).toBeEmptyDOMElement();
    expect(
      screen.getByRole("region", { name: "Classic board" }),
    ).not.toHaveAttribute("aria-live");

    rerender(
      <GameView
        projection={projection({
          revision: 13,
          publicHistory: [
            {
              revision: 13,
              at: "2026-08-30T10:03:00.000Z",
              type: "card_revealed",
              teamId: "red",
              cardId: "card-01",
              owner: "red",
            },
          ],
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    await waitFor(() =>
      expect(updates).toHaveTextContent("Archive 01 was revealed as ◆ Red."),
    );

    rerender(
      <GameView
        projection={projection({
          revision: 14,
          board: { phase: "clue", activeTeam: "blue", clue: null },
          publicHistory: [
            {
              revision: 14,
              at: "2026-08-30T10:04:00.000Z",
              type: "turn_ended",
              teamId: "red",
            },
          ],
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    await waitFor(() =>
      expect(updates).toHaveTextContent("Red ended its turn."),
    );

    rerender(
      <GameView
        projection={projection({
          revision: 15,
          board: { phase: "paused" },
          publicHistory: [
            {
              revision: 15,
              at: "2026-08-30T10:05:00.000Z",
              type: "room_paused",
            },
          ],
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    await waitFor(() =>
      expect(updates).toHaveTextContent("The room was paused."),
    );

    rerender(
      <GameView
        projection={projection({
          revision: 16,
          board: { phase: "guess" },
          publicHistory: [
            {
              revision: 16,
              at: "2026-08-30T10:06:00.000Z",
              type: "room_resumed",
            },
          ],
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    await waitFor(() => expect(updates).toHaveTextContent("The room resumed."));

    rerender(
      <GameView
        projection={projection({
          revision: 17,
          board: { phase: "clue", activeTeam: "blue", clue: null },
          publicHistory: [
            {
              revision: 16,
              at: "2026-08-30T10:06:00.000Z",
              type: "room_resumed",
            },
          ],
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    await waitFor(() =>
      expect(updates).toHaveTextContent("Blue team. Clue phase."),
    );
  });

  it("announces elimination and the next active team as one public update", async () => {
    const initial = fourTeamProjection({
      role: "operative",
      teamId: "green",
      playerId: "green-op",
      board: { activeTeam: "green" },
    });
    const { rerender } = renderGame(initial);
    const updates = screen.getByRole("status", { name: "Game updates" });

    rerender(
      <GameView
        projection={fourTeamProjection({
          role: "spectator",
          teamId: null,
          playerId: "green-op",
          revision: 13,
          publicHistory: [
            {
              revision: 13,
              at: "2026-09-12T10:02:00.000Z",
              type: "card_revealed",
              teamId: "green",
              cardId: "multi-01",
              owner: "hazard",
              eliminatedTeam: "green",
            },
          ],
          board: {
            activeTeam: "yellow",
            phase: "clue",
            clue: null,
            eliminatedTeams: ["green"],
            teamSummaries: [
              { teamId: "red", revealedTargets: 0, eliminated: false },
              { teamId: "blue", revealedTargets: 0, eliminated: false },
              { teamId: "green", revealedTargets: 0, eliminated: true },
              { teamId: "yellow", revealedTargets: 0, eliminated: false },
            ],
          },
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );

    await waitFor(() => {
      expect(updates).toHaveTextContent(
        "Signal 01 was revealed as ✦ Hazard. Green was eliminated.",
      );
      expect(updates).toHaveTextContent("Yellow team. Clue phase.");
    });
  });

  it("announces the challenger rather than attributing the active team's clue to them", async () => {
    const { rerender } = renderGame(
      fourTeamProjection({
        board: { activeTeam: "yellow", phase: "clue", clue: null },
      }),
    );
    const updates = screen.getByRole("status", { name: "Game updates" });

    rerender(
      <GameView
        projection={fourTeamProjection({
          revision: 13,
          publicHistory: [
            {
              revision: 13,
              at: "2026-09-12T10:03:00.000Z",
              type: "clue_challenged",
              teamId: "green",
            },
          ],
          board: {
            activeTeam: "yellow",
            phase: "challenged",
            clue: { word: "Lantern", count: 2 },
          },
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Yellow team’s turn")).toBeVisible();
      expect(updates).toHaveTextContent("Green challenged the clue.");
      expect(updates).toHaveTextContent("Yellow team. Clue challenged.");
      expect(
        within(
          screen.getByRole("region", { name: "Public game history" }),
        ).getByRole("listitem"),
      ).toHaveTextContent("▲ Green challenged the clue.");
    });
  });

  it.each([
    {
      transition: "neutral reveal",
      owner: "neutral" as const,
      ownerText: "◇ Neutral",
      startingGuesses: 3,
    },
    {
      transition: "opponent reveal",
      owner: "blue" as const,
      ownerText: "● Blue",
      startingGuesses: 3,
    },
    {
      transition: "final own-team guess",
      owner: "red" as const,
      ownerText: "◆ Red",
      startingGuesses: 1,
    },
  ])(
    "composes a $transition with the simultaneous next-team clue phase",
    async ({ owner, ownerText, startingGuesses }) => {
      const { rerender } = renderGame(
        projection({ board: { guessesRemaining: startingGuesses } }),
      );
      const updates = screen.getByRole("status", { name: "Game updates" });

      rerender(
        <GameView
          projection={projection({
            revision: 13,
            board: {
              phase: "clue",
              activeTeam: "blue",
              clue: null,
              guessesRemaining: 0,
            },
            publicHistory: [
              {
                revision: 13,
                at: "2026-08-30T10:07:00.000Z",
                type: "card_revealed",
                teamId: "red",
                cardId: "card-01",
                owner,
              },
            ],
          })}
          connection="open"
          pending={false}
          send={() => {}}
        />,
      );

      await waitFor(() => {
        expect(updates).toHaveTextContent(
          `Archive 01 was revealed as ${ownerText}.`,
        );
        expect(updates).toHaveTextContent("Blue team. Clue phase.");
      });
    },
  );

  it.each([
    {
      reason: "targets" as const,
      owner: "blue" as const,
      revealedOwner: "● Blue",
      reasonText: "All Blue targets were revealed.",
    },
    {
      reason: "hazard" as const,
      owner: "hazard" as const,
      revealedOwner: "✦ Hazard",
      reasonText: "The hazard ended the board.",
    },
  ])(
    "announces a decisive $reason reveal with winner and public reason",
    async ({ reason, owner, revealedOwner, reasonText }) => {
      const { rerender } = renderGame(projection());
      const updates = screen.getByRole("status", { name: "Game updates" });

      rerender(
        <GameView
          projection={projection({
            revision: 13,
            roomPhase: "complete",
            board: {
              phase: "board_complete",
              winner: "blue",
              completionReason: reason,
              guessesRemaining: 0,
            },
            publicHistory: [
              {
                revision: 13,
                at: "2026-08-30T10:08:00.000Z",
                type: "card_revealed",
                teamId: "red",
                cardId: "card-01",
                owner,
              },
            ],
          })}
          connection="open"
          pending={false}
          send={() => {}}
        />,
      );

      await waitFor(() => {
        expect(updates).toHaveTextContent(
          `Archive 01 was revealed as ${revealedOwner}.`,
        );
        expect(updates).toHaveTextContent(`Blue wins. ${reasonText}`);
      });
    },
  );

  it("announces a rejected challenge together with the authoritative next turn", async () => {
    const { rerender } = renderGame(
      projection({ board: { phase: "challenged" } }),
    );
    const updates = screen.getByRole("status", { name: "Game updates" });

    rerender(
      <GameView
        projection={projection({
          revision: 13,
          board: {
            phase: "clue",
            activeTeam: "blue",
            clue: null,
            guessesRemaining: 0,
          },
          publicHistory: [
            {
              revision: 13,
              at: "2026-08-30T10:09:00.000Z",
              type: "challenge_resolved",
              decision: "reject",
            },
          ],
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );

    await waitFor(() => {
      expect(updates).toHaveTextContent("The clue challenge was rejected.");
      expect(updates).toHaveTextContent("Blue team. Clue phase.");
    });
  });

  it.each([
    { identity: "room", change: { code: "DEF456" } as ProjectionOptions },
    {
      identity: "viewer",
      change: { playerId: "replacement-viewer" } as ProjectionOptions,
    },
    {
      identity: "role",
      change: {
        role: "unassigned",
        teamId: null,
        playerId: "spectator",
      } as ProjectionOptions,
    },
    {
      identity: "board",
      change: {
        board: { order: [cardIds[1]!, cardIds[0]!, ...cardIds.slice(2)] },
      } as ProjectionOptions,
    },
  ])(
    "synchronously remounts a silent announcer for a new $identity identity",
    async ({ change }) => {
      const { rerender } = renderGame(projection());
      rerender(
        <GameView
          projection={projection({
            revision: 13,
            publicHistory: [
              {
                revision: 13,
                at: "2026-08-30T10:10:00.000Z",
                type: "room_paused",
              },
            ],
          })}
          connection="open"
          pending={false}
          send={() => {}}
        />,
      );
      const previous = screen.getByRole("status", { name: "Game updates" });
      await waitFor(() =>
        expect(previous).toHaveTextContent("The room was paused."),
      );

      rerender(
        <GameView
          projection={projection({
            revision: 14,
            publicHistory: [
              {
                revision: 13,
                at: "2026-08-30T10:10:00.000Z",
                type: "room_paused",
              },
            ],
            ...change,
          })}
          connection="open"
          pending={false}
          send={() => {}}
        />,
      );
      const current = screen.getByRole("status", { name: "Game updates" });
      if (change.role === undefined) {
        expect(current).not.toBe(previous);
      } else {
        expect(current).toBe(previous);
      }
      expect(current).toBeEmptyDOMElement();
    },
  );
});

describe("GameView clue-giver controls", () => {
  it("defaults the privacy veil closed and mounts all key indicators only while open", async () => {
    const cards = publicCards.map((card, index) =>
      index === 0
        ? ({ ...card, revealed: true, owner: "red" } as const)
        : { ...card },
    );
    const clueProjection = projection({ role: "clue-giver", cards });
    const { rerender } = renderGame(clueProjection);
    const user = userEvent.setup();

    expect(screen.queryByText("Hazard key")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".key-owner")).toHaveLength(0);
    expect(document.querySelector(".public-owner")).toHaveTextContent(
      "◆ Red revealed",
    );

    await user.click(screen.getByRole("button", { name: "Show secret key" }));
    expect(document.querySelectorAll(".key-owner")).toHaveLength(24);
    expect(screen.getByText("Hazard key")).toBeVisible();
    expect(screen.getAllByText("Red key")).toHaveLength(8);

    rerender(
      <GameView
        projection={projection({
          role: "clue-giver",
          cards,
          revision: 13,
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Hide secret key" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Hide secret key" }));
    expect(document.querySelectorAll(".key-owner")).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain("Hazard key");
    expect(document.querySelector(".public-owner")).toHaveTextContent(
      "◆ Red revealed",
    );
  });

  it("hides an open clue-giver key with Escape and returns focus to its control", async () => {
    renderGame(projection({ role: "clue-giver" }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show secret key" }));
    expect(
      screen.getByRole("button", { name: "Hide secret key" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(document.querySelectorAll(".key-owner")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Show secret key" }),
    ).toHaveFocus();
  });

  it("resets an open privacy veil when room, viewer, or board identity changes", async () => {
    const { rerender } = renderGame(projection({ role: "clue-giver" }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show secret key" }));
    expect(
      screen.getByRole("button", { name: "Hide secret key" }),
    ).toBeVisible();

    rerender(
      <GameView
        projection={projection({ role: "clue-giver", code: "DEF456" })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Show secret key" }),
      ).toBeVisible(),
    );
    expect(document.querySelectorAll(".key-owner")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Show secret key" }));
    rerender(
      <GameView
        projection={projection({
          role: "clue-giver",
          code: "DEF456",
          playerId: "replacement-clue",
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Show secret key" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Show secret key" }));
    rerender(
      <GameView
        projection={projection({
          role: "clue-giver",
          code: "DEF456",
          playerId: "replacement-clue",
          board: { order: [cardIds[1]!, cardIds[0]!, ...cardIds.slice(2)] },
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Show secret key" }),
    ).toBeVisible();
  });

  it("submits the protocol-normalized single-token clue and integer count", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    renderGame(
      projection({
        role: "clue-giver",
        board: { phase: "clue", clue: null, guessesRemaining: 0 },
        permissions: { submitClue: true },
      }),
      { send },
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Clue word"), "  Cafe\u0301  ");
    await user.type(screen.getByLabelText("Clue count"), "2");
    await user.click(screen.getByRole("button", { name: "Submit clue" }));

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "submit_clue",
      word: "Café",
      count: 2,
    });
  });

  it("rejects invalid syntax and counts above the authorized unrevealed own-target maximum", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const limitedKey = Object.fromEntries(
      cardIds.map((id, index) => [id, index < 2 ? "red" : "neutral"]),
    ) as Extract<ClientProjection, { viewRole: "clue-giver" }>["key"];
    const current = projection({
      role: "clue-giver",
      board: { phase: "clue", clue: null, guessesRemaining: 0 },
      permissions: { submitClue: true },
    }) as Extract<ClientProjection, { viewRole: "clue-giver" }>;
    renderGame({ ...current, key: limitedKey }, { send });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Clue word"), "two words");
    await user.type(screen.getByLabelText("Clue count"), "3");
    await user.click(screen.getByRole("button", { name: "Submit clue" }));

    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter one word using letters, numbers, apostrophes, or hyphens.",
    );

    await user.clear(screen.getByLabelText("Clue word"));
    await user.type(screen.getByLabelText("Clue word"), "Harbor");
    await user.click(screen.getByRole("button", { name: "Submit clue" }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Count cannot exceed your 2 unrevealed Red targets.",
    );
  });

  it("distinguishes invalid clue punctuation from a fractional count", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    renderGame(
      projection({
        role: "clue-giver",
        board: { phase: "clue", clue: null, guessesRemaining: 0 },
        permissions: { submitClue: true },
      }),
      { send },
    );
    const user = userEvent.setup();
    const clueWord = screen.getByLabelText("Clue word");
    const clueCount = screen.getByLabelText("Clue count");

    await user.type(clueWord, "Harbor!");
    await user.type(clueCount, "2");
    await user.click(screen.getByRole("button", { name: "Submit clue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter one word using letters, numbers, apostrophes, or hyphens.",
    );
    expect(send).not.toHaveBeenCalled();

    await user.clear(clueWord);
    await user.type(clueWord, "Harbor");
    await user.clear(clueCount);
    await user.type(clueCount, "2.5");
    await user.click(screen.getByRole("button", { name: "Submit clue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a whole clue count from 1 through 9.",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("sends exactly challenge_clue for an authorized inactive clue-giver", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    renderGame(
      projection({
        role: "clue-giver",
        teamId: "blue",
        permissions: { challengeClue: true },
      }),
      { send },
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Challenge clue" }));
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: "challenge_clue" });
  });
});

describe("GameView operative and moderation interactions", () => {
  it("waits for the authoritative nomination before allowing same-card reveal confirmation", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const initial = projection({
      role: "operative",
      permissions: { nominate: true, confirmReveal: false, endTurn: true },
    });
    const { rerender } = renderGame(initial, { send });
    const user = userEvent.setup();
    const firstCard = screen.getByRole("button", { name: "Archive 01" });

    await user.click(firstCard);
    expect(send).toHaveBeenCalledWith({
      type: "nominate_card",
      cardId: "card-01",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <GameView
        projection={projection({
          role: "operative",
          permissions: { nominate: true, confirmReveal: true, endTurn: true },
          revision: 13,
          board: {
            nomination: { playerId: "red-op", cardId: "card-01" },
          },
        })}
        connection="open"
        pending={false}
        send={send}
      />,
    );
    send.mockClear();
    await user.click(
      screen.getByRole("button", { name: "Archive 01, nominated" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Confirm reveal of Archive 01",
    });
    expect(dialog).toHaveTextContent(
      "Reveal Archive 01? This cannot be undone.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm reveal" }),
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "confirm_reveal",
      cardId: "card-01",
    });
  });

  it("cancels a reveal without sending and restores focus to its card trigger", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    renderGame(
      projection({
        role: "operative",
        permissions: { nominate: true, confirmReveal: true },
        board: { nomination: { playerId: "red-op", cardId: "card-01" } },
      }),
      { send },
    );
    const user = userEvent.setup();
    const card = screen.getByRole("button", {
      name: "Archive 01, nominated",
    });
    await user.click(card);
    const cancel = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Cancel reveal",
    });
    expect(cancel).toHaveFocus();
    await user.click(cancel);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(card).toHaveFocus();
  });

  it("supports Enter, Escape, and focus return for a projected nomination", async () => {
    renderGame(
      projection({
        role: "operative",
        permissions: { nominate: true, confirmReveal: true },
        board: { nomination: { playerId: "red-op", cardId: "card-02" } },
      }),
    );
    const user = userEvent.setup();
    const cards = screen.getAllByRole("button", { name: /Archive \d{2}/u });
    expect(cards.slice(0, 3).map((card) => card.textContent)).toEqual([
      "Archive 01",
      "Archive 02Nominated",
      "Archive 03",
    ]);
    const nominated = screen.getByRole("button", {
      name: "Archive 02, nominated",
    });
    nominated.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel reveal",
      }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(nominated).toHaveFocus();
  });

  it("moves an eliminated operative to spectator copy and focuses the next-team status", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const initial = fourTeamProjection({
      role: "operative",
      teamId: "green",
      playerId: "green-op",
      permissions: { nominate: true, confirmReveal: true, endTurn: true },
      board: {
        activeTeam: "green",
        nomination: { playerId: "green-op", cardId: "multi-01" },
      },
    });
    const { rerender } = renderGame(initial, { send });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Signal 01, nominated" }));
    expect(screen.getByRole("dialog")).toBeVisible();

    rerender(
      <GameView
        projection={fourTeamProjection({
          role: "spectator",
          teamId: null,
          playerId: "green-op",
          revision: 13,
          permissions: {
            nominate: false,
            confirmReveal: false,
            endTurn: false,
          },
          board: {
            activeTeam: "yellow",
            phase: "clue",
            clue: null,
            nomination: null,
            eliminatedTeams: ["green"],
            teamSummaries: [
              { teamId: "red", revealedTargets: 0, eliminated: false },
              { teamId: "blue", revealedTargets: 0, eliminated: false },
              { teamId: "green", revealedTargets: 0, eliminated: true },
              { teamId: "yellow", revealedTargets: 0, eliminated: false },
            ],
          },
        })}
        connection="open"
        pending={false}
        send={send}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("You are Spectator")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Signal 01/iu }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Turn status" })).toHaveFocus(),
    );
  });

  it("disables stale operative actions when the viewer's team is eliminated", () => {
    renderGame(
      fourTeamProjection({
        role: "operative",
        teamId: "green",
        playerId: "green-op",
        permissions: { nominate: true, confirmReveal: true, endTurn: true },
        board: {
          activeTeam: "yellow",
          eliminatedTeams: ["green"],
          teamSummaries: [
            { teamId: "red", revealedTargets: 0, eliminated: false },
            { teamId: "blue", revealedTargets: 0, eliminated: false },
            { teamId: "green", revealedTargets: 0, eliminated: true },
            { teamId: "yellow", revealedTargets: 0, eliminated: false },
          ],
        },
      }),
    );

    expect(screen.getByRole("button", { name: "Signal 01" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "End turn" })).toBeDisabled();
  });

  it("retires an open reveal dialog when nomination, phase, or reveal state becomes stale", async () => {
    const nominated = projection({
      role: "operative",
      permissions: { nominate: true, confirmReveal: true },
      board: { nomination: { playerId: "red-op", cardId: "card-01" } },
    });
    const { rerender } = renderGame(nominated);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Archive 01, nominated" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();

    rerender(
      <GameView
        projection={projection({
          role: "operative",
          revision: 13,
          permissions: { nominate: false, confirmReveal: false },
          board: { phase: "clue", clue: null, nomination: null },
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not resurrect reveal intent when nomination cycles A to B to A", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const current = projection({
      role: "operative",
      permissions: { nominate: true, confirmReveal: true },
      board: { nomination: { playerId: "red-op", cardId: "card-01" } },
    });
    const { rerender } = renderGame(current, { send });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Archive 01, nominated" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    rerender(
      <GameView
        projection={projection({
          role: "operative",
          revision: 13,
          permissions: { nominate: true, confirmReveal: true },
          board: { nomination: { playerId: "red-op", cardId: "card-02" } },
        })}
        connection="open"
        pending={false}
        send={send}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(
      <GameView
        projection={{ ...current, revision: 14 }}
        connection="open"
        pending={false}
        send={send}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Archive 01, nominated" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm reveal",
      }),
    );
    expect(send.mock.calls).toEqual([
      [{ type: "confirm_reveal", cardId: "card-01" }],
    ]);
  });

  it.each(["active team", "role"] as const)(
    "does not resurrect end-turn intent when %s cycles back",
    async (change) => {
      const send = vi.fn<(command: ClientCommand) => void>();
      const current = projection({
        role: "operative",
        permissions: { endTurn: true },
      });
      const { rerender } = renderGame(current, { send });
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "End turn" }));
      expect(screen.getByRole("dialog")).toBeVisible();
      // Retain stale permission bits: intent identity must still be retired.
      const changed = projection({
        role: change === "role" ? "unassigned" : "operative",
        playerId: "red-op",
        teamId: "red",
        permissions: { endTurn: true },
        board: { activeTeam: change === "active team" ? "blue" : "red" },
        revision: 13,
      });
      rerender(
        <GameView
          projection={changed}
          connection="open"
          pending={false}
          send={send}
        />,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      rerender(
        <GameView
          projection={{ ...current, revision: 14 }}
          connection="open"
          pending={false}
          send={send}
        />,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(send).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "End turn" }));
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Confirm end turn",
        }),
      );
      expect(send.mock.calls).toEqual([[{ type: "end_turn" }]]);
    },
  );

  it("never confirms an inactive, revealed, or different non-nominated card", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const revealedCards = publicCards.map((card, index) =>
      index === 0
        ? ({ ...card, revealed: true, owner: "red" } as const)
        : { ...card },
    );
    const { rerender } = renderGame(
      projection({ role: "operative", cards: revealedCards }),
      { send },
    );
    expect(
      screen.queryByRole("button", { name: /Archive 01/iu }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive 02" }),
    ).not.toBeInTheDocument();

    rerender(
      <GameView
        projection={projection({
          role: "operative",
          permissions: { nominate: true, confirmReveal: true },
          board: { nomination: { playerId: "red-op", cardId: "card-02" } },
        })}
        connection="open"
        pending={false}
        send={send}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Archive 03" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(send).toHaveBeenLastCalledWith({
      type: "nominate_card",
      cardId: "card-03",
    });
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirm_reveal" }),
    );
  });

  it("sends clear_nomination only from a coherent projected nomination", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    renderGame(
      projection({
        role: "operative",
        permissions: { nominate: true },
        board: { nomination: { playerId: "red-op", cardId: "card-01" } },
      }),
      { send },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Clear nomination" }));
    expect(send).toHaveBeenCalledWith({ type: "clear_nomination" });
  });

  it("requires a safe confirmation before ending a turn with guesses remaining", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    renderGame(
      projection({
        role: "operative",
        permissions: { nominate: true, endTurn: true },
        board: { guessesRemaining: 2 },
      }),
      { send },
    );
    const user = userEvent.setup();
    const endTurn = screen.getByRole("button", { name: "End turn" });
    await user.click(endTurn);
    const dialog = screen.getByRole("dialog", { name: "Confirm end turn" });
    expect(send).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "Keep guessing" }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(endTurn).toHaveFocus();

    await user.click(endTurn);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm end turn",
      }),
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: "end_turn" });
  });

  it("retires end-turn intent across pause and a later guessing turn until fresh activation", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const guessing = projection({
      role: "operative",
      permissions: { nominate: true, endTurn: true },
      board: { guessesRemaining: 2 },
    });
    const { rerender } = renderGame(guessing, { send });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "End turn" }));
    expect(
      screen.getByRole("dialog", { name: "Confirm end turn" }),
    ).toBeVisible();

    rerender(
      <GameView
        projection={projection({
          role: "operative",
          revision: 13,
          board: { phase: "paused", guessesRemaining: 2 },
        })}
        connection="open"
        pending={false}
        send={send}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <GameView
        projection={projection({
          role: "operative",
          revision: 14,
          permissions: { nominate: true, endTurn: true },
          board: { phase: "guess", guessesRemaining: 2 },
        })}
        connection="open"
        pending={false}
        send={send}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "End turn" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm end turn",
      }),
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: "end_turn" });
  });

  it.each([
    {
      validity: "clue phase",
      change: {
        permissions: { nominate: true, endTurn: true },
        board: { phase: "clue", guessesRemaining: 2 },
      } as ProjectionOptions,
    },
    {
      validity: "inactive permission",
      change: {
        permissions: { nominate: true, endTurn: false },
        board: { guessesRemaining: 2 },
      } as ProjectionOptions,
    },
    {
      validity: "completed board",
      change: {
        roomPhase: "complete",
        permissions: { nominate: true, endTurn: true },
        board: {
          phase: "board_complete",
          winner: "red",
          completionReason: "targets",
        },
      } as ProjectionOptions,
    },
    {
      validity: "active team",
      change: {
        permissions: { nominate: true, endTurn: true },
        board: { activeTeam: "blue", guessesRemaining: 2 },
      } as ProjectionOptions,
    },
    {
      validity: "remaining guess count",
      change: {
        permissions: { nominate: true, endTurn: true },
        board: { guessesRemaining: 1 },
      } as ProjectionOptions,
    },
    {
      validity: "room identity",
      change: {
        code: "DEF456",
        permissions: { nominate: true, endTurn: true },
        board: { guessesRemaining: 2 },
      } as ProjectionOptions,
    },
  ])(
    "dismisses end-turn intent when authoritative $validity changes",
    async ({ change }) => {
      const { rerender } = renderGame(
        projection({
          role: "operative",
          permissions: { nominate: true, endTurn: true },
          board: { guessesRemaining: 2 },
        }),
      );
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "End turn" }));
      expect(screen.getByRole("dialog")).toBeVisible();

      rerender(
        <GameView
          projection={projection({
            role: "operative",
            revision: 13,
            ...change,
          })}
          connection="open"
          pending={false}
          send={() => {}}
        />,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it.each([
    { identity: "room", change: { code: "DEF456" } as ProjectionOptions },
    {
      identity: "viewer",
      change: { playerId: "replacement-operative" } as ProjectionOptions,
    },
    {
      identity: "role",
      change: {
        role: "unassigned",
        teamId: null,
        playerId: "red-op",
      } as ProjectionOptions,
    },
    {
      identity: "board",
      change: {
        board: { order: [cardIds[1]!, cardIds[0]!, ...cardIds.slice(2)] },
      } as ProjectionOptions,
    },
  ])(
    "retires reveal intent for a new $identity identity with the same nominated card ID",
    async ({ change }) => {
      const current = projection({
        role: "operative",
        permissions: { nominate: true, confirmReveal: true },
        board: { nomination: { playerId: "red-op", cardId: "card-01" } },
      });
      const { rerender } = renderGame(current);
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Archive 01, nominated" }));
      expect(screen.getByRole("dialog")).toBeVisible();

      rerender(
        <GameView
          projection={projection({
            role: "operative",
            permissions: { nominate: true, confirmReveal: true },
            ...change,
            board: {
              nomination: { playerId: "red-op", cardId: "card-01" },
              ...change.board,
            },
          })}
          connection="open"
          pending={false}
          send={() => {}}
        />,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("keeps reveal cancellation clickable through reconnect while confirm stays disabled", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const current = projection({
      role: "operative",
      permissions: { nominate: true, confirmReveal: true },
      board: { nomination: { playerId: "red-op", cardId: "card-01" } },
    });
    const { rerender } = renderGame(current, { send });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Archive 01, nominated" }),
    );

    rerender(
      <GameView
        projection={current}
        connection="reconnecting"
        pending={false}
        send={send}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const cancel = within(dialog).getByRole("button", {
      name: "Cancel reveal",
    });
    expect(cancel).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Confirm reveal" }),
    ).toBeDisabled();
    const focusFallback = screen.getByRole("region", {
      name: "Turn status",
    });
    await user.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(focusFallback).toHaveFocus();
  });

  it("keeps end-turn cancellation clickable through reconnect while confirm stays disabled", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const current = projection({
      role: "operative",
      permissions: { nominate: true, endTurn: true },
      board: { guessesRemaining: 2 },
    });
    const { rerender } = renderGame(current, { send });
    const user = userEvent.setup();
    const endTurn = screen.getByRole("button", { name: "End turn" });
    await user.click(endTurn);

    rerender(
      <GameView
        projection={current}
        connection="reconnecting"
        pending={false}
        send={send}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const cancel = within(dialog).getByRole("button", {
      name: "Keep guessing",
    });
    expect(cancel).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Confirm end turn" }),
    ).toBeDisabled();
    expect(cancel).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(cancel).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(cancel).toHaveFocus();
    const focusFallback = screen.getByRole("region", {
      name: "Turn status",
    });
    await user.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(focusFallback).toHaveFocus();
  });

  it("contains forward and reverse Tab when focus is forced outside the modal", async () => {
    renderGame(
      projection({
        role: "operative",
        permissions: { nominate: true, confirmReveal: true },
        board: { nomination: { playerId: "red-op", cardId: "card-01" } },
      }),
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Archive 01, nominated" }),
    );
    const dialog = screen.getByRole("dialog");
    const cancel = within(dialog).getByRole("button", {
      name: "Cancel reveal",
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm reveal",
    });
    expect(cancel).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(confirm).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(cancel).toHaveFocus();

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await user.keyboard("{Tab}");
    expect(cancel).toHaveFocus();
    outside.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(confirm).toHaveFocus();
    outside.remove();
  });

  it("owns reveal and end-turn confirmation as one structurally exclusive modal", async () => {
    renderGame(
      projection({
        role: "operative",
        permissions: {
          nominate: true,
          confirmReveal: true,
          endTurn: true,
        },
        board: {
          guessesRemaining: 2,
          nomination: { playerId: "red-op", cardId: "card-01" },
        },
      }),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "End turn" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Archive 01, nominated" }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "Confirm reveal of Archive 01" }),
    ).toBeVisible();
  });

  it("does not restore focus to a reveal trigger removed during dialog cleanup", async () => {
    const view = renderGame(
      projection({
        role: "operative",
        permissions: { nominate: true, confirmReveal: true },
        board: { nomination: { playerId: "red-op", cardId: "card-01" } },
      }),
    );
    const card = screen.getByRole("button", {
      name: "Archive 01, nominated",
    });
    await userEvent.setup().click(card);
    const focus = vi.spyOn(card, "focus");
    focus.mockClear();

    view.unmount();
    expect(card.isConnected).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });

  it("uses exact challenge resolution, pause, and resume commands only when permitted", async () => {
    const send = vi.fn<(command: ClientCommand) => void>();
    const { rerender } = renderGame(
      projection({
        role: "spectator",
        isHost: true,
        permissions: { resolveChallenge: true, pause: true },
        board: { phase: "challenged", clue: { word: "Harbor", count: 2 } },
      }),
      { send },
    );
    const user = userEvent.setup();
    expect(screen.getByText("Disputed clue: Harbor · 2")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Accept clue" }));
    await user.click(screen.getByRole("button", { name: "Reject clue" }));
    await user.click(screen.getByRole("button", { name: "Pause room" }));
    expect(send.mock.calls.map(([command]) => command)).toEqual([
      { type: "resolve_challenge", decision: "accept" },
      { type: "resolve_challenge", decision: "reject" },
      { type: "pause_room" },
    ]);

    rerender(
      <GameView
        projection={projection({
          role: "spectator",
          isHost: true,
          permissions: { resume: true },
          board: { phase: "paused" },
        })}
        connection="open"
        pending={false}
        send={send}
      />,
    );
    expect(screen.getByText("Game actions are paused.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Resume room" }));
    expect(send).toHaveBeenLastCalledWith({ type: "resume_room" });
  });

  it.each([
    {
      phase: "challenged" as const,
      allowed: ["Accept clue", "Reject clue", "Pause room"],
    },
    { phase: "clue" as const, allowed: ["Pause room"] },
    { phase: "guess" as const, allowed: ["Pause room"] },
    { phase: "paused" as const, allowed: ["Resume room"] },
    { phase: "board_complete" as const, allowed: [] },
  ])(
    "keeps stale host permissions phase-coherent during $phase",
    ({ phase, allowed }) => {
      renderGame(
        projection({
          role: "spectator",
          isHost: true,
          roomPhase: phase === "board_complete" ? "complete" : "playing",
          permissions: {
            resolveChallenge: true,
            pause: true,
            resume: true,
          },
          board: {
            phase,
            clue: { word: "Harbor", count: 2 },
            winner: phase === "board_complete" ? "red" : null,
            completionReason: phase === "board_complete" ? "targets" : null,
          },
        }),
      );
      for (const name of [
        "Accept clue",
        "Reject clue",
        "Pause room",
        "Resume room",
      ]) {
        const button = screen.queryByRole("button", { name });
        if ((allowed as readonly string[]).includes(name)) {
          expect(button).toBeEnabled();
        } else {
          expect(button).not.toBeInTheDocument();
        }
      }
    },
  );

  it("disables every available action while pending or reconnecting", () => {
    const current = projection({
      role: "operative",
      permissions: { nominate: true, endTurn: true },
    });
    const { rerender } = renderGame(current, { pending: true });
    expect(screen.getByRole("button", { name: "Archive 01" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "End turn" })).toBeDisabled();

    rerender(
      <GameView
        projection={current}
        connection="reconnecting"
        pending={false}
        send={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Archive 01" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "End turn" })).toBeDisabled();
  });

  it("blocks projected game actions while paused or complete even if a stale permission is true", () => {
    const paused = projection({
      role: "operative",
      permissions: { nominate: true, endTurn: true },
      board: { phase: "paused" },
    });
    const { rerender } = renderGame(paused);
    expect(screen.getByRole("button", { name: "Archive 01" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "End turn" })).toBeDisabled();

    rerender(
      <GameView
        projection={projection({
          role: "operative",
          roomPhase: "complete",
          permissions: { nominate: true, endTurn: true },
          board: {
            phase: "board_complete",
            winner: "red",
            completionReason: "targets",
          },
        })}
        connection="open"
        pending={false}
        send={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Archive 01" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "End turn" })).toBeDisabled();
  });

  it("shows only the public board winner and targets or hazard reason at completion", () => {
    renderGame(
      projection({
        roomPhase: "complete",
        board: {
          phase: "board_complete",
          winner: "blue",
          completionReason: "hazard",
          clue: null,
          guessesRemaining: 0,
        },
      }),
    );
    const result = screen.getByRole("region", { name: "Board result" });
    expect(result).toHaveTextContent("● Blue wins");
    expect(result).toHaveTextContent("The hazard ended the board.");
    expect(
      screen.queryByRole("button", { name: /rematch|continue/iu }),
    ).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/campaign/iu);
  });

  it("renders a canonical four-team winner without a Red/Blue fallback", () => {
    renderGame(
      fourTeamProjection({
        roomPhase: "complete",
        board: {
          phase: "board_complete",
          winner: "yellow",
          completionReason: "targets",
          clue: null,
          guessesRemaining: 0,
        },
      }),
    );

    const result = screen.getByRole("region", { name: "Board result" });
    expect(result).toHaveTextContent("■ Yellow wins");
    expect(result).toHaveTextContent(
      "All of the winning team’s targets were revealed.",
    );
  });
});

describe("ConfirmDialog committed listener lifecycle", () => {
  it("keeps Escape bound to the committed handler during an interrupted render and removes it on cleanup", () => {
    const committedCancel = vi.fn();
    const interruptedCancel = vi.fn();
    const never = new Promise<never>(() => {});
    let beginInterruptedRender = () => {};

    function SuspendForever(): never {
      throw never;
    }

    function Harness() {
      const [interrupt, setInterrupt] = useState(false);
      beginInterruptedRender = () => {
        startTransition(() => setInterrupt(true));
      };
      return (
        <Suspense fallback={<span>Pending render</span>}>
          <ConfirmDialog
            title="Committed dialog"
            description="The committed callback must remain active."
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            confirmDisabled={false}
            returnFocus={null}
            fallbackFocus={null}
            onConfirm={() => {}}
            onCancel={interrupt ? interruptedCancel : committedCancel}
          >
            {interrupt ? <SuspendForever /> : null}
          </ConfirmDialog>
        </Suspense>
      );
    }

    const view = render(<Harness />);
    act(() => beginInterruptedRender());
    expect(
      screen.getByRole("dialog", { name: "Committed dialog" }),
    ).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(committedCancel).toHaveBeenCalledOnce();
    expect(interruptedCancel).not.toHaveBeenCalled();

    committedCancel.mockClear();
    view.unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(committedCancel).not.toHaveBeenCalled();
  });

  it.each([
    { unavailable: "native disabled", nativeDisabled: true },
    { unavailable: "ARIA disabled", nativeDisabled: false },
  ])(
    "uses the explicit fallback when the $unavailable primary cannot receive focus",
    ({ nativeDisabled }) => {
      const primary = document.createElement("button");
      primary.disabled = nativeDisabled;
      if (!nativeDisabled) {
        primary.setAttribute("aria-disabled", "true");
      }
      const fallback = document.createElement("section");
      fallback.tabIndex = -1;
      document.body.append(primary, fallback);

      const view = render(
        <ConfirmDialog
          title="Focus restoration"
          description="Unavailable primary targets use the explicit fallback."
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          confirmDisabled={false}
          returnFocus={primary}
          fallbackFocus={fallback}
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      view.unmount();

      expect(fallback).toHaveFocus();
      primary.remove();
      fallback.remove();
    },
  );

  it("uses the fallback when a connected primary focus attempt does not succeed", () => {
    const primary = document.createElement("div");
    const fallback = document.createElement("section");
    fallback.tabIndex = -1;
    document.body.append(primary, fallback);

    const view = render(
      <ConfirmDialog
        title="Focus restoration"
        description="A failed primary focus attempt uses the explicit fallback."
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        confirmDisabled={false}
        returnFocus={primary}
        fallbackFocus={fallback}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    view.unmount();

    expect(fallback).toHaveFocus();
    primary.remove();
    fallback.remove();
  });

  it("does not focus either restoration target after both disconnect", () => {
    const primary = document.createElement("button");
    const fallback = document.createElement("section");
    fallback.tabIndex = -1;
    document.body.append(primary, fallback);
    const primaryFocus = vi.spyOn(primary, "focus");
    const fallbackFocus = vi.spyOn(fallback, "focus");

    const view = render(
      <ConfirmDialog
        title="Focus restoration"
        description="Disconnected targets stay untouched."
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        confirmDisabled={false}
        returnFocus={primary}
        fallbackFocus={fallback}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    primary.remove();
    fallback.remove();
    view.unmount();

    expect(primaryFocus).not.toHaveBeenCalled();
    expect(fallbackFocus).not.toHaveBeenCalled();
  });
});

describe("GameView route integration and responsive contract", () => {
  it("keeps rejected clue inputs and focuses useRoom's local public server-error copy", async () => {
    const credentials: SeatCredentials = {
      code: "ABC123",
      playerId: "red-clue",
      seatToken: "durable-seat-token".padEnd(43, "x"),
      hostToken: "durable-host-token".padEnd(43, "x"),
    };
    const store: SeatStore = {
      get: async () => credentials,
      put: async () => {},
      delete: async () => {},
    };
    const socket = new FakeGameRoomSocket({
      connection: "open",
      projection: projection({
        role: "clue-giver",
        board: { phase: "clue", clue: null, guessesRemaining: 0 },
        permissions: { submitClue: true },
      }),
      lastResult: null,
    });
    const router = createMemoryRouter(
      createAppRoutes({ seatStore: store, createRoomSocket: () => socket }),
      { initialEntries: ["/room/ABC123"] },
    );
    render(<App router={router} />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Clue word"), "Harbor");
    await user.type(screen.getByLabelText("Clue count"), "2");
    await user.click(screen.getByRole("button", { name: "Submit clue" }));
    expect(socket.send).toHaveBeenCalledWith({
      type: "submit_clue",
      word: "Harbor",
      count: 2,
    });

    const rejected: CommandResult = {
      ok: false,
      revision: 13,
      code: "invalid_command",
      message: "SECRET-SERVER-SENTINEL",
    };
    socket.emit({
      connection: "open",
      projection: projection({
        role: "clue-giver",
        board: { phase: "clue", clue: null, guessesRemaining: 0 },
        permissions: { submitClue: true },
      }),
      lastResult: rejected,
    });
    socket.emit({
      connection: "open",
      projection: projection({
        role: "clue-giver",
        revision: 13,
        board: { phase: "clue", clue: null, guessesRemaining: 0 },
        permissions: { submitClue: true },
      }),
      lastResult: rejected,
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The room could not understand that action.",
    );
    expect(alert).toHaveFocus();
    expect(alert).not.toHaveTextContent("SECRET-SERVER-SENTINEL");
    expect(screen.getByLabelText("Clue word")).toHaveValue("Harbor");
    expect(screen.getByLabelText("Clue count")).toHaveValue(2);
    expect(screen.getByText("Connected")).toBeVisible();
  });

  it("uses a real five-column grid, narrow non-reflow guards, and 44px card/dialog targets", () => {
    expect(cssRule(".board-grid").style.gridTemplateColumns).toBe(
      "repeat(var(--board-columns), minmax(0, 1fr))",
    );
    expect(cssRule(".board-region").style.overflow).toBe("auto");
    expect(cssRule(".board-card").style.minHeight).toBe("44px");
    expect(cssRule(".confirm-dialog button").style.minHeight).toBe("44px");
    expect(
      mediaCssRule("(max-width: 42rem)", ".game-layout").style
        .gridTemplateColumns,
    ).toBe("minmax(0, 1fr)");
    expect(
      mediaCssRule("(max-width: 42rem)", ".game-side-panel").style.overflowY,
    ).toBe("auto");
    expect(
      mediaCssRule("(max-width: 42rem)", ".game-side-panel").style.maxHeight,
    ).toBe("58dvh");
    expect(
      mediaCssRule("(max-width: 42rem)", ".team-score").style.display,
    ).toBe("flex");
    expect(
      mediaCssRule("(max-width: 22rem)", ".board-card").style.fontSize,
    ).not.toBe("");
    expect(cssRule(".game-shell").style.minWidth).toMatch(/^0(?:px)?$/u);
    expect(cssRule(".board-grid").style.minWidth).toMatch(/^0(?:px)?$/u);
    expect(tokenCss.match(/--color-green:\s*#[0-9a-f]{6}/iu)).not.toBeNull();
    expect(tokenCss.match(/--color-yellow:\s*#[0-9a-f]{6}/iu)).not.toBeNull();
    expect(
      mediaCssRule("(forced-colors: active)", ".team-score strong").style
        .forcedColorAdjust,
    ).toBe("auto");

    renderGame();
    const status = screen.getByRole("region", { name: "Turn status" });
    const board = screen.getByRole("region", { name: "Classic board" });
    expect(
      status.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.getByLabelText("Game context and actions")).toBeVisible();
  });
});

class FakeGameRoomSocket {
  readonly connect = vi.fn<(credentials: SeatCredentials) => Promise<void>>(
    async () => {},
  );
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
