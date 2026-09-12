# Cipher Party Project Snapshot

**Snapshot revision:** 30

**Last updated:** 2026-09-12

**Project state:** Creative integration and audit hardening Tasks 1–6 are complete and independently reviewed. Task 7’s whole-branch review and fresh release verification are complete with no open material findings. The hardening plan is complete; staging remains the previously verified `2c72751` because this plan does not deploy. The four-human playtest remains NOT YET RUN; Milestone 1 is still open.

**Active milestone:** Milestone 1 — Connected Classic

**Active plan:** docs/superpowers/plans/2026-09-11-audit-hardening.md

**Next execution:** Authorize and prepare the real four-human Connected Classic session using docs/runbooks/connected-classic-playtest.md. Before inviting players, build the exact source intended for staging and run the read-only staging attestation; deploy/live smoke remain separately authorized operations.

**Completed integration plan:** docs/superpowers/plans/2026-09-07-creative-integration.md — complete; do not restart Tasks 1–4.

**Original milestone plan:** docs/superpowers/plans/2026-08-30-connected-classic.md (historical implementation/review evidence).

**Current worktree:** `/Users/eugenezhou/Code/cipher-party/.worktrees/creative-integration`

**Creative source:** `main@128c0f7` plus identified Antigravity prototype/content directories. Preserve the original checkout and its untracked E2E drafts.

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

- **Last accepted task:** Hardening Task 7 — final handoff at `7746288` (with snapshot/plan completion at `92f77df`); implementation commits remain `db5b18e`, `08b2e358`, `4edd2ef` plus `378bcbec`, `df89864`, `39fb98f`, and `680000a`/`b54f048`.
- **Current task:** Hardening complete; Connected Classic human acceptance is the next milestone activity.
- **Next task:** Four-human connected Classic session, after the user separately authorizes any staging deployment/live smoke needed for that session.
- **Current blockers:** Hosted CI has no configured repository/provider, and the real four-human session has not been run. Milestone exit requires that session and resolution of any critical findings. **Human playtest: NOT YET RUN.**
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
- Task 7 completed the coordinator whole-branch review from `7142f5481e72c7e49d127e4877b4e7ee5502df1b` through `db5b18e71418a948149e15e0af872282730c2e0d`; accepted task reviews remain clean and no material finding is open. Fresh elevated `pnpm run check:release` passed 681 tests, complexity (445 functions, mean 3.38, maximum 34, four explicit exceptions), all five coverage floors, builds/local Worker dry run, preflight, and 48/48 local E2E. The unprivileged sandbox attempt failed only at the Worker listener/log boundary; the approved elevated rerun passed. `git diff --check` and `git status --short` are clean. No deploy/live smoke occurred. Deferred boundaries remain lost-join retry identity/seat and host replacement, hosted CI provider selection, browser/screen-reader/real-device and operational drills, and the still-pending four-human session.

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
- Deployed source: `2c727519a69347bd1b914d990f10bb6fa1c5724c`.
- Active version at 100%: `9d7bb74d-5eca-4e0a-8b01-da1ebcb206f2`.
- Preserved `ROOMS` namespace: `f2766441dfa24d10bef55dd8ee4f5599`; class `RoomDurableObject`, SQLite migration `v1`, compatibility date `2026-08-30`.

This snapshot's documentation-only commit is newer than the deployed runtime. Build matching source and pass explicit expectations for pre-session attestation; do not assume current Git HEAD is the deployed source:

```sh
pnpm run check:staging --expected-commit 2c727519a69347bd1b914d990f10bb6fa1c5724c --expected-version 9d7bb74d-5eca-4e0a-8b01-da1ebcb206f2 --expected-rooms-namespace f2766441dfa24d10bef55dd8ee4f5599
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
