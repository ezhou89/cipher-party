# Cipher Party Project Snapshot

**Snapshot revision:** 16

**Last updated:** 2026-09-14

**Project state:** Browser Task 11 remains complete. Native iOS Tasks 1–9 are
implemented and reviewed, and Task 10 release-readiness verification is
complete for the local build/test surface. The native client branch is ready
for coordinator task review and final whole-branch review.

**Active milestone:** Milestone 1 — Connected Classic, with the approved native
iOS online companion extension

**Active plan:** docs/superpowers/plans/2026-09-13-ios-online-client.md

**Browser plan:** docs/superpowers/plans/2026-08-30-connected-classic.md

**Roadmap:** docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md

**Approved specs:**

- docs/superpowers/specs/2026-08-30-cipher-party-design.md
- docs/superpowers/specs/2026-09-13-ios-online-client-design.md

## What we are building

A private, account-free multiplayer association game for 4–16 active players on phones and laptops. The MVP uses a server-authoritative Cloudflare room, role-safe views, text/picture/mixed theme packs, Classic and Blitz rules, two to four teams, and best-of-3/5/7 campaigns.

The current iOS extension is a native SwiftUI 17+ online client for the same
rooms. It is intended for groups standing together while each person uses a
phone, and it must interoperate with the browser client through protocol v1.

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

The native iOS extension now delivers the first online implementation slice:
account-free create/join, QR/Universal Link/manual-code entry, device-only
Keychain credentials, role-safe lobby and Classic board views, and bounded
online reconnect/read-only cache UX. It reuses protocol v1 and the browser's
Cloudflare room authority; no nearby/offline match is included.

## Architecture snapshot

- React + TypeScript DOM client.
- Cloudflare Worker HTTP and WebSocket gateway.
- One SQLite-backed Durable Object per room.
- Pure deterministic rules in packages/game-core.
- Validated commands and role projections in packages/protocol.
- Pack schemas will be isolated in packages/pack-format when Milestone 2 introduces that package.
- R2 and Workers AI are introduced in Milestone 2, not Milestone 1.
- Native iOS lives in apps/ios and consumes the existing HTTP/WebSocket protocol;
  it does not carry a second game engine or authoritative state.

## Non-negotiable safety boundaries

- Clients send commands, never replacement game state.
- The server persists before broadcasting accepted actions.
- Operative, non-clue-giver host, and spectator projections cannot represent unrevealed ownership.
- Room codes locate rooms but do not authorize privileged actions.
- Seat and host tokens stay out of URLs and logs.
- The shipped app contains no unlicensed franchise art.
- iOS durable seat/host credentials stay in device-only Keychain storage; the
  short-lived WebSocket ticket is never logged.
- Network loss is read-only cached presentation plus reconnect, never an offline
  local match.

## Work ledger

- **Last accepted implementation task:** Task 9 — Mixed-client integration,
  resilience, and security hardening.
- **Native iOS spec commit:** `9c1d68a` — native iOS online-client design.
- **Current task:** Task 10 release-readiness handoff is complete and ready for
  coordinator review; its final code-review checkbox remains pending.
- **Next task:** Final whole-branch review, then decide whether to open a PR from
  `feature/ios-online-client`.
- **Deployment follow-ups:** `https://oddlyuseful.studio` currently serves the
  unrelated studio site (`/api/health` returned 404), so no staging create/join
  or signed Universal Link smoke is claimed. A registered Apple App ID/team,
  Worker routing at the canonical host, and a signed-device pass remain.

## Verified baseline

- Design commit: ba2c612.
- Scaffold commit: 1fa7df2.
- Canonical agent instructions, snapshot, roadmap, active plan, and approved spec all exist and cross-link.
- The Connected Classic plan contains 13 ordered tasks and 112 TDD checklist steps (Tasks 1–11 complete: 93/93 steps verified).
- Native iOS Tasks 1–9 are accepted in the implementation ledger with focused
  Swift, Worker, browser, and fixture evidence; role-safe projections, token
  handling, reconnect reconciliation, invite routing, lobby, board, and mixed
  client/privacy seams are covered.
- Passing iOS commands: Debug and Staging `xcodebuild ... build`, Debug and
  Staging `xcodebuild ... test` on the iPhone SE (3rd generation) iOS 18.2
  simulator, and Debug/Staging `build-for-testing` with signing disabled.
- Passing repository commands: `pnpm run check` (24 fixture tests, 22
  game-core tests, 46 protocol tests, 53 web tests, 41 Worker tests, root test,
  formatting, lint, and typecheck), `node scripts/check-project-docs.mjs`, and
  `git diff --check`.
- `pnpm run test:e2e` was attempted but is blocked by the current Playwright
  readiness URL using `127.0.0.1:5173` while Vite listens on
  `localhost:5173`; no E2E pass is claimed. This is a test-harness/environment
  follow-up, not an iOS protocol failure.

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
- Native iOS uses SwiftUI Observation on iOS 17+, Foundation URLSession WebSockets,
  Network framework path hints, Core Image QR generation, AVFoundation scanning,
  and Keychain; no third-party runtime dependency is required for the first slice.
- iOS online rooms reuse protocol v1 and remain account-free; Universal Links,
  QR/manual code entry, and redacted app-private projection cache are the join
  and reconnect seams.
- True no-signal peer-to-peer play is a separate future subsystem and is not
  implemented or implied by the iOS online client.
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
- Staging deployment still needs the Cipher Party Worker routed at
  `oddlyuseful.studio` with the matching `CANONICAL_ORIGIN`, dynamic/static AASA,
  and registered Apple App ID/team before signed-device smoke.
- A physical device is still needed for camera, Universal Links, share sheets,
  background/foreground, Dynamic Type, dark mode, and VoiceOver visual evidence.

## Snapshot update protocol

After each reviewed task, the coordinator:

1. Increments the snapshot revision.
2. Updates project state, current task, next task, and blockers.
3. Records the exact repository-wide verification commands that passed.
4. Adds only decisions that future agents must preserve.
5. Removes stale status instead of appending a diary.
6. Commits the snapshot with the task or in the immediate review-fix commit.
