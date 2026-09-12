# Cipher Party Project Snapshot

**Snapshot revision:** 34

**Last updated:** 2026-09-12

**Project state:** Creative integration and audit hardening are complete and independently reviewed. Multi-team Classic Tasks 1–2 (canonical teams/board geometry and reducer transitions) are implemented and review-clean through `aded8f9`; protocol/Worker migrations are intentionally pending. After explicit deployment authorization, the guarded release is live and attested on staging at the current reviewed source; the apex was not changed. The four-human playtest remains NOT YET RUN; Milestone 1 is still open.

**Active milestone:** Milestone 1 — Connected Classic (multi-team expansion in progress)

**Active plan:** docs/superpowers/plans/2026-09-12-multi-team-classic.md

**Next execution:** Begin Task 3 (protocol v2 and projection contract) of docs/superpowers/plans/2026-09-12-multi-team-classic.md. The current two-team staging build remains the regression reference; the existing four-human gate and the new eight-player four-team gate follow implementation and fresh verification.

**Completed integration plan:** docs/superpowers/plans/2026-09-07-creative-integration.md — complete; do not restart Tasks 1–4.

**Original milestone plan:** docs/superpowers/plans/2026-08-30-connected-classic.md (historical implementation/review evidence).

**Current worktree:** `/Users/eugenezhou/Code/cipher-party/.worktrees/creative-integration`

**Creative source:** `main@128c0f7` plus identified Antigravity prototype/content directories. Preserve the original checkout and its untracked E2E drafts.

**Roadmap:** docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md

**Approved spec:** docs/superpowers/specs/2026-08-30-cipher-party-design.md

**Approved multi-team spec:** docs/superpowers/specs/2026-09-12-multi-team-design.md

## What we are building

A private, account-free multiplayer association game for 4–16 active players on phones and laptops. The MVP uses a server-authoritative Cloudflare room, role-safe views, text/picture/mixed theme packs, Classic and Blitz rules, two to four teams, and best-of-3/5/7 campaigns.

## Current delivery boundary

The current deployed/runtime baseline is a deployable two-team Classic game with:

- Account-free room creation and invite-code joining.
- Host, clue-giver, operative, and spectator roles.
- A deterministic 5×5 text board.
- Authoritative clue, nomination, reveal, turn, win, and loss transitions.
- Role-specific projections that structurally omit the hidden key.
- A bounded public action history containing public results only.
- Browser-local reconnect tokens and Durable Object persistence.
- A 24-hour inactivity alarm that closes sockets and clears room storage.
- A responsive phone/laptop lobby and game board.

The current runtime does not yet deliver the pack builder, image uploads, AI suggestions, Blitz, multi-team variants, campaigns, TV mode, accounts, or public packs. The approved next slice is a single-board Classic expansion for host-selected 2-, 3-, or 4-team rooms; Blitz, campaigns, packs, picture/mixed cards, and licensed content remain out of scope for that slice.

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

- **Last accepted task:** Task 2 — multi-team reducer and transition metadata at `aded8f9`; prior runtime/hardening evidence remains in the commits and records below, and staging source is unchanged.
- **Current task:** Tasks 1–2 accepted; preparing Task 3.
- **Next task:** Execute Task 3 (protocol v2 and projection contract) from `docs/superpowers/plans/2026-09-12-multi-team-classic.md`.
- **Current blockers:** The repository-wide typecheck remains intentionally blocked by the planned v2 protocol/Worker migrations in Tasks 3–4; hosted CI has no configured repository/provider; the real four-human two-team session has not been run; the eight-player four-team session cannot run until implementation and deployment are authorized. Milestone exit requires the human gates and resolution of any critical findings. **Human playtests: NOT YET RUN.**
- **Audit baseline:** 445 tracked runtime functions; classic mean 3.38 after Task 6, maximum 34, 26 above 10, and exactly four approved exceptions above 20. GameWorkspace fell 36→10 and applyGameAction 30→18; both exceptions were removed. Remaining exceptions are permissionsFor 34, authorize 24, ModerationPanel 21, and applyLobbyCommand 21. Confirmed terminal/throttled reconnect retry loop and scratch-only lint failure. Do not treat historical release evidence below as a fresh passing gate on the current workspace until Task 7 reruns it.

## Current hardening evidence

- Task 1 restored the Git/ESLint scratch boundary and validates the snapshot's actual active-plan target. `pnpm run check` passed **542 repository tests** (core 68 / protocol 95 / web 124 / Worker 161 / root 94). The coordinator separately reran the 46 focused docs/hygiene/preflight tests successfully.
- Tracked `smoke:staging:public` discovers four public route/browser cases and stays outside local e2e discovery. It blocks socket creation and unsafe methods/origins/queries; a shared zero-redirect transport helper prevents redirects from contacting forbidden destinations. Eight local Chromium/WebKit policy regressions passed after meaningful RED; lint, types and diff checks passed. The tracked live smoke itself has not been run.
- No hardening deployment, merge, push, or future-milestone feature is authorized by this plan. Hosted CI awaits a repository/provider; four-human acceptance remains pending.
- Task 2 preserves durable credentials and exact in-flight command envelopes across transient reconnect; permanent 401/404/1008/expiry failures clear projections and expose local recovery copy. 429 Retry-After and 1013 overload cooldown are bounded and tested; explicit forget/rejoin is still the only credential deletion path.
- Task 3 bounds valid upgrades before Durable Object lookup, caps live socket inventory at four per seat/64 per room, caps outstanding unexpired tickets at eight per seat/256 per room, and applies stable purpose-scoped native command budgets (30/10s per seat, 120/10s per room) before frame parsing. Failed/replayed commands resync only their sender; accepted revision changes broadcast. Focused Worker tests passed 129/129; staging fixtures 47/47; `pnpm run check` passed 588 tests; local e2e 48/48; build, preflight 8/8, and diff checks passed. Counters are location-local/eventually consistent, and capacity denial may consume a one-use ticket; no deployment/live smoke occurred.
- Task 4 validates complete v1 room snapshots before controller use, rejects unsupported/corrupt storage without writing, clearing, migrating, exposing details, or allowing initialization over it, and restores null-prototype card maps. Presence is reconciled from OPEN serialized attachments on load and later room events; repairs preserve `lastActivity`, retry after failed writes, and never run for over-budget or protocol-invalid frames. Focused resilience tests passed 133/133; `pnpm run check` passed 643 tests; local e2e 48/48; diff checks passed. Lost successful join responses still allocate a second seat on retry; retry-safe identity and replacement remain deferred. No deployment/live smoke occurred.
- Task 5 adds tracked-runtime classic complexity measurement with stable file/function identities, exactly six explicit exceptions, and a >20 new-function gate; inline complexity waivers cannot suppress inventory. All five Vitest scopes use separate Istanbul reports and measured whole-number S/B/F/L floors: game-core 97/96/100/97, protocol 96/94/100/96, web 91/87/91/91, Worker 93/91/98/93, root 80/77/92/80. Source-bound `pnpm run deploy:staging` now requires clean exact SHA → full `check:release` → same clean SHA → low-level `expectedCommit`; direct low-level live CLI refuses and dry-run remains non-uploading. The optional clean gate clones without hardlinks, frozen-installs, runs only the inner release gate, and removes its task-owned checkout. Focused tooling/staging tests passed 76/76; full release gate passed 672 tests, builds/preflight, and local E2E 48/48; the separate real clean-checkout gate passed. No deployment/live smoke, hosted CI, or human playtest occurred.
- Task 6 extracted typed private reducer clue/reveal handlers, pure game availability derivation, and a single identity/projection-scoped confirmation hook. Transport gating remains separate from intent validity so reconnect keeps Cancel/focus recovery while disabling destructive sends; clue-giver keys remain outside the hook. Focused reducer/UI tests passed 57/57 and 71/71; full release gate passed 681 tests, unchanged coverage floors, builds/preflight, and local E2E 48/48. Classic GameWorkspace fell 36→10 and applyGameAction 30→18, removing both exceptions. No deployment/live smoke or human playtest occurred.
- Task 7 completed the coordinator whole-branch review from `7142f5481e72c7e49d127e4877b4e7ee5502df1b` through `db5b18e71418a948149e15e0af872282730c2e0d`; accepted task reviews remain clean and no material finding is open. Fresh elevated `pnpm run check:release` passed 681 tests, complexity (445 functions, mean 3.38, maximum 34, four explicit exceptions), all five coverage floors, builds/local Worker dry run, preflight, and 48/48 local E2E. The unprivileged sandbox attempt failed only at the Worker listener/log boundary; the approved elevated rerun passed. After explicit user authorization, guarded deployment of source `290e8d05d847f2ba80e2625a13222134fe4927ba` completed; read-only staging attestation passed at 100% version `27df01fb-da1f-4e20-8944-a667dba560a4`, and artifact-free public smoke passed 4/4 across desktop Chromium and 320px mobile WebKit. `git diff --check` and `git status --short` were clean before deployment. Deferred boundaries remain lost-join retry identity/seat and host replacement, hosted CI provider selection, browser/screen-reader/real-device and operational drills, and the still-pending four-human multiplayer session.

## Current multi-team implementation evidence

- Task 1 (`8a90cc0`, with implementation `cb5b173`) centralizes the four canonical team slots, exact 2/3/4-team Classic board specifications, deterministic `/cards`/`/grid-order`/`/ownership`/`/starting-team` streams, dynamic 25/30/36-card generation, copied board metadata, and starter validation. Focused game-core tests passed **95/95** with package typecheck; protocol tests/typecheck passed **95/95** as a compatibility check. The repository-wide typecheck is not yet a passing gate because Tasks 3–4 must migrate v1 protocol/snapshot contracts. Task review found and accepted the starter validation fix; no finding remains open.
- Task 2 (`aded8f9`) adds immutable multi-team reducer transitions, configured-team turn rotation that skips eliminations, generalized challenges/target completion, atomic hazard elimination/target-to-neutral conversion, and `GameTransitionEvent` metadata while preserving the state-only `applyGameAction` API and two-team hazard loss. Game-core coverage passed **108/108** with package typecheck; task review found no findings. Repository-wide typecheck remains pending the v2 protocol/Worker migrations.

## Historical integration evidence

- Tasks 1–3, whole-branch review, the three-minor final fix wave, and the subsequently discovered live-CSP fix all completed independent review. No findings remain open. Detailed history is retained in the integration plan and Git.
- `creative/manifest.json` inventories 26 byte-preserved originals; the coordinator independently rechecked every source/archive checksum and byte length on September 11. `docs/CREATIVE_HANDOFF.md` supplies approved-versus-draft status and a reusable Gemini submission template. Content remains 700 draft rows / 682 unique labels; the runtime still uses its 50-word fixture.
- `pnpm install --frozen-lockfile` passed with reviewed external resolutions unchanged. Root's declared protocol development link and web's direct already-bundled Zod dependency make existing imports explicit under isolated pnpm.
- Arcade presentation and independent board-selection/order/ownership streams are integrated. Public desktop/320px visual inspection and committed all-25-label geometry/nomination regressions passed; restoring the old cramped styling failed both browser regressions as expected.
- The coordinator's fresh `pnpm run check:release` on exact source `2c72751` passed: docs, format, lint, all types, **533 repository tests** (core 68 / protocol 95 / web 124 / Worker 161 / root 85), builds/local Worker dry run, **8/8 preflight rows** with seven exact expiry identities, and **40/40 Chromium/WebKit cases** in 57.8 seconds. These include the existing multiplayer/privacy harness and four production-CSP landing/invite cases.
- Live-CSP regressions observed the old bundle fail before the fix. HTML-only `no-transform`, browser-shaped attestation requests, and early browser Zod `jitless` initialization fixed the actual causes without weakening CSP or parsing. Header, injected-HTML mismatch, no-`Function`, strict parsing, and production-bundle browser regressions passed; independent review found no Critical/Important/Minor issue.
- `pnpm run deploy:staging` deployed the reviewed source below. Explicit `pnpm run check:staging` passed authenticated source/version/100% traffic, the original room namespace, eight bindings, transport/health/security headers, and all three built HTML/JS/CSS SHA-256 comparisons.
- Final read-only public smoke passed **2/2** in 8.1 seconds with `pnpm exec playwright test --config .superpowers/sdd/2026-09-07-creative-integration/staging-smoke.config.ts`: desktop Chromium and 320px mobile WebKit checked landing/invite HTML against the local build, UI, focus, viewport, and zero CSP/console/page/request/response errors. No rooms or sockets were created; this is not a live multiplayer or human-session claim.
- Four final public landing/invite screenshots in `.superpowers/sdd/2026-09-07-creative-integration/staging-screenshots/` were separately captured and visually inspected. Playwright 1.62.1 WebKit screenshot capture itself injects an inline animation-synchronization stylesheet, which the intended CSP blocks. Visual capture is separate from the zero-error smoke; no errors are filtered or assertions weakened.
- Original `main@128c0f7` with its preexisting untracked E2E drafts and clean `connected-classic@fe264e3` remain untouched. Keep `feature/creative-integration` and its worktree/scratch evidence; no merge, push, apex, zone/account, paid-plan, R2, or AI change was made.
- Four-human runbook results remain **PENDING / NOT YET RUN**.

## Verified staging deployment

- URL: `https://staging.oddlyuseful.studio`; Worker: `cipher-party-staging`.
- Deployed source: `290e8d05d847f2ba80e2625a13222134fe4927ba`.
- Active version at 100%: `27df01fb-da1f-4e20-8944-a667dba560a4`.
- Preserved `ROOMS` namespace: `f2766441dfa24d10bef55dd8ee4f5599`; class `RoomDurableObject`, SQLite migration `v1`, compatibility date `2026-08-30`.

This snapshot's documentation-only commits are newer than the deployed runtime. Build matching source and pass explicit expectations for pre-session attestation; do not assume current Git HEAD is the deployed source:

```sh
pnpm run check:staging --expected-commit 290e8d05d847f2ba80e2625a13222134fe4927ba --expected-version 27df01fb-da1f-4e20-8944-a667dba560a4 --expected-rooms-namespace f2766441dfa24d10bef55dd8ee4f5599
```

## Historical reviewed baseline

The original milestone plan and Git history retain detailed Task 1–13 implementation/review evidence. Reviewed source is `fe264e3`; its release gate passed 439 repository tests, 36 browser tests, and eight preflight rows before this integration.

Historical staging version `bc8b1dc2-0e65-4748-bdc6-5a5e49ddbf94` is a continuity/rollback reference only. Current staging is the integrated version above at `https://staging.oddlyuseful.studio`. The apex was not changed.

## Decisions agents must preserve

- Working title and directory: Cipher Party / cipher-party.
- Cloudflare-native hosting and realtime architecture.
- pnpm 11 workspaces with portable local dependency resolution; subprocess tools launch through Node/local JS entrypoints, not bare command shims.
- Board membership, grid order, and ownership use independent `/cards`, `/grid-order`, and `/ownership` seed streams; retain duplicate rejection, null-prototype card map, stable IDs, and starting-team distribution.
- Arcade presentation uses local/system fonts, warm word cards, redundant Ruby/Red and Cobalt/Blue identity, and public-only scores. Keep committed 320px nomination/word geometry checks.
- Staging rejects noncanonical hosts, redirects canonical HTTP app requests to HTTPS, and rejects insecure APIs without redirecting credentials. All-request Worker-first asset serving applies the response policy; successful WebSocket upgrades remain intact.
- HTML responses use `Cache-Control: no-store, no-transform` to opt out of injected body content without changing zone settings. Keep API/credential no-store behavior, JS/CSS policy, and the restrictive same-origin CSP; never add unsafe-eval or external analytics scripts to silence violations.
- Web's first side-effect import initializes the directly declared, already-bundled Zod with `jitless: true` before App/router/protocol schema evaluation. Preserve strict parsing and the Worker/protocol API; retain no-Function and real production-CSP regressions.
- Staging admission uses nine stable Cloudflare rate bindings: create 10/min/IP, joins 60/min/IP and 120/min/room, tickets 120/min/IP and 240/min/room, valid connects 120/min/IP and 240/min/room, plus command frames 30/10s/seat and 120/10s/room. Keys are hashed and purpose-scoped; all applicable counters settle before room access or frame work. Counters are location-local/eventually consistent, not globally exact. Local HTTP tests omit these bindings; HTTPS missing/error/denial fails closed and local HTTP remains supported.
- Use tracked `deploy:staging` and read-only `check:staging`; preserve the existing Worker, room namespace, class, and migration. Live attestation checks version/source/traffic/bindings and every built HTML/JS/CSS hash, with browser-navigation-like headers for HTML. No apex, paid-plan, R2, or AI change belongs to this integration.
- The current Cloudflare Workers test integration is @cloudflare/vitest-plugin; do not restore the superseded pool configuration.
- The shared TypeScript library is ES2022-only; only apps/web adds DOM and DOM.Iterable libraries.
- Responsive website first, PWA-ready structure, no offline match behavior.
- External voice chat.
- Host-owned local/exported packs; temporary server copies expire after 24 hours.
- AI generates text suggestions only; hosts provide permitted images.
- Clue-givers rotate only between campaign boards.
- The approved multi-team Classic slice uses host-selected 2/3/4 teams with canonical ordered slots `red`, `blue`, `green`, `yellow`; two teams remain the default.
- Multi-team hazard behavior eliminates only the active team, converts its unrevealed targets to neutral, skips it in future turns, and awards the board only when one team remains; two-team hazard loss remains unchanged.
- New room/projection contracts are v2; valid v1 two-team snapshots normalize to v2 defaults without a SQLite migration.
- A multi-team hazard is one accepted command, one revision, and one public `card_revealed` history entry with optional `eliminatedTeam` metadata.
- The multi-team increment stays React DOM/CSS and text-only; no Phaser/canvas, Blitz, campaigns, packs, picture/mixed cards, or licensed content is pulled forward.
- Preserve the existing four-human two-team regression gate and add a separate eight-active-player four-team gate before claiming social validation.
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
- The local human exit gate uses four real humans and four genuinely distinct host-local browser profiles named A–D, with exactly one assigned window each and Profile B at 320×780 CSS pixels. The authorized distributed-device gate may use one browser/device per participant at `https://staging.oddlyuseful.studio`; never use the apex or improvise LAN exposure.

## Known risks

- Non-blocking upstream notices remain: Node DEP0040 from Wrangler's bundled dependencies, its update notice, and Playwright's inherited NO_COLOR/FORCE_COLOR warning. One earlier Cloudflare test-runner startup timeout did not recur in unchanged or final full release reruns; its exact cause is unproven. No dependencies, timeout settings, or warning filters were changed to hide it.
- Keep WebKit screenshot-tool stylesheet injection separate from application CSP diagnostics, as described in the current evidence; production/live zero-error gates must still catch genuine app violations.
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
