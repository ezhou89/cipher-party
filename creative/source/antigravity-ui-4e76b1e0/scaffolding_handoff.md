# 🚀 Cipher Party — Scaffolding Handoff & Situational Analysis

**Handoff Date:** 2026-09-05  
**From:** Antigravity (Creative Design & UI Architecture Agent)  
**To:** Antigravity / Codex (Scaffolding & Milestone 1 Implementation Agent)  
**Active Plan:** [`docs/superpowers/plans/2026-08-30-connected-classic.md`](file:///Users/eugenezhou/Code/cipher-party/docs/superpowers/plans/2026-08-30-connected-classic.md)  
**Approved Spec:** [`docs/superpowers/specs/2026-08-30-cipher-party-design.md`](file:///Users/eugenezhou/Code/cipher-party/docs/superpowers/specs/2026-08-30-cipher-party-design.md)  
**Design System Spec:** [`docs/DESIGN_SYSTEM.md`](file:///Users/eugenezhou/Code/cipher-party/docs/DESIGN_SYSTEM.md)  
**Living Snapshot:** [`docs/PROJECT_SNAPSHOT.md`](file:///Users/eugenezhou/Code/cipher-party/docs/PROJECT_SNAPSHOT.md) (Revision 3)

---

## 1. Situational Analysis & Project Context

### Current Status
* **Phase Completed:** Visual Identity, Neo 8-Bit Retro Arcade Design System, Interactive UI Prototypes, and Cyclomatic Complexity Audit.
* **Current Delivery Boundary:** Milestone 1 — Connected Classic (2-team, 5×5 classic text board, host, clue-givers, operatives, spectators, ticketed WebSockets over SQLite-backed Cloudflare Durable Objects).
* **Codebase State:** Immaculate baseline; clean `git status`; design tokens compiled at [`apps/web/src/styles/tokens.css`](file:///Users/eugenezhou/Code/cipher-party/apps/web/src/styles/tokens.css); 0 high-complexity functions in the UI layer.

### Key Invariants Locked with the User
1. **The "Balatro" Hybrid Typography Rule:**
   * **Arcade Chrome & HUD:** `Press Start 2P` exclusively for timers, scores, round marquees, and action buttons.
   * **Card Words:** High-contrast, ultra-crisp bold modern sans (`Plus Jakarta Sans` uppercase, tracked) on `#fbf6ec` cartridge cardstock. No pixel fonts on 5×5 cards to eliminate eye fatigue.
2. **16 Collectible Monopoly-Style Arcade Tokens:**
   * Players select a signature piece in the pre-match lobby (`🎩` Top Hat, `🏎️` Racecar, `👑` Crown, `🗡️` Sword, `💎` Gem, `🚀` Rocket, `👾` Invader, `🕹️` Joystick, `⚡` Bolt, `🍒` Cherry, `👻` Ghost, `🍄` Shroom, `💣` Bomb, `🦆` Duck, `🍕` Pizza, `🦖` Dino).
   * Operative piece sits on nominated cards with a 1UP halo. Team mascot crest seals revealed cards.
3. **Quad-Indicator Colorblind Accessibility:**
   * Every card state and team identity is marked via four redundant channels: **Primary Hue**, **Pixel Glyph** (`♥`, `✦`, `▲`, `⬢`), **Border/Texture**, and **Semantic Text Label**.
4. **Pure Web Audio API Sound Effects:**
   * Square/triangle/sawtooth synthesized retro audio; 100% self-contained with zero external sound asset dependencies.
5. **Server-Authoritative Role Safety:**
   * Operatives, host-only, and spectators **never** receive unrevealed card ownership. The key is structurally omitted by server projections (`packages/protocol`).

---

## 2. Monorepo Architecture & Package Topology

The repository follows an npm workspaces topology with strict dependency boundaries:

```
cipher-party/
├── apps/
│   ├── web/               # React 19 + Vite client (DOM only, no canvas/Phaser)
│   │   ├── src/styles/tokens.css  # Single source of truth CSS tokens
│   │   └── src/features/  # Lobby, GameBoard, ClueGiverView, VictoryFanfare
│   └── worker/            # Cloudflare Worker + SQLite Durable Object room actor
├── packages/
│   ├── game-core/         # Pure deterministic rules, boards, reducers (Zero I/O)
│   └── protocol/          # Zod command/projection schemas (Shared boundary)
└── e2e/                   # Multi-browser Playwright integration tests
```

### Strict Import Boundaries:
* `apps/web` ──imports──> `packages/protocol` ONLY. (NEVER import `game-core` or server reducers into the client).
* `apps/worker` ──imports──> `packages/protocol` AND `packages/game-core`.
* `packages/protocol` ──imports──> `packages/game-core` (domain types only).
* `packages/game-core` has **zero external runtime dependencies**.

---

## 3. Prototype to Production Component Translation Matrix

All interactive HTML prototypes located in the artifacts directory translate 1:1 into planned React components in `apps/web`:

| Prototype Screen | Planned React Component in `apps/web` | Key Subcomponents & Responsibilities |
| :--- | :--- | :--- |
| **[`arcade_lobby.html`](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/arcade_lobby.html)** | `src/features/lobby/LobbyScreen.tsx` | `RoomCodeBadge`, `TeamRosterColumn`, `RoleToggleBar`, `TokenSelectionModal`, `LaunchMatchButton` |
| **[`stitch_game_board.html`](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/stitch_game_board.html)** | `src/features/game/GameBoard.tsx` | `HudHeader`, `TurnClueMarquee`, `CardGrid5x5`, `Card` (`CardHeader`, `CardWord`, `CardFooter`), `ActionDeck` |
| **[`clue_giver_view.html`](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/clue_giver_view.html)** | `src/features/game/ClueGiverView.tsx`| `PrivacyVeil`, `SpotlightFilterTabs`, `KeyGrid5x5`, `ClueTransmissionStation` |
| **[`round_end_victory.html`](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/round_end_victory.html)**| `src/features/game/VictoryFanfare.tsx`| `VictoryMarquee`, `SeriesPipsTracker`, `HighlightsReel`, `PostMatchMiniBoard`, `SpymasterRotationNotice` |
| **Web Audio Synthesizer** | `src/hooks/useSoundFx.ts` | Shared hook managing `AudioContext`, coin jingles, blips, saw waves, and mute toggle |
| **[`tokens.css`](file:///Users/eugenezhou/Code/cipher-party/apps/web/src/styles/tokens.css)** | `src/styles/tokens.css` | Production CSS variables for colors, pixel corners, and button press physics |

---

## 4. Cyclomatic Complexity Audit Findings

* **Overall Score:** 86.5% Low Complexity ($M \le 5$), 13.5% Moderate ($M \le 10$), **0.0% High Complexity ($M > 10$)**.
* **Key Architecture Guidance:**
  * Avoid giant imperative card renderers. In React, decompose `<Card>` into `<CardHeader>`, `<CardWord>`, and `<CardFooter>`.
  * Use dictionary lookup maps (`CREST_CONFIG[card.state]`) instead of cascading `if/else if` statements.
  * Keep Redux/Zustand reducer cases flat; delegate game logic to pure functions in `packages/game-core`.

---

## 5. Milestone 1 Scaffolding Execution Plan

Execute Task 1 from `docs/superpowers/plans/2026-08-30-connected-classic.md`:

### Step-by-Step Task 1 Checklist:
1. **Scaffold Root Workspace Configuration:**
   * Create root `package.json` (npm workspaces: `["apps/*", "packages/*"]`).
   * Create `tsconfig.base.json`, `eslint.config.js`, `prettier.config.js`, `.prettierignore`.
   * Create `vitest.config.ts` and `playwright.config.ts`.
2. **Scaffold Package Workspaces:**
   * `packages/game-core`: `package.json`, `tsconfig.json`, `src/index.ts`.
   * `packages/protocol`: `package.json`, `tsconfig.json`, `src/index.ts`.
   * `apps/web`: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/styles/globals.css`.
   * `apps/worker`: `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.jsonc`, `wrangler.dev.jsonc`, `src/index.ts`, `src/env.ts`.
3. **Establish Quality Gate Scripts:**
   * `scripts/check-project-docs.mjs` + `scripts/check-project-docs.test.ts`.
   * Wire `npm run check` to run: lint, typecheck, unit tests, and doc check across all packages.
4. **Commit Discipline:**
   * Exact TDD sequence: failing test -> observed failure -> minimal implementation -> passing test -> verification.
   * Update `docs/PROJECT_SNAPSHOT.md` after each accepted task.

---

## 6. Verification Checklist Before First Commit

Before marking Task 1 complete, verify:
* `npm run check` passes cleanly.
* `git diff --check` has no whitespace or EOF errors.
* `git status --short` shows no untracked clutter.
* Seat tokens and secret keys are nowhere in logs, URLs, or projections.
