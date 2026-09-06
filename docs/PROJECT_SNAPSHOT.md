# Cipher Party Project Snapshot

**Snapshot revision:** 8

**Last updated:** 2026-09-05

**Project state:** Task 5 role-safe client projections with strict Zod schemas, compile-time negative assertions, and allowlist builder completed. Ready for Task 6.

**Active milestone:** Milestone 1 — Connected Classic

**Active plan:** docs/superpowers/plans/2026-08-30-connected-classic.md

**Roadmap:** docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md

**Approved spec:** docs/superpowers/specs/2026-08-30-cipher-party-design.md

## What we are building

A private, account-free multiplayer association game for 4–16 active players on phones and laptops. The MVP uses a server-authoritative Cloudflare room, role-safe views, text/picture/mixed theme packs, Classic and Blitz rules, two to four teams, and best-of-3/5/7 campaigns.

## Current delivery boundary

Milestone 1 delivers a deployable two-team Classic game with:

- Account-free room creation and invite-code joining.
- Host, clue-giver, operative, and spectator roles.
- A deterministic 5×5 text board.
- Authoritative clue, nomination, reveal, turn, win, and loss transitions.
- Role-specific projections that structurally omit the hidden key.
- A bounded public action history containing public results only.
- Browser-local reconnect tokens and Durable Object persistence.
- A 24-hour inactivity alarm that closes sockets and clears room storage.
- A responsive phone/laptop lobby and game board.

Milestone 1 does not deliver the pack builder, image uploads, AI suggestions, Blitz, multi-team variants, campaigns, TV mode, accounts, or public packs.

## Architecture snapshot

- React + TypeScript DOM client.
- Cloudflare Worker HTTP and WebSocket gateway.
- One SQLite-backed Durable Object per room.
- Pure deterministic rules in packages/game-core.
- Validated commands and role projections in packages/protocol.
- Pack schemas will be isolated in packages/pack-format when Milestone 2 introduces that package.
- R2 and Workers AI are introduced in Milestone 2, not Milestone 1.

## Non-negotiable safety boundaries

- Clients send commands, never replacement game state.
- The server persists before broadcasting accepted actions.
- Operative, non-clue-giver host, and spectator projections cannot represent unrevealed ownership.
- Room codes locate rooms but do not authorize privileged actions.
- Seat and host tokens stay out of URLs and logs.
- The shipped app contains no unlicensed franchise art.

## Work ledger

- **Last accepted implementation task:** Task 5 — Role-safe client projections.
- **Current task:** Task 5 complete; ready for Task 6.
- **Next task after selection:** Task 6 — Authoritative room aggregate and lobby rules.
- **Blocked by:** Nothing.

## Verified baseline

- Design commit: ba2c612.
- Scaffold commit: 1fa7df2.
- Canonical agent instructions, snapshot, roadmap, active plan, and approved spec all exist and cross-link.
- The Connected Classic plan contains 13 ordered tasks and 112 TDD checklist steps (Tasks 1, 2, 3, 4, and 5 complete: 37/37 steps verified).
- Commands verified passing: `pnpm run check:docs`, `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`, `WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME=$PWD/.wrangler pnpm exec wrangler deploy --dry-run --config apps/worker/wrangler.jsonc`, `git diff --check`.

## Decisions agents must preserve

- Package manager: Use `pnpm` (v11 with pnpm workspaces, strict isolation, and build script allowlists) for supply chain security.
- Working title and directory: Cipher Party / cipher-party.
- Cloudflare-native hosting and realtime architecture.
- The current Cloudflare Workers test integration is @cloudflare/vitest-plugin; do not restore the superseded pool configuration.
- Responsive website first, PWA-ready structure, no offline match behavior.
- External voice chat.
- Host-owned local/exported packs; temporary server copies expire after 24 hours.
- AI generates text suggestions only; hosts provide permitted images.
- Clue-givers rotate only between campaign boards.
- Multi-team hazard behavior eliminates the team that revealed it.
- Canonical invite URLs come from validated server configuration, never the incoming Host header.
- Aesthetic theme: Neo 8-Bit Retro Arcade (Balatro + Celeste inspired).
- The Balatro Rule: Pixel fonts (Press Start 2P) for arcade chrome/HUD/badges only; ultra-crisp bold modern sans (Plus Jakarta Sans) for card words.
- 16 Collectible Monopoly-Style Arcade Tokens for player nomination stamps; team mascot crests for card reveals.
- Quad-Indicator colorblind accessibility (Hue, Glyph, Texture, Semantic label).
- Synthesized Web Audio API 8-bit sound effects (zero external sound files).
- Gameplay board modes locked to 3 explicit host options: (1) Text-based only (25 words), (2) Image-based only (25 pictures), (3) Combination text and images (50/50 mixed board).
- Board randomization & anti-memorization: 3-tier independent seed derivation (crypto.getRandomValues -> seed + '/cards', '/grid-order', '/ownership', '/starting-team') with decoupled keycard assignments (9/8/7/1) and a 50-image minimum starter pool for Pictures Only mode (yielding >1.26e14 unique 25-card boards).

## Known risks

- Hidden-data leakage through overly broad serialization.
- Reconnect races causing duplicate reveals or lost seats.
- Durable Object alarm and hibernation behavior diverging between local and deployed environments.
- Mobile readability for later 5×6 and 6×6 boards.
- AI and image-pack scope accidentally leaking into Milestone 1.

## Snapshot update protocol

After each reviewed task, the coordinator:

1. Increments the snapshot revision.
2. Updates project state, current task, next task, and blockers.
3. Records the exact repository-wide verification commands that passed.
4. Adds only decisions that future agents must preserve.
5. Removes stale status instead of appending a diary.
6. Commits the snapshot with the task or in the immediate review-fix commit.
