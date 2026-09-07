import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  CardId,
  ClueGiverProjection,
  OperativeProjection,
  Ownership,
  PublicCard,
  SpectatorProjection
} from "@cipher-party/protocol";
import { GameView } from "./GameView";

const CARD_WORDS = [
  "ALPHA",
  "BRAVO",
  "CHARLIE",
  "DELTA",
  "ECHO",
  "FOXTROT",
  "GOLF",
  "HOTEL",
  "INDIA",
  "JULIET",
  "KILO",
  "LIMA",
  "MIKE",
  "NOVEMBER",
  "OSCAR",
  "PAPA",
  "QUEBEC",
  "ROMEO",
  "SIERRA",
  "TANGO",
  "UNIFORM",
  "VICTOR",
  "WHISKEY",
  "XRAY",
  "YANKEE"
];

function make25Cards(): PublicCard[] {
  return CARD_WORDS.map((label, idx) => ({
    id: `card-${idx}`,
    label,
    revealed: false
  }));
}

function makeStandardKey(): Record<CardId, Ownership> {
  const key: Record<CardId, Ownership> = {};
  for (let i = 0; i < 9; i++) key[`card-${i}`] = "red";
  for (let i = 9; i < 17; i++) key[`card-${i}`] = "blue";
  for (let i = 17; i < 24; i++) key[`card-${i}`] = "neutral";
  key["card-24"] = "hazard";
  return key;
}

function makeOperativeProjection(
  overrides?: Partial<OperativeProjection>
): OperativeProjection {
  const cards = make25Cards();
  const order: CardId[] = cards.map((c) => c.id);

  return {
    protocolVersion: 1,
    revision: 10,
    code: "TEST99",
    inviteUrl: "http://127.0.0.1:5173/room/TEST99",
    roomPhase: "playing",
    locked: true,
    viewRole: "operative",
    viewer: {
      playerId: "p-op-red",
      teamId: "red",
      role: "operative",
      isHost: false
    },
    permissions: {
      configure: false,
      moderate: false,
      submitClue: false,
      challengeClue: false,
      nominate: true,
      confirmReveal: true,
      endTurn: true,
      resolveChallenge: false,
      pause: false,
      resume: false
    },
    seats: [
      {
        playerId: "p-cg-red",
        displayName: "Red Leader",
        teamId: "red",
        role: "clue-giver",
        connected: true
      },
      {
        playerId: "p-op-red",
        displayName: "Red Operative",
        teamId: "red",
        role: "operative",
        connected: true
      },
      {
        playerId: "p-cg-blue",
        displayName: "Blue Leader",
        teamId: "blue",
        role: "clue-giver",
        connected: true
      },
      {
        playerId: "p-op-blue",
        displayName: "Blue Operative",
        teamId: "blue",
        role: "operative",
        connected: true
      }
    ],
    publicHistory: [],
    board: {
      order,
      cards,
      activeTeam: "red",
      phase: "guess",
      clue: { word: "OCEAN", count: 2 },
      guessesRemaining: 3,
      nomination: null,
      winner: null,
      completionReason: null
    },
    ...overrides
  };
}

function makeClueGiverProjection(
  overrides?: Partial<ClueGiverProjection>
): ClueGiverProjection {
  const cards = make25Cards();
  const order: CardId[] = cards.map((c) => c.id);

  return {
    protocolVersion: 1,
    revision: 10,
    code: "TEST99",
    inviteUrl: "http://127.0.0.1:5173/room/TEST99",
    roomPhase: "playing",
    locked: true,
    viewRole: "clue-giver",
    key: makeStandardKey(),
    viewer: {
      playerId: "p-cg-red",
      teamId: "red",
      role: "clue-giver",
      isHost: false
    },
    permissions: {
      configure: false,
      moderate: false,
      submitClue: true,
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
        playerId: "p-cg-red",
        displayName: "Red Leader",
        teamId: "red",
        role: "clue-giver",
        connected: true
      },
      {
        playerId: "p-op-red",
        displayName: "Red Operative",
        teamId: "red",
        role: "operative",
        connected: true
      },
      {
        playerId: "p-cg-blue",
        displayName: "Blue Leader",
        teamId: "blue",
        role: "clue-giver",
        connected: true
      },
      {
        playerId: "p-op-blue",
        displayName: "Blue Operative",
        teamId: "blue",
        role: "operative",
        connected: true
      }
    ],
    publicHistory: [],
    board: {
      order,
      cards,
      activeTeam: "red",
      phase: "clue",
      clue: null,
      guessesRemaining: 0,
      nomination: null,
      winner: null,
      completionReason: null
    },
    ...overrides
  };
}

function makeSpectatorProjection(
  overrides?: Partial<SpectatorProjection>
): SpectatorProjection {
  const cards = make25Cards();
  const order: CardId[] = cards.map((c) => c.id);

  return {
    protocolVersion: 1,
    revision: 10,
    code: "TEST99",
    inviteUrl: "http://127.0.0.1:5173/room/TEST99",
    roomPhase: "playing",
    locked: true,
    viewRole: "spectator",
    viewer: {
      playerId: "p-spec",
      teamId: null,
      role: "spectator",
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
    },
    seats: [
      {
        playerId: "p-cg-red",
        displayName: "Red Leader",
        teamId: "red",
        role: "clue-giver",
        connected: true
      },
      {
        playerId: "p-op-red",
        displayName: "Red Operative",
        teamId: "red",
        role: "operative",
        connected: true
      },
      {
        playerId: "p-spec",
        displayName: "Spectator Sam",
        teamId: null,
        role: "spectator",
        connected: true
      }
    ],
    publicHistory: [],
    board: {
      order,
      cards,
      activeTeam: "red",
      phase: "guess",
      clue: { word: "OCEAN", count: 2 },
      guessesRemaining: 3,
      nomination: null,
      winner: null,
      completionReason: null
    },
    ...overrides
  };
}

describe("Task 11 Step 1: Public-board tests", () => {
  it("renders 25 cards in projection order", () => {
    const projection = makeOperativeProjection();
    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    const board = screen.getByRole("region", { name: /game board/i });
    expect(board).toBeInTheDocument();

    const cardElements = screen.getAllByRole("button", { name: /card /i });
    expect(cardElements).toHaveLength(25);

    CARD_WORDS.forEach((word, index) => {
      expect(cardElements[index]).toHaveTextContent(word);
    });
  });

  it("ensures unrevealed operative cards contain label and nomination state but no ownership label, class, data attribute, accessible description, or hidden DOM node", () => {
    const projection = makeOperativeProjection({
      board: {
        ...makeOperativeProjection().board!,
        nomination: { playerId: "p-op-red", cardId: "card-0" }
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    const card0 = screen.getByRole("button", { name: /card alpha/i });
    expect(card0).toBeInTheDocument();
    expect(card0).toHaveTextContent("ALPHA");

    // Must show nomination state
    expect(card0).toHaveAttribute("data-nominated", "true");
    expect(within(card0).getByText(/nominated/i)).toBeInTheDocument();

    // Check ALL unrevealed cards for hidden ownership leaks
    const cardElements = screen.getAllByRole("button", { name: /card /i });
    const forbiddenOwnershipTerms = [
      "red",
      "blue",
      "neutral",
      "hazard",
      "ruby",
      "cobalt"
    ];

    for (const cardEl of cardElements) {
      const classList = Array.from(cardEl.classList);
      for (const cls of classList) {
        for (const term of forbiddenOwnershipTerms) {
          expect(cls.toLowerCase()).not.toContain(`owner-${term}`);
          expect(cls.toLowerCase()).not.toContain(`card--${term}`);
        }
      }

      const attributes = cardEl.getAttributeNames();
      for (const attr of attributes) {
        expect(attr.toLowerCase()).not.toContain("owner");
        expect(attr.toLowerCase()).not.toContain("ownership");
      }

      const ariaLabel = cardEl.getAttribute("aria-label")?.toLowerCase() || "";
      const textContent = cardEl.textContent?.toLowerCase() || "";
      for (const term of forbiddenOwnershipTerms) {
        expect(ariaLabel).not.toContain(`owner: ${term}`);
        expect(ariaLabel).not.toContain(`team: ${term}`);
        expect(
          textContent.replace("alpha", "").replace("nominated", "")
        ).not.toContain(term);
      }

      const hiddenNodes = cardEl.querySelectorAll(
        '[aria-hidden="true"], [hidden], [style*="display: none"]'
      );
      for (const node of hiddenNodes) {
        const hiddenText = node.textContent?.toLowerCase() || "";
        for (const term of forbiddenOwnershipTerms) {
          expect(hiddenText).not.toContain(term);
        }
      }
    }
  });

  it("exposes revealed cards' public owner using color, symbol, pattern, and text", () => {
    const cards = make25Cards();
    cards[0] = { id: "card-0", label: "ALPHA", revealed: true, owner: "red" };
    cards[1] = { id: "card-1", label: "BRAVO", revealed: true, owner: "blue" };
    cards[2] = {
      id: "card-2",
      label: "CHARLIE",
      revealed: true,
      owner: "neutral"
    };
    cards[3] = {
      id: "card-3",
      label: "DELTA",
      revealed: true,
      owner: "hazard"
    };

    const projection = makeOperativeProjection({
      board: {
        ...makeOperativeProjection().board!,
        cards
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    // Card 0: Red / Ruby
    const redCard = screen.getByTestId("card-card-0");
    expect(redCard).toHaveTextContent("ALPHA");
    expect(redCard).toHaveTextContent("Ruby");
    expect(redCard).toHaveTextContent("♥");
    expect(redCard).toHaveClass("card--owner-red");
    expect(redCard).toHaveClass("card--pattern-ruby");

    // Card 1: Blue / Cobalt
    const blueCard = screen.getByTestId("card-card-1");
    expect(blueCard).toHaveTextContent("BRAVO");
    expect(blueCard).toHaveTextContent("Cobalt");
    expect(blueCard).toHaveTextContent("✦");
    expect(blueCard).toHaveClass("card--owner-blue");
    expect(blueCard).toHaveClass("card--pattern-cobalt");

    // Card 2: Neutral
    const neutralCard = screen.getByTestId("card-card-2");
    expect(neutralCard).toHaveTextContent("CHARLIE");
    expect(neutralCard).toHaveTextContent("Neutral");
    expect(neutralCard).toHaveTextContent("—");
    expect(neutralCard).toHaveClass("card--owner-neutral");
    expect(neutralCard).toHaveClass("card--pattern-neutral");

    // Card 3: Hazard
    const hazardCard = screen.getByTestId("card-card-3");
    expect(hazardCard).toHaveTextContent("DELTA");
    expect(hazardCard).toHaveTextContent("Hazard");
    expect(hazardCard).toHaveTextContent("☠");
    expect(hazardCard).toHaveClass("card--owner-hazard");
    expect(hazardCard).toHaveClass("card--pattern-hazard");
  });

  it("ensures spectators have no clue, nomination, confirmation, or moderation controls", () => {
    const projection = makeSpectatorProjection();
    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    expect(screen.queryByLabelText(/clue word/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /give clue|submit clue/i })
    ).not.toBeInTheDocument();

    const cards = screen.getAllByRole("button", { name: /card /i });
    for (const card of cards) {
      expect(card).toBeDisabled();
    }

    expect(
      screen.queryByRole("button", { name: /confirm reveal/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /end turn/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /challenge/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /pause/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resume/i })
    ).not.toBeInTheDocument();
  });

  it("displays current team, phase, clue, remaining guesses, and connection state", () => {
    const projection = makeOperativeProjection({
      board: {
        ...makeOperativeProjection().board!,
        activeTeam: "red",
        phase: "guess",
        clue: { word: "OCEAN", count: 2 },
        guessesRemaining: 3
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    expect(screen.getByTestId("active-team-indicator")).toHaveTextContent(
      /red/i
    );
    expect(screen.getByTestId("game-phase-indicator")).toHaveTextContent(
      /guess/i
    );
    expect(screen.getByTestId("current-clue-word")).toHaveTextContent("OCEAN");
    expect(screen.getByTestId("current-clue-count")).toHaveTextContent("2");
    expect(screen.getByTestId("guesses-remaining")).toHaveTextContent("3");
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("renders public clue, challenge, reveal, turn-end, pause, and resume events newest-last without exposing unrevealed ownership", () => {
    const projection = makeOperativeProjection({
      publicHistory: [
        {
          revision: 11,
          at: "2026-09-06T17:00:00.000Z",
          type: "clue_submitted",
          teamId: "red",
          word: "OCEAN",
          count: 2
        },
        {
          revision: 12,
          at: "2026-09-06T17:01:00.000Z",
          type: "card_revealed",
          teamId: "red",
          cardId: "card-0",
          owner: "red"
        },
        {
          revision: 13,
          at: "2026-09-06T17:02:00.000Z",
          type: "clue_challenged",
          teamId: "blue"
        },
        {
          revision: 14,
          at: "2026-09-06T17:03:00.000Z",
          type: "challenge_resolved",
          decision: "reject"
        },
        {
          revision: 15,
          at: "2026-09-06T17:04:00.000Z",
          type: "turn_ended",
          teamId: "red"
        },
        {
          revision: 16,
          at: "2026-09-06T17:05:00.000Z",
          type: "room_paused"
        },
        {
          revision: 17,
          at: "2026-09-06T17:06:00.000Z",
          type: "room_resumed"
        }
      ]
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    const historyRegion = screen.getByRole("region", { name: /game history/i });
    expect(historyRegion).toBeInTheDocument();

    const historyItems = within(historyRegion).getAllByRole("listitem");
    expect(historyItems).toHaveLength(7);

    expect(historyItems[0]).toHaveTextContent(/clue submitted/i);
    expect(historyItems[0]).toHaveTextContent("OCEAN");
    expect(historyItems[0]).toHaveTextContent("2");

    expect(historyItems[1]).toHaveTextContent(/revealed/i);
    expect(historyItems[1]).toHaveTextContent("ALPHA");
    expect(historyItems[1]).toHaveTextContent(/red|ruby/i);

    expect(historyItems[2]).toHaveTextContent(/challenged/i);
    expect(historyItems[3]).toHaveTextContent(/challenge rejected/i);
    expect(historyItems[4]).toHaveTextContent(/turn ended/i);
    expect(historyItems[5]).toHaveTextContent(/paused/i);
    expect(historyItems[6]).toHaveTextContent(/resumed/i);

    for (const item of historyItems) {
      expect(item.textContent).not.toContain("BRAVO");
      expect(item.textContent).not.toContain("CHARLIE");
    }
  });
});

describe("Task 11 Step 2: Clue-giver tests", () => {
  it("shows key only when PrivacyVeil is open, and removes key data from DOM when closed", async () => {
    const user = userEvent.setup();
    const projection = makeClueGiverProjection();

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    // Default: privacy veil is closed
    const veilToggle = screen.getByRole("button", {
      name: /show keycard|view keycard|open keycard/i
    });
    expect(veilToggle).toBeInTheDocument();

    // With veil closed, unrevealed cards have no keyowner classes or text
    const card0 = screen.getByTestId("card-card-0");
    expect(card0).not.toHaveClass("card--key-red");
    expect(card0.textContent).not.toContain("Ruby");

    // Open privacy veil
    await user.click(veilToggle);

    // Keycard is now visible
    expect(
      screen.getByRole("button", { name: /hide keycard|close keycard/i })
    ).toBeInTheDocument();
    expect(card0).toHaveClass("card--key-red");
    expect(card0).toHaveTextContent("Ruby");

    const cardHazard = screen.getByTestId("card-card-24");
    expect(cardHazard).toHaveClass("card--key-hazard");
    expect(cardHazard).toHaveTextContent("Hazard");

    // Close privacy veil
    await user.click(
      screen.getByRole("button", { name: /hide keycard|close keycard/i })
    );

    // Verify ownership data is unmounted / removed from DOM, not merely visually hidden
    expect(card0).not.toHaveClass("card--key-red");
    expect(card0.textContent).not.toContain("Ruby");
    expect(cardHazard).not.toHaveClass("card--key-hazard");
    expect(cardHazard.textContent).not.toContain("Hazard");
  });

  it("allows active clue-giver to submit one valid word and count", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeClueGiverProjection();

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const wordInput = screen.getByLabelText(/clue word/i);
    const countInput = screen.getByLabelText(/clue count/i);
    const submitBtn = screen.getByRole("button", {
      name: /give clue|submit clue/i
    });

    await user.type(wordInput, "OCEAN");
    await user.clear(countInput);
    await user.type(countInput, "2");
    await user.click(submitBtn);

    expect(onSendCommand).toHaveBeenCalledWith({
      type: "submit_clue",
      word: "OCEAN",
      count: 2
    });
  });

  it("validates clue word and count client-side according to protocol rules", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeClueGiverProjection();

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const wordInput = screen.getByLabelText(/clue word/i);
    const countInput = screen.getByLabelText(/clue count/i);
    const submitBtn = screen.getByRole("button", {
      name: /give clue|submit clue/i
    });

    // Invalid: contains numbers / spaces
    await user.type(wordInput, "TWO WORDS");
    await user.clear(countInput);
    await user.type(countInput, "0");
    await user.click(submitBtn);

    expect(onSendCommand).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("allows opposing clue-giver to challenge after a clue exists", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeClueGiverProjection({
      viewer: {
        playerId: "p-cg-blue",
        teamId: "blue",
        role: "clue-giver",
        isHost: false
      },
      permissions: {
        configure: false,
        moderate: false,
        submitClue: false,
        challengeClue: true,
        nominate: false,
        confirmReveal: false,
        endTurn: false,
        resolveChallenge: false,
        pause: false,
        resume: false
      },
      board: {
        ...makeClueGiverProjection().board!,
        activeTeam: "red",
        phase: "guess",
        clue: { word: "OCEAN", count: 2 },
        guessesRemaining: 3
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const challengeBtn = screen.getByRole("button", {
      name: /challenge clue/i
    });
    expect(challengeBtn).toBeInTheDocument();

    await user.click(challengeBtn);

    expect(onSendCommand).toHaveBeenCalledWith({
      type: "challenge_clue"
    });
  });
});

describe("Task 11 Step 3: Operative interaction tests", () => {
  it("allows active operative to nominate an unrevealed card", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeOperativeProjection();

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const card0 = screen.getByRole("button", { name: /card alpha/i });
    await user.click(card0);

    expect(onSendCommand).toHaveBeenCalledWith({
      type: "nominate_card",
      cardId: "card-0"
    });
  });

  it("shows confirmation dialog naming nominated card before sending confirm_reveal", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeOperativeProjection({
      board: {
        ...makeOperativeProjection().board!,
        nomination: { playerId: "p-op-red", cardId: "card-0" }
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    // Clicking the reveal button or nominated card triggers confirmation dialog
    const revealBtn = screen.getByRole("button", { name: /reveal alpha/i });
    await user.click(revealBtn);

    // Dialog appears and names the card
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/confirm reveal/i)).toBeInTheDocument();
    expect(within(dialog).getByText("ALPHA")).toBeInTheDocument();

    // Confirm sends confirm_reveal
    const confirmBtn = within(dialog).getByRole("button", {
      name: /^confirm$/i
    });
    await user.click(confirmBtn);

    expect(onSendCommand).toHaveBeenCalledWith({
      type: "confirm_reveal",
      cardId: "card-0"
    });
  });

  it("cancels reveal confirmation dialog without sending confirm_reveal", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeOperativeProjection({
      board: {
        ...makeOperativeProjection().board!,
        nomination: { playerId: "p-op-red", cardId: "card-0" }
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const revealBtn = screen.getByRole("button", { name: /reveal alpha/i });
    await user.click(revealBtn);

    const dialog = screen.getByRole("dialog");
    const cancelBtn = within(dialog).getByRole("button", { name: /cancel/i });
    await user.click(cancelBtn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSendCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirm_reveal" })
    );
  });

  it("prevents inactive operatives from nominating", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeOperativeProjection({
      permissions: {
        ...makeOperativeProjection().permissions,
        nominate: false,
        confirmReveal: false
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const card0 = screen.getByRole("button", { name: /card alpha/i });
    await user.click(card0);

    expect(onSendCommand).not.toHaveBeenCalled();
  });

  it("requires confirmation to end turn when guesses remain", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeOperativeProjection({
      board: {
        ...makeOperativeProjection().board!,
        guessesRemaining: 2
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const endTurnBtn = screen.getByRole("button", { name: /end turn/i });
    await user.click(endTurnBtn);

    // Confirmation dialog appears
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText(/end turn with 2 guesses remaining/i)
    ).toBeInTheDocument();

    // Confirm ending turn
    const confirmBtn = within(dialog).getByRole("button", {
      name: /^end turn$/i
    });
    await user.click(confirmBtn);

    expect(onSendCommand).toHaveBeenCalledWith({
      type: "end_turn"
    });
  });

  it("does not allow a revealed card to be nominated or confirmed", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const cards = make25Cards();
    cards[0] = { id: "card-0", label: "ALPHA", revealed: true, owner: "red" };

    const projection = makeOperativeProjection({
      board: {
        ...makeOperativeProjection().board!,
        cards
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const revealedCard = screen.getByTestId("card-card-0");
    await user.click(revealedCard);

    expect(onSendCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "nominate_card" })
    );
    expect(onSendCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirm_reveal" })
    );
  });
});

describe("Task 11 Step 7 & 8: Challenge, pause, result states and keyboard accessibility", () => {
  it("renders challenge controls for host when in challenged phase", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeOperativeProjection({
      viewer: {
        playerId: "p-host",
        teamId: "red",
        role: "operative",
        isHost: true
      },
      permissions: {
        ...makeOperativeProjection().permissions,
        resolveChallenge: true
      },
      board: {
        ...makeOperativeProjection().board!,
        phase: "challenged",
        clue: { word: "OCEAN", count: 2 }
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    expect(screen.getByText(/clue challenged: "OCEAN"/i)).toBeInTheDocument();

    const acceptBtn = screen.getByRole("button", { name: /accept challenge/i });
    const rejectBtn = screen.getByRole("button", { name: /reject challenge/i });

    await user.click(acceptBtn);
    expect(onSendCommand).toHaveBeenCalledWith({
      type: "resolve_challenge",
      decision: "accept"
    });

    await user.click(rejectBtn);
    expect(onSendCommand).toHaveBeenCalledWith({
      type: "resolve_challenge",
      decision: "reject"
    });
  });

  it("renders pause overlay and host resume controls when paused", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeOperativeProjection({
      viewer: {
        playerId: "p-host",
        teamId: "red",
        role: "operative",
        isHost: true
      },
      permissions: {
        ...makeOperativeProjection().permissions,
        nominate: false,
        resume: true
      },
      board: {
        ...makeOperativeProjection().board!,
        phase: "paused"
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    expect(screen.getByText(/game paused/i)).toBeInTheDocument();

    const resumeBtn = screen.getByRole("button", { name: /resume game/i });
    await user.click(resumeBtn);

    expect(onSendCommand).toHaveBeenCalledWith({
      type: "resume_room"
    });
  });

  it("renders board result when board is complete", () => {
    const projection = makeOperativeProjection({
      roomPhase: "complete",
      board: {
        ...makeOperativeProjection().board!,
        phase: "board_complete",
        winner: "red",
        completionReason: "targets"
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={vi.fn()}
      />
    );

    const resultBanner = screen.getByRole("region", { name: /board result/i });
    expect(resultBanner).toBeInTheDocument();
    expect(
      within(resultBanner).getByText(/red team wins/i)
    ).toBeInTheDocument();
    expect(
      within(resultBanner).getByText(/all targets identified/i)
    ).toBeInTheDocument();
  });

  it("supports keyboard navigation: Enter to nominate and Escape to close confirmation dialog", async () => {
    const user = userEvent.setup();
    const onSendCommand = vi.fn();
    const projection = makeOperativeProjection({
      board: {
        ...makeOperativeProjection().board!,
        nomination: { playerId: "p-op-red", cardId: "card-0" }
      }
    });

    render(
      <GameView
        projection={projection}
        connectionState="open"
        onSendCommand={onSendCommand}
      />
    );

    const revealBtn = screen.getByRole("button", { name: /reveal alpha/i });
    revealBtn.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
