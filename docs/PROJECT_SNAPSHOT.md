# Cipher Party Project Snapshot

**Snapshot revision:** 11

**Last updated:** 2026-08-30

**Project state:** Tasks 1–9 are accepted. Ticket-authenticated hibernating WebSockets now deliver per-seat role-safe projections, authoritative command results, race-safe presence/reconnect behavior, IndexedDB credentials, and a generation-guarded browser reconnect client; Task 10 is ready.

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

- **Last accepted implementation task:** Task 9 — hibernating WebSockets and browser reconnect client at accepted head `4f4ea4f` (`29e1255` implementation plus `4f4ea4f` review fix).
- **Current task:** Task 10 — landing, join, and authoritative lobby UI.
- **Next task after review:** Task 11 — role-aware Classic game board UI.
- **Blocked by:** Nothing.

## Verified baseline

- Design commit: `ba2c612`; planning/drift-control commit: `628e11a`.
- Task 1 commits: `b9b0cd9` and review fix `9b7bc9a`.
- Task 2 commit: `f42a84e`.
- Task 3 commits: `6dd73d7` and review fix `bd49324`.
- Task 4 commit: `79a9c3b`.
- Task 5 commits: `c6a7d18` and review fix `1e8b7af`.
- Task 6 commits: `143e8a7` and review fix `2562415`.
- Task 7 commit: `de27e83`.
- Task 8 commits: `f0ac58c` and review fix `fc49865`.
- Task 9 commits: `29e1255` and review fix `4f4ea4f`.
- `npx vitest run scripts/check-project-docs.test.ts`: 1 file, 2 tests passed.
- `npx vitest run scripts/tsconfig-libraries.test.ts`: 1 file, 1 test passed.
- `npm run check`: passed docs, formatting, lint, all workspace typechecks, and tests; root Vitest reported 2 files and 3 tests passed.
- `npm run build`: passed package typechecks, the web production build, and Worker dry-run build.
- `npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc`: passed without deploying.
- `npm test`: passed; empty workspace suites use their planned temporary `--passWithNoTests` flags until their first test tasks.
- `git diff --check`: passed with no output before the accepted commits.
- `npm run test -w @cipher-party/game-core`: 1 file, 2 tests passed.
- `npm run test -w @cipher-party/protocol`: 1 file, 37 tests passed.
- `npm run typecheck -w @cipher-party/protocol`: passed.
- Task 2 `npm run check`: passed; root and workspace suites reported 42 tests total with no failures.
- `npm run test -w @cipher-party/game-core -- board.test.ts`: 1 file, 11 tests passed after review fix.
- Task 3 `npm run check`: passed; game-core 13, protocol 37, and root 3 tests passed (53 total).
- `npm run test -w @cipher-party/game-core -- reducer.test.ts`: 1 file, 54 tests passed.
- `npm run test -w @cipher-party/game-core`: 3 files, 67 tests passed.
- Task 4 `npm run check` and `npm test`: 107 tests passed across game-core, protocol, and root suites.
- `npm run test -w @cipher-party/protocol -- projections.test.ts`: 1 file, 53 tests passed.
- `npm run typecheck -w @cipher-party/protocol`: passed with compile-time negative projection assertions.
- Task 5 `npm run check`: 160 tests passed across game-core, protocol, and root suites.
- `npm run test -w @cipher-party/worker -- room-session.test.ts`: 1 file, 50 tests passed after review fix.
- `npm run typecheck -w @cipher-party/worker`: passed.
- Task 6 `npm run check`: 210 tests passed across Worker, game-core, protocol, and root suites.
- `npm run test -w @cipher-party/worker -- room-durable-object.test.ts`: 1 file, 14 tests passed.
- Task 7 Worker suite: 2 files, 64 tests passed.
- Task 7 `npm run check`: passed documentation, formatting, lint, every workspace typecheck, and 224 tests with no failures.
- Task 7 `npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc`: passed without deploying and recognized `ROOMS` as `RoomDurableObject`.
- Task 7 `git diff --check`: passed with no output.
- `npm run test -w @cipher-party/worker -- auth.test.ts rooms-api.test.ts`: 2 files, 40 tests passed after review fixes.
- Task 8 Worker suite: 4 files, 104 tests passed.
- Task 8 `npm run check`: passed documentation, formatting, lint, every workspace typecheck, and 264 tests with no failures.
- Task 8 `npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc`: passed without deploying and recognized `ROOMS` as `RoomDurableObject`.
- Task 8 `git diff --check`: passed with no output.
- Task 9 focused suites: protocol transport 5 tests, Worker WebSocket 14 tests, and web credential/reconnect 16 tests passed after review fixes.
- Task 9 full suites: protocol 95 tests, Worker 118 tests, and web 16 tests passed.
- Task 9 `npm run check`: passed documentation, formatting, lint, every workspace typecheck, and 299 tests with no failures.
- Task 9 `npm run build`: passed package/app typechecks, the Vite production build, and the Worker Wrangler dry-run without deploying.
- Task 9 `git diff --check`: passed with no output.

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
- The complete-`RoomState` initializer remains a trusted internal/test-only overload; browser routes accept only the strict Task 8 bootstrap DTO and never replacement state.
- Room-code input must be six original ASCII alphanumeric characters before Crockford uppercasing and O/I/L alias mapping; Unicode case expansion is never accepted.
- Connection tickets are hash-only, one-use, and exact-60-second credentials; issue and consume writes are public-revision-neutral but must persist before returning success.
- WebSocket admission orders persisted ticket consumption before accept/attach, then persists `markConnected` before the first projection and 101 response; attachments contain only connectionId, playerId, and hostAuthority.
- Every accepted socket receives a separately derived current-seat projection; disconnect marks a seat offline only after its last open socket and never extends lastActivity.
- Durable credentials live only in IndexedDB and HTTP headers; reconnect attempts and callbacks are generation-guarded and retain the same idempotent in-flight envelope until authoritative resync.

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
