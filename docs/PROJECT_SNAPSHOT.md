# Cipher Party Project Snapshot

**Snapshot revision:** 15

**Last updated:** 2026-08-31

**Project state:** Tasks 1–12 are accepted. Task 13's release preflight and local/playtest documentation are independently approved at pre-human head `4a7911c`; the required four-human Connected Classic session is the current exit gate, and no human result has been recorded yet.

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

- **Last accepted implementation task:** Task 12 — multiplayer browser E2E and hidden-data regression at accepted head `7badb94` (`3b16324` implementation plus review fixes `130f408`, `6305f54`, `935a30c`, and `7badb94`).
- **Current task:** Task 13 Step 5 — run and record the four-human Connected Classic playtest from `docs/runbooks/connected-classic-playtest.md`.
- **Next task after playtest:** Fix any critical defect through a failing regression, rerun the final exit gate, close Connected Classic, and hand off to Milestone 2 Pack Studio planning.
- **Blocked by:** Four real humans completing the reviewed host-local session with four distinct browser profiles and one assigned window per profile. **Human playtest: NOT YET RUN.**

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
- Task 10 commits: `2022230` and review fix `abd09bc`.
- Task 11 commits: `a98f4f3` and review fixes `bcc1e11`, `6e30668`.
- Task 12 commits: `3b16324` and review fixes `130f408`, `6305f54`, `935a30c`, `7badb94`.
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
- Task 10 focused Home/Lobby suites: 2 files, 38 tests passed after review fixes.
- Task 10 full web suite: 4 files, 54 tests passed.
- Task 10 `npm run check`: passed documentation, formatting, lint, every workspace typecheck, and 337 tests with no failures.
- Task 10 `npm run build`: passed package/app typechecks, the Vite production build, and the Worker Wrangler dry-run without deploying.
- Task 10 cumulative and fix-only `git diff --check`: passed with no output.
- Task 11 focused GameView suite: 1 file, 65 tests passed after review fixes.
- Task 11 full web suite: 5 files, 119 tests passed.
- Task 11 `npm run check`: passed documentation, formatting, lint, every workspace typecheck, and 402 tests with no failures.
- Task 11 `npm run build`: passed package/app typechecks, the Vite production build, and the Worker Wrangler dry-run without deploying.
- Task 11 cumulative and fix-only `git diff --check`: passed with no output.
- Task 12 focused security regressions: 7/7 passed in Chromium; HomePage repeat-error focus: 9/9 passed.
- Task 12 `npm run test:e2e -- --project=chromium`: 18/18 passed.
- Task 12 `npm run test:e2e`: 36/36 passed across Chromium and WebKit Mobile, including the isolated five-client full-board flow.
- Task 12 `npm run check`: passed documentation, formatting, lint, every workspace typecheck, and 403/403 tests (web 120, Worker 118, game-core 67, protocol 95, root 3).
- Task 12 `npm run build`: passed package/app typechecks, the Vite production build, and Worker dry-run build.
- Task 12 `npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc`: passed without deploying and resolved four web assets plus the expected Durable Object/environment bindings.
- Task 12 cumulative and fix-only `git diff --check`: passed with no output; tracked status was clean. Public-only desktop and 320px screenshots were visually inspected in both browser projects, and the generated test artifact contained only a passing `.last-run.json`.
- Task 13 pre-human commits: `8911dc7` and review fixes `ccd71ce`, `ab71958`, `4a7911c`.
- Task 13 `npx vitest run scripts/preflight.test.ts`: 34/34 passed; the real Worker Durable Object integration file passed 16/16.
- Task 13 `npm run preflight`: all eight rows passed and required exactly seven named, passed expiry identities, including literal 24-hour duration and future-safe test anchoring.
- Task 13 `npm run check:release`: passed 439 repository tests (web 120, Worker 120, game-core 67, protocol 95, root 37), all builds, seven required expiry identities, and 36/36 Playwright tests across Chromium and WebKit Mobile.
- Task 13 standalone Worker dry-run, full/direct lint, formatting, cumulative/fix `git diff --check`, and tracked status passed. Independent disposable mutations proved that a 23-hour production TTL and a skipped future-anchor identity each fail only the Room expiry preflight row.

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
- Landing and invite flows persist server-canonical credentials before navigation; route/unmount generations guard every asynchronous join and credential-recovery continuation so stale work cannot reclaim current UI, navigation, or socket ownership.
- The lobby renders authoritative projections only, maps command failures to exhaustive local public copy, disables commands while pending or reconnecting, and uses one restrained polite region for other-seat presence transitions.
- Public game roles never read a clue-giver key or infer hidden target denominators; only the default-closed clue-giver branch can mount per-card key indicators, while revealed ownership remains public.
- Reveal and End Turn confirmation use one identity-scoped, projection-validated modal owner. Local Cancel remains available during reconnect, with enabled-trigger focus return or an explicit Turn status fallback; destructive confirmation remains transport-gated.
- Game announcements use allowlisted public data and compose simultaneous reveal, turn/phase, and board-result changes without making the 25-card grid live.
- Every received room WebSocket frame in the E2E privacy harness receives a persistent value-free outcome before strict schema handling; public raw projections are recursively audited before parsing, and later valid frames cannot erase earlier violations.
- The credential/hidden-data E2E spec disables automatic trace and screenshot capture. Explicit screenshots use public roles only, and clue-giver-derived target labels, IDs, and positions stay inside caught page-side interactions with fixed value-free diagnostics until the authoritative reveal makes them public.
- Release preflight reads one immutable snapshot of all three Wrangler JSONC configs, rejects Milestone 2 bindings at root and `env.*` scopes, and requires seven exact real expiry-test identities; count-only or skipped-test substitution is not accepted.
- The no-deploy human exit gate uses four real humans and four genuinely distinct host-local browser profiles named A–D, with exactly one assigned window each and Profile B at 320×780 CSS pixels. Physical multi-device testing requires a separately authorized HTTPS staging deployment and must not be improvised through LAN exposure.

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
