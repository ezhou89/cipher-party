# Cipher Party — Scaffolding Handoff & Situational Analysis

**Handoff Date:** 2026-09-05  
**From:** Antigravity (Creative Design & UI Architecture Agent)  
**To:** Antigravity / Codex (Scaffolding & Milestone 1 Implementation Agent)  
**Active Plan:** `docs/superpowers/plans/2026-08-30-connected-classic.md`  
**Approved Spec:** `docs/superpowers/specs/2026-08-30-cipher-party-design.md`  
**Design System:** `docs/DESIGN_SYSTEM.md`  
**Living Snapshot:** `docs/PROJECT_SNAPSHOT.md` (Revision 3)

---

## 1. Situational Analysis & Project Context

### Current Status

- **Phases Completed:** Visual Identity, Neo 8-Bit Retro Arcade Design System, Interactive UI Prototypes, 700-Card Vocabulary Universe, Image Card System Architecture & Nanobanana Pipeline, and Cyclomatic Complexity Audit.
- **Current Delivery Boundary:** Milestone 1 — Connected Classic (2-team, 5×5 classic text board, host, clue-givers, operatives, spectators, ticketed WebSockets over SQLite-backed Cloudflare Durable Objects).
- **Future-Proofing Prepared for Milestone 2:** Pure data models and card rendering interfaces structurally support Text, Image, and Mixed modes without refactoring the core board state machine.
- **Codebase State:** Immaculate baseline; clean `git status`; design tokens compiled at `apps/web/src/styles/tokens.css`; zero high-complexity functions ($M > 10$) across the architecture.

### Key Invariants Locked with the User

1. **The "Balatro" Hybrid Typography Rule:**
   - **Arcade Chrome & HUD:** `Press Start 2P` exclusively for timers, scores, round marquees, and action buttons.
   - **Card Words:** High-contrast, ultra-crisp bold modern sans (`Plus Jakarta Sans` uppercase, tracked) on `#fbf6ec` cartridge cardstock. No pixel fonts on 5×5 cards to eliminate eye fatigue.
2. **16 Collectible Monopoly-Style Arcade Tokens:**
   - Players select a signature piece in the pre-match lobby (`🎩` Top Hat, `🏎️` Racecar, `👑` Crown, `🗡️` Sword, `💎` Gem, `🚀` Rocket, `👾` Invader, `🕹️` Joystick, `⚡` Bolt, `🍒` Cherry, `👻` Ghost, `🍄` Shroom, `💣` Bomb, `🦆` Duck, `🍕` Pizza, `🦖` Dino).
   - Operative piece sits on nominated cards with a 1UP halo. Team mascot crest seals revealed cards.
3. **Quad-Indicator Colorblind Accessibility:**
   - Every card state and team identity is marked via four redundant channels: **Primary Hue**, **Pixel Glyph** (`♥`, `✦`, `▲`, `⬢`), **Border/Texture**, and **Semantic Text Label**.
4. **Pure Web Audio API Sound Effects:**
   - Square/triangle/sawtooth synthesized retro audio; 100% self-contained with zero external sound asset dependencies.
5. **Server-Authoritative Role Safety:**
   - Operatives, host-only, and spectators **never** receive unrevealed card ownership. The key is structurally omitted by server projections (`packages/protocol`).

---

## 2. Gameplay Modes & Content Universe

### The 3 Board Gameplay Modes

The host selects one of three distinct gameplay modes in the lobby:

1. **Words Only (`words`):** Classic 25-word text board. Ultra-crisp typography, fast parsing, maximum accessibility.
2. **Pictures Only (`pictures`):** 25-image board. High visual intrigue, rich multi-element associative cues, algebraic chess coordinate callouts.
3. **Mixed (`mixed`):** 50/50 split (13 text / 12 images or 12 text / 13 images) randomly distributed across the 5×5 grid. Cross-modal association matches words to visual scenes.

### Content Universe (700 Unique Cards)

The deck is mathematically verified with 0 duplicate words across all decks:

- **Core Deck ("Common Ground"):** 200 universal everyday words spanning dual-meaning nouns, actionable verbs, sensory adjectives, and spatial terms (documented in artifact `core_pack_master_wordlist.md`).
- **5 Thematic Expansions (100 cards each = 500 total):** Original archetypes avoiding unlicensed franchise artwork (documented in artifact `expansion_packs_wordlists.md`):
  1. _Neo-Tokyo Cyber-Anime:_ Mecha, neon streets, spirit shrines, slice-of-life tropes.
  2. _K-Pop Wave (Idols & Standom):_ Comebacks, lightsticks, choreography, trainee lore.
  3. _Retro 16-Bit & Nostalgia Arcade:_ Cartridges, speedruns, boss phases, CRT scanlines.
  4. _90s Saturday Morning & Afterschool Cartoons:_ Breakfast cereals, mutant pets, skateboards, secret treehouses.
  5. _Emerald Citadel Superhero Comics & Villains:_ Vigilantes, secret origins, mutagen vats, moon bases.

### Image Card Architecture & Nanobanana Pipeline

- **5-Layer Prompt Compiler:** Subject Scene + Style Modifier (Painterly Graphic Fantasy, textured gouache/matte cel) + Composition & Lighting + Strict Game Safety Exclusions (no text, numbers, logos, UI borders) + Aspect Ratio (`4:5`).
- **4:5 Aspect Ratio & Safe Zones:**
  - Top-Left: Reserved for algebraic cell coordinate badge (`A1`–`E5`).
  - Top-Right: Reserved for card index badge (`#01`–`#25`).
  - Center: Core illustrative focal subject (always within 80% inner circle).
  - Bottom-Center: Reserved for player nomination tokens (`🎩`, `🏎️`, etc.) and reveal crests.
- **Frictionless Voice Chat Support:** Algebraic coordinates (`A1`–`E5`) embedded directly on every board cell to eliminate ambiguity during operative voice discussions (e.g. "Nominating C3" instead of "that picture of the cat in the attic").
- **Tap-to-Inspect Lightbox Drawer:** Single-tap expands an image card into an edge-to-edge modal drawer with pan/zoom and screen-reader accessibility description.
- **Screen-Reader Parity:** Every picture card requires a semantic text description (`altText`) for blind and low-vision accessibility.

### Board Randomization Architecture & Anti-Memorization Guarantees

To prevent players from memorizing boards, card patterns, or team assignments across matches:

1. **Cryptographic 3-Tier Seed Derivation:**
   - Server generates a 256-bit entropy seed via `crypto.getRandomValues(new Uint8Array(32))`.
   - **Tier 1 (Pool Sampling):** `seed + "/cards"` shuffles the master deck via Fisher-Yates and samples 25 cards.
   - **Tier 2 (Grid Permutation):** `seed + "/grid-order"` permutes the 25 cards across spatial coordinates `A1` through `E5` ($25! \approx 1.55 \times 10^{25}$ arrangements).
   - **Tier 3 (Keycard Decoupling):** `seed + "/ownership"` generates the 9/8/7/1 team key completely independently from card identities or content. A card is never fixed to a specific team across matches.
   - **Starting Team:** `seed + "/starting-team"` derives red vs. blue starting turn.
2. **Replayability Math & Anti-Memorization Thresholds:**
   - **Words Only Deck:** 200 Core words yields $\binom{200}{25} \approx 6.5 \times 10^{29}$ distinct 25-card boards (650 octillion).
   - **Mixed Deck (50/50):** 200 words + 50 images yields $\binom{200}{13} \times \binom{50}{12} \approx 2.7 \times 10^{35}$ distinct boards.
   - **Pictures Only Deck:** 50-image starter deck yields $\binom{50}{25} \approx 1.26 \times 10^{14}$ distinct 25-card boards (126 trillion combinations). This completely prevents players from seeing the same 25 pictures across matches.
3. **Continuous Cryptographic Seed Rotation:**
   - When a match concludes and the host begins a new match, the Durable Object mints a brand-new cryptographic seed. No card positions or key distributions persist between rounds.

---

## 3. Monorepo Architecture & Package Topology

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

- `apps/web` ──imports──> `packages/protocol` ONLY. (NEVER import `game-core` or server reducers into the client).
- `apps/worker` ──imports──> `packages/protocol` AND `packages/game-core`.
- `packages/protocol` ──imports──> `packages/game-core` (domain types only).
- `packages/game-core` has **zero external runtime dependencies**.

### Card Domain Models (`packages/game-core` & `packages/protocol`):

```typescript
export type BoardMode = "words" | "pictures" | "mixed";

export interface BaseCard {
  id: string;
  coordinate: string; // e.g. "A1", "B3"
  index: number; // 0..24
  revealed: boolean;
  nominations: string[]; // player token symbols e.g. ["🎩", "🚀"]
}

export interface TextCard extends BaseCard {
  kind: "text";
  word: string;
}

export interface ImageCard extends BaseCard {
  kind: "image";
  imageUrl: string;
  altText: string;
}

export type Card = TextCard | ImageCard;
```

---

## 4. Prototype to Production Component Translation Matrix

All interactive HTML prototypes located in the artifacts directory translate 1:1 into planned React components in `apps/web`:

| Prototype Screen / Artifact       | Planned React Component in `apps/web`  | Key Subcomponents & Responsibilities                                                                                   |
| :-------------------------------- | :------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| **`arcade_lobby.html`**           | `src/features/lobby/LobbyScreen.tsx`   | `RoomCodeBadge`, `TeamRosterColumn`, `RoleToggleBar`, `TokenSelectionModal`, `BoardModeSelector`, `LaunchMatchButton`  |
| **`stitch_game_board.html`**      | `src/features/game/GameBoard.tsx`      | `HudHeader`, `TurnClueMarquee`, `CardGrid5x5`, `ActionDeck`                                                            |
| **`image_card_system_demo.html`** | `src/features/game/cards/`             | `<CardChrome>`, `<TextCardBody>`, `<ImageCardBody>`, `<CardRevealOverlay>`, `<NominationBadge>`, `<CardInspectDrawer>` |
| **`clue_giver_view.html`**        | `src/features/game/ClueGiverView.tsx`  | `PrivacyVeil`, `SpotlightFilterTabs`, `KeyGrid5x5`, `ClueTransmissionStation`                                          |
| **`round_end_victory.html`**      | `src/features/game/VictoryFanfare.tsx` | `VictoryMarquee`, `SeriesPipsTracker`, `HighlightsReel`, `PostMatchMiniBoard`, `SpymasterRotationNotice`               |
| **Web Audio Synthesizer**         | `src/hooks/useSoundFx.ts`              | Shared hook managing `AudioContext`, coin jingles, blips, saw waves, and mute toggle                                   |
| **`tokens.css`**                  | `src/styles/tokens.css`                | Production CSS variables for colors, pixel corners, and button press physics                                           |

---

## 5. Cyclomatic Complexity Audit Findings

- **Overall Score (Image & Board System Audit):**
  - **Low Complexity ($M \le 5$):** 91.7% (22/24 functions)
  - **Moderate Complexity ($M \le 10$):** 8.3% (2/24 functions)
  - **High Complexity ($M > 10$):** **0.0% (0/24 functions)**
  - **Average Complexity ($\bar{M}$):** 2.9
- **Key Architecture Guidance:**
  - **Never build a monolithic `<Card>` component:** Splitting into `<CardChrome>`, `<CardBody>` (`<TextCardBody>` vs `<ImageCardBody>`), `<CardRevealOverlay>`, and `<NominationBadge>` drops complexity from $M=36$ to $M \le 3$.
  - **Dictionary Lookup Maps:** Use `CREST_CONFIG[card.state]` and `MODE_LABEL_MAP[mode]` instead of branching chains.
  - **Pure Functional Reducers:** Reducers in `packages/game-core` delegate to single-purpose pure helpers (`applyNomination`, `resolveReveal`, `checkWinCondition`).

---

## 6. Milestone 1 Scaffolding Execution Plan

Execute Task 1 from `docs/superpowers/plans/2026-08-30-connected-classic.md`:

### Step-by-Step Task 1 Checklist:

1. **Scaffold Root Workspace Configuration:**
   - Create root `package.json` (npm workspaces: `["apps/*", "packages/*"]`).
   - Create `tsconfig.base.json`, `eslint.config.js`, `prettier.config.js`, `.prettierignore`.
   - Create `vitest.config.ts` and `playwright.config.ts`.
2. **Scaffold Package Workspaces:**
   - `packages/game-core`: `package.json`, `tsconfig.json`, `src/index.ts`.
   - `packages/protocol`: `package.json`, `tsconfig.json`, `src/index.ts`.
   - `apps/web`: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/styles/globals.css`.
   - `apps/worker`: `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.jsonc`, `wrangler.dev.jsonc`, `src/index.ts`, `src/env.ts`.
3. **Establish Quality Gate Scripts:**
   - `scripts/check-project-docs.mjs` + `scripts/check-project-docs.test.ts`.
   - Wire `npm run check` to run: lint, typecheck, unit tests, and doc check across all packages.
4. **Commit Discipline:**
   - Exact TDD sequence: failing test -> observed failure -> minimal implementation -> passing test -> verification.
   - Update `docs/PROJECT_SNAPSHOT.md` after each accepted task.

---

## 7. Verification Checklist Before First Commit

Before marking Task 1 complete, verify:

- `npm run check` passes cleanly.
- `git diff --check` has no whitespace or EOF errors.
- `git status --short` shows no untracked clutter.
- Seat tokens and secret keys are nowhere in logs, URLs, or projections.
