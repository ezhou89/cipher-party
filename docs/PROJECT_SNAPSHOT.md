# Cipher Party Project Snapshot

**Snapshot revision:** 3

**Last updated:** 2026-08-30

**Project state:** Task 1 is accepted. The npm workspace, React and Worker shells, locked dependencies, canonical-document gate, and executable quality commands are in place; Task 2 is ready.

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

- **Last accepted implementation task:** Task 1 — repository scaffold and executable quality gate at accepted head `9b7bc9a` (`b9b0cd9` scaffold plus `9b7bc9a` review fix).
- **Current task:** Task 2 — domain IDs and validated command protocol.
- **Next task after review:** Task 3 — deterministic Classic board generator.
- **Blocked by:** Nothing.

## Verified baseline

- Design commit: `ba2c612`; planning/drift-control commit: `628e11a`.
- Task 1 commits: `b9b0cd9` and review fix `9b7bc9a`.
- `npx vitest run scripts/check-project-docs.test.ts`: 1 file, 2 tests passed.
- `npx vitest run scripts/tsconfig-libraries.test.ts`: 1 file, 1 test passed.
- `npm run check`: passed docs, formatting, lint, all workspace typechecks, and tests; root Vitest reported 2 files and 3 tests passed.
- `npm run build`: passed package typechecks, the web production build, and Worker dry-run build.
- `npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc`: passed without deploying.
- `npm test`: passed; empty workspace suites use their planned temporary `--passWithNoTests` flags until their first test tasks.
- `git diff --check`: passed with no output before the accepted commits.

## Decisions agents must preserve

- Working title and directory: Cipher Party / cipher-party.
- Cloudflare-native hosting and realtime architecture.
- The current Cloudflare Workers test integration is @cloudflare/vitest-plugin; do not restore the superseded pool configuration.
- The shared TypeScript library is ES2022-only; only apps/web adds DOM and DOM.Iterable libraries.
- Responsive website first, PWA-ready structure, no offline match behavior.
- External voice chat.
- Host-owned local/exported packs; temporary server copies expire after 24 hours.
- AI generates text suggestions only; hosts provide permitted images.
- Clue-givers rotate only between campaign boards.
- Multi-team hazard behavior eliminates the team that revealed it.
- Canonical invite URLs come from validated server configuration, never the incoming Host header.

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
