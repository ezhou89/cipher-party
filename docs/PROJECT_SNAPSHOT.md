# Cipher Party Project Snapshot

**Snapshot revision:** 21

**Last updated:** 2026-09-11

**Project state:** The reviewed integration is deployed to staging from `e780d60`, with source/version/bindings/security/hash attestation passing. Live browser smoke exposed blocked analytics injection and a dynamic-evaluation probe; investigation is underway before the handoff can be called verified. The four-human playtest remains NOT YET RUN.

**Active milestone:** Milestone 1 — Connected Classic

**Active plan:** docs/superpowers/plans/2026-09-07-creative-integration.md

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

- **Last accepted implementation task:** Integration Task 3 — staging hardening and reproducible deployment, `96e381e`; independent review found no Critical/Important code issue.
- **Current task:** Integration Task 4 — whole-branch review, verified staging update, and human playtest handoff.
- **Next task:** Four-human Connected Classic exit session, then Milestone 2 planning.
- **Current blockers:** Live public browser smoke reports CSP-related console/request errors despite successful UI checks. Keep the restrictive CSP; investigate Cloudflare analytics injection and the bundled validator's dynamic-evaluation probe. The milestone exit still requires four real humans. **Human playtest: NOT YET RUN.**

## Current integration evidence

- Task 1 independently reviewed; both fix findings addressed with no new breakage.
- `creative/manifest.json` inventories 26 byte-preserved originals; the coordinator independently matched every archive/source checksum and byte length.
- `docs/CREATIVE_HANDOFF.md` separates approved direction, draft content, prototype behavior, and a reusable future creative-submission template. Content remains 700 draft rows / 682 unique labels; the runtime still uses its 50-word fixture.
- `pnpm install --frozen-lockfile`, `pnpm run check` (439 tests before the additional portability regression), `pnpm run build`, and `pnpm run preflight` (8/8 rows) passed.
- Review fix: `pnpm exec vitest run scripts/preflight.test.ts` passed 35/35; real preflight passed 8/8 with all seven expiry identities; all three Worker-local schema references resolved; focused lint/format/diff-check passed.
- The reviewed dependency resolutions remain unchanged under pnpm. Known non-blocking tooling notices: Node DEP0040 and Wrangler's update notice.
- `ROOMS` namespace continuity is verified at `f2766441dfa24d10bef55dd8ee4f5599` (`RoomDurableObject`, migration `v1`).

- Task 2 independently reviewed; the geometry fix addressed its sole Important finding with no new breakage.
- `pnpm run check:release` passed on `6ffad0f`: 441 repository tests (core 68, protocol 95, web 120, Worker 120, root 38), builds/dry run, 8/8 preflight rows with seven expiry identities, and 36/36 Chromium/WebKit tests.
- Final public-only desktop/320px visual QA passed 2/2; coordinator inspected representative captures. Built-in words and nomination cues fit, and keyboard/cancel/focus/reduced-motion checks passed.
- Review fix `8c34a6f` added committed value-free one-line/no-clipping checks for all 25 phone labels. Restoring faulty font/spacing failed both browsers; final styling passed both focused five-client flows (2/2), lint, format, and diff-check.
- Root `@cipher-party/protocol: workspace:*` devDependency restores existing E2E imports under isolated pnpm; no external resolutions changed. Known test-runner color-environment notice is non-blocking.

- Task 3 independently reviewed at `96e381e`; whole-branch review found no Critical/Important issue. Final fix `e780d60` addressed three test/documentation minors and passed scoped re-review; upstream tooling notices are accepted nonblocking.
- Implementer fresh September 11 `pnpm run check:release` passed 525 repository tests (core 68, protocol 95, web 123, Worker 159, root 80), builds, 8/8 preflight with seven expiry identities, and 36/36 browser tests. `pnpm run deploy:staging --dry-run` passed with the existing room class and five admission limiters; no deployment occurred.
- Controller rerun passed docs/format/lint/types and core/protocol/web tests, then reported three Cloudflare runner-startup timeouts (67 Worker tests completed). Lingering teardown was interrupted. One focused diagnostic passed all 39 staging tests in 3.70s with clean teardown; the exact startup cause remains unproven. No test settings or dependencies were changed.
- Root's unchanged full release rerun on `d6dc022` passed all 525 repository tests, builds, 8/8 preflight with seven expiry identities, and 36/36 browser tests. No startup timeout recurred. Final `e780d60` changed tests/docs only; root reran 42/42 staging script tests, docs/format/diff checks, and a clean-source staging dry run successfully.
- Tracked deployment of source `e780d60891601e554255fc3608876c188825c9ef` produced Worker version `aa78dd0c-54f5-4ef5-a647-606c1d8e7ab1`. Explicit `check:staging` passed version at 100%, original room namespace, eight bindings, transport/health/headers, and three built HTML/JS/CSS hashes.
- Live public smoke remains FAILED: desktop/mobile landing and invite UI/viewport checks passed and four screenshots were inspected, but Chromium reported two console/two request errors and WebKit four console errors. No rooms or sockets were created. Diagnostics identified CSP-blocked Cloudflare analytics injection and a lazy `Function` availability probe with a `jitless` guard. Exact remediation is still under investigation; do not allow third-party scripts or unsafe-eval merely to silence errors.
- Controller independently rechecked all 26 archive/source/manifest checksums and byte lengths on September 11.

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
- Staging admission uses five stable Cloudflare rate bindings: create 10/min/IP, joins 60/min/IP and 120/min/room, tickets 120/min/IP and 240/min/room. Keys are hashed and purpose-scoped; all applicable counters settle before room access. Counters are location-local/eventually consistent, not globally exact. Local HTTP tests omit these bindings.
- Use tracked `deploy:staging` and read-only `check:staging`; preserve the existing Worker, room namespace, class, and migration. Live attestation checks version/source/traffic/bindings and every built HTML/JS/CSS hash. No apex, paid-plan, R2, or AI change belongs to this integration.
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
