# Audit Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the actionable Connected Classic audit gaps without changing game rules or opening future milestones.

**Architecture:** Preserve the React DOM client, authoritative Worker/Durable Object, pure reducer, and allowlisted projections. Add bounded recovery/admission policies and runtime storage validation at their existing boundaries. Make release evidence reproducible and prevent complexity regressions before extracting cohesive existing logic.

**Tech Stack:** Existing Node 22+, pnpm 11, TypeScript, React, Cloudflare Workers, Vitest, ESLint, and Playwright. The only planned new development dependency is matching `@vitest/coverage-istanbul` 4.1.11; no new production dependency.

**Spec:** docs/superpowers/specs/2026-08-30-cipher-party-design.md, especially §§10–13 and 15–16; user-approved September 11 audit recommendations. This is current-milestone defect/assurance work, not the full Milestone 4 recovery system.

## Global Constraints

- The server is authoritative; clients send commands, never replacement state.
- Persist accepted state changes before broadcasting; preserve command idempotency, revision checks, and generation-guarded reconnect.
- Unrevealed ownership is structurally absent from operative, host-only, and spectator projections.
- Durable seat and host tokens stay out of URLs, logs, test artifacts, and public projections.
- Keep the current v1 persistence shape and existing rooms compatible; reject unsupported/corrupt snapshots without overwriting or deleting them.
- No new game modes, pack features, seat replacement, grace-pause, accounts, or external voice implementation.
- Preserve creative provenance, original checkouts, and prior plan scratch evidence. One implementation task at a time in the existing creative-integration worktree.
- Local tests must not contact staging. Public staging smoke is separately invoked, read-only, and creates no rooms or sockets.
- No deployment, merge, push, paid-plan, apex, account/zone, R2, or AI change is part of this plan.
- Four-human acceptance remains NOT YET RUN until real participants complete the existing runbook.
- New runtime functions must stay at or below classic cyclomatic complexity 20; do not grow the six existing exceptions. Extract cohesive policy boundaries, not score-only fragments.

## Audit disposition

Tasks below address release hygiene, terminal/throttled reconnect, resource budgets, snapshot compatibility, coverage/complexity measurement, deployment gating, and the two highest-value refactors. Lost join responses and disconnect-write failure receive concrete fault evidence and an explicit recovery disposition in Task 4; do not invent a credential protocol or full seat-replacement subsystem. Hosted CI awaits a repository/provider destination; strengthen the provider-neutral local gate now. Screen-reader/real Android/Firefox/forced-colors coverage and operational alert/rollback drills remain named Milestone 4 acceptance work, not silently completed claims.

### Task 1: Restore the artifact boundary and track public staging smoke

**Files:** Modify `eslint.config.js`, `package.json`, `scripts/check-project-docs.mjs`, `scripts/check-project-docs.test.ts`, `scripts/preflight.test.ts` (canonical active-plan fixture only), `docs/runbooks/connected-classic-playtest.md`; create `staging/public-smoke.spec.ts`, `playwright.staging.config.ts`, `scripts/release-hygiene.test.ts`.

**Interfaces:** `verifyProjectDocs(root)` must validate the actual `**Active plan:**` link in the snapshot, not require the historical plan by a hardcoded substring. Add `smoke:staging:public` invoking the dedicated Playwright config; default `test:e2e` remains local. Coordinator owns snapshot and this plan, not the implementer.

Review refinement: create `staging/public-smoke-transport.ts` and local `e2e/public-smoke-policy.spec.ts` to test the transport boundary. Use `route.fetch({maxRedirects: 0})`, reject/count any redirect before browser fulfillment, and preserve allowed response bytes/headers/status. `route.continue()` alone is insufficient because redirected requests bypass routing. Local browser regressions must prove no redirected destination is contacted; do not run live staging for this test.

- [x] **Step 1: Add regression tests and observe RED.** Extend temporary documentation fixtures to include a new valid active plan and an old plan elsewhere in the snapshot; missing active target must reject. Add an ESLint Node API test proving scratch is ignored and the tracked smoke is not; test explicit smoke script/config isolation. Example assertions:

```ts
expect(await eslint.isPathIgnored(".superpowers/sdd/example/helper.ts")).toBe(true);
expect(await eslint.isPathIgnored("staging/public-smoke.spec.ts")).toBe(false);
await expect(verifyProjectDocs(rootWithMissingActivePlan)).rejects.toThrow();
```

Run `pnpm exec vitest run scripts/check-project-docs.test.ts scripts/release-hygiene.test.ts` and retain meaningful failures.
- [x] **Step 2: Implement the boundary.** Add `.superpowers/**` to flat ESLint ignores. Parse a single canonical relative `docs/superpowers/plans/*.md` active-plan path, reject traversal/absolute/missing/multiple active declarations, and verify its existence. Leave old plan evidence untouched.
- [x] **Step 3: Implement the tracked public smoke.** Use two projects: desktop Chromium and 320×780 mobile WebKit. Check landing and `/room/ABC123` public invite shell, same-origin GET/HEAD only, block WebSocket creation before connection, compare navigation HTML SHA-256 to `apps/web/dist/index.html`, check focus/narrow overflow and zero CSP/console/page/request/HTTP errors. Set trace/screenshots/video off; capture no credential artifacts. Production-CSP local tests remain separate. Update the runbook to the tracked opt-in command and warn that the local build must match the deployed source.

```ts
await page.routeWebSocket("**/*", (socket) => socket.close());
// Count attempted sockets as a smoke failure, even though the route blocks them.
```

- [x] **Step 4: Verify and commit.** Run the focused tests, `pnpm run check`, `pnpm exec playwright test --config playwright.staging.config.ts --list`, `git diff --check`. Do not run the live smoke in this task. Commit `fix: make release hygiene and public smoke reproducible` and report exact results.

Accepted Task 1 commits: `680000a`, `b54f048`. Initial meaningful RED: 8 documentation/hygiene failures; full check then exposed three legacy fixture failures, corrected without weakening assertions. `pnpm run check`: 542 repository tests; focused root tests 46/46. Independent review found a redirect-routing bypass; two loopback-browser regressions failed before the fix, then all eight Chromium/WebKit policy cases passed. Scoped re-review approved with no open findings. Lint, types, diff checks and four-case staging discovery passed after the fix. Live staging smoke was not run.

### Task 2: Make reconnect failure handling bounded and recoverable

**Files:** Modify `apps/web/src/lib/api.ts`, `api.test.ts`, `room-socket.ts`, `room-socket.test.ts`, `apps/web/src/features/lobby/useRoom.ts`, `RoomPage.tsx`, `LobbyView.test.tsx`; create `apps/web/src/lib/reconnect-policy.ts`, `reconnect-policy.test.ts` if policy extraction keeps the socket class focused.

**Interfaces:** Extend `ApiError` with optional `retryAfterMs: number | null`, maintaining existing construction defaults. Extend `RoomConnectionSnapshot` with optional `error?: RoomConnectionError | null`, where `RoomConnectionError` is the local union `credential_invalid | room_unavailable | room_expired | connection_rejected` (no raw server text). Terminal transport atomically advances generation, cancels timers/deadline, detaches socket, sets `connection: "closed"`, clears role projection/result/in-flight command, and publishes safe error; transient retries retain the exact serialized command envelope. `useRoom` owns exhaustive local copy, consumes terminal error and clears pending UI without waiting for result/projection convergence. Explicit user discard remains the only credential deletion path. Add an injected `now(): number` dependency and optional ticket-request clock argument with compatible defaults.

Retry header parsing accepts safe nonnegative integer seconds or canonical IMF-fixdate (finite parse, exact `toUTCString()` round-trip, not a past date); other strings fall back. Use `max(existingBackoff, retryAfterMs)` so a valid zero delay cannot cause a hot loop. Classify HTTP 401/404 by status even when the error body is malformed, while keeping user-facing text local.

- [x] **Step 1: Reproduce with failing fake-clock tests.** After one successful connection, make ticket fetch return 401 unauthorized or 404 room_unavailable; assert closed, no queued retry, no old projection, public recovery copy. For 429 with `Retry-After: 60`, assert no fetch before 60 seconds. Cover HTTP-date, malformed/negative/nonfinite retry headers, network/5xx backoff, initial failure, stale-generation callbacks, and terminal failure while a command is pending. Preserve all existing resend/privacy tests.

```ts
expect(snapshot.connection).toBe("closed");
expect(snapshot.projection).toBeNull();
expect(pendingTimers()).toHaveLength(0);
// For throttling: advance 59_999 ms -> no new ticket; final 1 ms -> one retry.
```

- [x] **Step 2: Implement classified recovery.** Recognized terminal 401/404 and policy close code 1008 stop automatic retry. Expiry close 1001 with exact locally defined `Room expired` reason stops retry; generic 1001 remains transient. Overload close 1013 is transient with a minimum 10-second cooldown (cover with fake-clock tests). 429 honors valid Retry-After delay; absent/invalid delay uses existing bounded exponential backoff. Clamp scheduling safely to the maximum platform timer and re-evaluate remaining absolute deadline rather than overflow into immediate retry. Use injected clock for deterministic HTTP-date tests. Never render server-supplied error text or delete stored credentials automatically.
- [x] **Step 3: Implement recovery UI regression.** A formerly mounted game/lobby losing terminal authorization must no longer show stale/key UI, pending controls must clear, and the explicit forget/rejoin path must remain reachable. Add a component test through the existing socket fixture; retain cancel/focus and live-region behavior.
- [x] **Step 4: Verify and commit.** Run focused web API/socket/lobby tests, `pnpm run check`, `pnpm run test:e2e`, and `git diff --check`. Commit `fix: stop terminal reconnect loops and honor throttling`.

Accepted Task 2 commit: `39fb98f`. Meaningful RED: 13 focused API/socket failures and one pending-recovery UI failure. GREEN: focused web tests 70/70, `pnpm run check` 567 tests, local e2e 48/48, diff check clean. Independent task review approved with no Critical/Important/Minor findings. Staging and human playtest remain unrun.

### Task 3: Bound upgrade, socket, and message amplification

**Files:** Modify `apps/worker/src/index.ts`, `env.ts`, `http/admission-limits.ts`, `http/rooms.ts`, `room/room-durable-object.ts`, `room/room-websocket.ts`, `apps/worker/test/staging.test.ts`, `room-websocket.test.ts`, `room-durable-object.test.ts`, `rooms-api.test.ts`, `apps/worker/wrangler.staging.jsonc`, `scripts/staging-common.mjs`, `scripts/check-staging.mjs`, `scripts/staging.test.ts`; create `apps/worker/src/room/connection-budget.ts` and focused tests. Keep local/test Wrangler configs without production rate bindings.

**Interfaces:** Extend admission kind with `connect`, using `CONNECT_BY_IP` 120/min and `CONNECT_BY_ROOM` 240/min, purpose-scoped hashed keys and all-settled semantics before Durable Object lookup. Live cap: 4 sockets per seat, 64 per room, counting OPEN/CLOSING resources until detached. Message budget uses native `COMMAND_BY_SEAT` 30 frames and `COMMAND_BY_ROOM` 120 frames per 10 seconds, enforced before parsing/dispatch; count malformed/rejected/exact-replay frames too. Use stable namespace IDs `2026091101` through `2026091104` respectively; preserve all existing IDs. Hash keys with origin/room/player and distinct purposes, settle both counters even if one denies/fails, fail closed on HTTPS with missing bindings. Local HTTP without bindings remains supported. These platform budgets are location-local/eventually consistent abuse limits, not exact global accounting. Close overloaded connection with 1013 and fixed public reason; no credential values. Keep attachments unchanged and never store counters in RoomState or write a room snapshot for a rejected frame.

- [x] **Step 1: Add RED budget and gateway tests.** Denied/failing/missing production connect limiters prevent namespace lookup. Exact cap permits the last allowed socket and rejects the next before accept; multiple tabs below cap still work. Frames denied by either dimension never reach command dispatch. Old attachments remain readable. Test concurrent upgrades, both frame counters settling, multiple sockets sharing a seat key, malformed/replayed frames, and re-instantiated objects using the same platform key rather than a fresh per-socket allowance.

```ts
expect(dispatchCountAfterOverBudget).toBe(dispatchCountAtLimit);
expect(otherSeatProjectionCountAfterRejectedCommand).toBe(before);
expect(requestingSeatReceivedFreshProjection).toBe(true);
```

- [x] **Step 2: Implement focused admission/budget helpers.** Keep ticket consumption and markConnected persistence ordering. The count/check/accept/attach critical section must be synchronous with no intervening await, or explicitly serialized if an await is unavoidable; simultaneous upgrades cannot exceed caps. Reject capacity without evicting existing sockets; ticket may already be consumed safely. After pruning expiry and authenticating the seat, cap outstanding tickets at 8 per seat and 256 per room; denied issuance returns the existing public `rate_limited` code with HTTP 429 and Retry-After 60. Do not delete unexpired tickets to make room, extend activity on denial, change credential shape, or reject otherwise valid older persisted snapshots merely for preexisting excess tickets (these expire normally). Retain hash-only v1 credentials and one-use semantics. Raise any compatibility ambiguity to coordinator before changing persisted/wire formats.
- [x] **Step 3: Restrict failed-command resync fanout.** Send command result and fresh role-safe projection to the requesting socket after stale/unauthorized/duplicate-no-state-change results; broadcast accepted revision-changing mutations only. Preserve duplicate resend completion behavior and monotonic projection sequence. Failed writes never become accepted state.
- [x] **Step 4: Update config attestation and verify.** Account for the four new bindings (12 total including origin, rooms, and assets) in strict staged config validation/fixtures and docs; do not deploy. Run focused Worker/root staging tests, `pnpm run check`, `pnpm run test:e2e`, `pnpm run build`, `pnpm run preflight`, and `git diff --check`. Commit `fix: bound realtime admission and message fanout`.

Accepted Task 3 commit: `df89864`. Meaningful RED covered malformed upgrade ordering, denied/failing/missing connect limiters, concurrent socket caps, frame-budget fanout, rehydrated Durable Objects, outstanding-ticket caps, and stale/unauthorized/duplicate resync. GREEN: focused Worker tests 129/129, staging tests 47/47, `pnpm run check` 588 tests, local e2e 48/48, build, preflight (8/8), and diff check. Independent task review approved with no Critical/Important/Minor findings. Native counters remain location-local/eventually consistent; capacity rejection safely consumes its one-use ticket. No staging deployment or live smoke was run.

### Task 4: Validate persisted snapshots and characterize recovery faults

**Files:** Create `apps/worker/src/room/room-snapshot.ts`, `apps/worker/test/room-snapshot.test.ts`, `docs/runbooks/room-recovery.md`; modify `room-storage.ts`, `room-durable-object.ts`, `apps/worker/test/room-durable-object.test.ts`, `room-websocket.test.ts`, `rooms-api.test.ts` as required by regression seams.

**Interfaces:** `parseRoomSnapshot(input: unknown): RoomState` validates supported schema/protocol versions and the complete v1 storage shape before controller installation. Reuse existing Zod dependency and public command/history schemas where valid; do not serialize hidden state into errors. `RoomStorage.read()` reads unknown then validates; unsupported/corrupt storage remains unchanged and admission fails opaque. Do not create a fictitious v2 migration.

- [x] **Step 1: Add RED compatibility tests.** Round-trip real lobby/playing/complete snapshots, pending tickets, and processed results. Reject unknown schema/protocol, malformed game/card/reveal shapes, broken seat/host references, invalid timestamps and inconsistent phase. Assert rejected load neither writes nor clears storage and never returns any projection/credentials. Keep tests using genuine production-generated state where possible.

```ts
expect(parseRoomSnapshot(structuredClone(validState))).toEqual(validState);
expect(() => parseRoomSnapshot({ ...validState, schemaVersion: 2 })).toThrow();
expect(storageWrites).toBe(0);
expect(storageClears).toBe(0);
```

- [x] **Step 2: Implement the validation boundary.** Distinguish absent snapshot from invalid snapshot; do not silently initialize over invalid existing data. Preserve v1 snapshots and the original serialized payload until any future real migration commits.
- [x] **Step 3: Add fault evidence and safe recovery disposition.** Inject a failed last-socket disconnect write and a lost successful join response followed by retry. Record what actually happens, including seat allocation and persisted presence. If offline presence can be safely reconciled from authoritative hibernating socket inventory without changing lastActivity or room rules, implement a bounded retry/reconciliation on the next room event with a regression. Do not retain raw credential receipts or silently redesign join admission; document retry-safe join identity as a prerequisite before automated join retries, plus current explicit user recovery limitations and future host replacement gate.
- [x] **Step 4: Verify and commit.** Run focused Worker resilience tests, `pnpm run check`, `pnpm run test:e2e`, `git diff --check`. Commit `fix: validate room snapshots and document recovery boundaries`.

Accepted Task 4 commit plus scoped fix: `4edd2ef`, `378bcbec`. Meaningful RED covered 39 initial snapshot/storage failures, corrupt-load admission, disconnect-write recovery, lost-join allocation, and invalid admitted-frame repair writes. The first review requested changes; reducer inspection confirmed real target/hazard board-complete states retain their clue, so synthetic null-clue completion remains correctly rejected. The fix moved reconciliation after protocol/actor validation and added no-write regressions. GREEN: focused Task 4 tests 133/133, `pnpm run check` 643 tests, local e2e 48/48, and diff checks. Independent scoped re-review approved with no Critical/Important/Minor findings. Invalid snapshots remain opaque and non-destructive; presence repair preserves `lastActivity` and retries on later events. No deploy/live smoke was run.

### Task 5: Establish measurable quality and source-bound release gates

**Files:** Create `scripts/check-complexity.mjs`, `scripts/check-complexity.test.ts`, `scripts/complexity-baseline.json`, `scripts/release-staging.mjs`, `scripts/release-staging.test.ts`, `scripts/check-clean-release.mjs`, `scripts/check-clean-release.test.ts`, `docs/runbooks/release-quality.md`; modify `package.json`, `pnpm-lock.yaml`, all five `vitest.config.ts` files (root plus four workspaces), `scripts/deploy-staging.mjs`, `scripts/staging.test.ts`, `.gitignore`.

**Interfaces:** `check:complexity` uses installed ESLint Node API classic complexity across tracked runtime TS/TSX, excludes test/spec/typecheck/helpers. Baseline keys identify file+function, not line numbers. Fail new functions over 20, increases over an existing cap, duplicate/missing/stale exemptions; report above 10. Existing exceptions: GameWorkspace 36, permissionsFor 34, applyGameAction 30, authorize 24, ModerationPanel 21, applyLobbyCommand 21. `test:coverage` uses Istanbul in all workspaces, separate report directories; risk-weighted numeric floors are derived from the fresh measurement and recorded exactly, never invented. Add both checks to `check:release` without causing ordinary test recursion.

- [ ] **Step 1: Add RED gate tests.** Synthetic functions test allowed baseline, cap increase, new over-limit, renamed/stale exception, nested function naming, and excluded files. Release orchestrator injections assert a failed gate prevents deploy, changed HEAD or dirt after gate prevents deploy, expected revision is passed through, and dry-run does not deploy. Verify exact source check remains after build.

```ts
await expect(runRelease({ gate: failingGate, deploy })).rejects.toThrow();
expect(deploy).not.toHaveBeenCalled();
// successful gate at commit S -> deploy({ expectedCommit: S }) only if still clean S
```

The old low-level script's direct CLI must no longer perform a live deployment: retain dry-run there, but direct live invocation must instruct the operator to use `pnpm run deploy:staging`. The exported injected low-level function requires `expectedCommit` for live use and remains callable by the guarded orchestrator/tests. Cover this boundary so the former familiar CLI is not an accidental gate bypass; do not claim protection from an operator deliberately invoking Wrangler or editing the source.

- [ ] **Step 2: Implement complexity measurement and baseline.** Count functions consistently with the audit; keep classic and optionally modified report output separate. Do not add file-wide waivers or score-only fragment extraction. Test harness uses injectable source/file lists instead of changing tracked source.
- [ ] **Step 3: Measure coverage and ratchet it.** Add exact compatible `@vitest/coverage-istanbul` 4.1.11 as development tooling, frozen lockfile update only for its required graph. Workers use instrumented Istanbul (V8 is unsupported there). Run all coverage suites, retain concise per-workspace branch/function/line/statement totals in the runbook, select floors at measured whole-number values (rounded down) for covered runtime scopes, and require these in the release command. Exclude generated/test/config/fixture code deliberately and disclose exclusions; do not raise claims from test counts alone.
- [ ] **Step 4: Bind deploy to the full gate.** `deploy:staging` points at a separate orchestrator: clean HEAD S → `check:release` → clean same S → low-level deploy with required expectedCommit S. No stored reusable pass token and no recursive gate from imported low-level functions. Run pnpm via absolute validated `npm_execpath`; JS entries use `process.execPath`, native absolute entries use execFile without shell; absent entry fails with an invoke-via-pnpm instruction. Existing local JS tool entrypoints stay unchanged. Gate subprocess timeout must accommodate the full release. Keep dry-run explicit and non-mutating. Add opt-in `check:release:clean`: capture clean committed source, clone this local repository into a task-owned mkdtemp checkout without hardlinks, detach at that exact SHA, frozen-install, run the inner `check:release` (never recurse into the wrapper), verify source/diff still exact. No remote/provider needed. Inject the subprocess seam and test wrong revision, frozen-install/gate failure, no deployment, exclusion of ignored/untracked input, and cleanup restricted to the exact created directory. Document required browser provisioning and useful failure evidence. Run the real clean-checkout command only after the task is committed; report it separately from ordinary gate evidence.
- [ ] **Step 5: Verify and commit.** Run focused tooling tests, `pnpm run check:release`, `pnpm install --frozen-lockfile`, and `git diff --check`. Commit `build: ratchet quality and require verified staging releases`. No live deploy.

### Task 6: Reduce the two highest-value complexity hotspots

**Files:** Modify `apps/web/src/features/game/GameView.tsx`, `GameView.test.tsx`, `packages/game-core/src/reducer.ts`, `reducer.test.ts`, `scripts/complexity-baseline.json`; create `apps/web/src/features/game/useGameConfirmation.ts`, `game-availability.ts` and focused tests only if needed for cohesive ownership.

**Interfaces:** The reducer keeps `applyGameAction(state, action)` public API and immutable/error semantics; extract typed private clue/reveal handlers. Game UI retains one identity-scoped, projection-validated modal owner with transport-gated confirmation, enabled Cancel during reconnect, and focus return/fallback. Extract pure availability derivation and the confirmation hook, not many one-line helpers. No game rule or permission change.

Use `GameBoard = NonNullable<ClientProjection["board"]>`. `deriveGameAvailability({roomPhase, board, permissions, connection, pending})` returns `transportDisabled`, `gameActionsDisabled`, `cardActionsAvailable`, `nominationEnabled`, `revealRequestEnabled`, and `endTurnRequestEnabled`. Keep transport gating distinct from authoritative intent validity so reconnect disables confirmation without dismissing its Cancel path. `useGameConfirmation({identity, roomPhase, board, permissions, availability, send})` returns `{dialog, handleCardAction, requestEndTurn}`. The hook owns one `reveal | end-turn | null` intent state, current-projection validation, and retirement of invalid intents; it never accepts or reads the clue-giver key. The workspace retains the focus fallback element and the single ConfirmDialog mount. Reducer helpers remain private:

```ts
function applySubmitClue(state: ClassicGameState, action: Extract<GameAction, { type: "submit_clue" }>): ClassicGameState;
function applyConfirmReveal(state: ClassicGameState, action: Extract<GameAction, { type: "confirm_reveal" }>): ClassicGameState;
```

- [ ] **Step 1: Add targeted RED characterization cases.** Open reveal for card A, change nomination to B, then back to A: no dialog resurrection without a fresh click. Open End Turn, change active team/role then cycle back: no stale dialog or send. Compound-invalid clue while guessing/wrong team/invalid count must preserve `wrong_phase`; already-revealed card with no nomination must preserve `already_revealed`, and wrong-team/unknown-card must preserve `wrong_team`. Assert state/action immutability. Existing property/privacy/keyboard tests remain unchanged and passing. If an added characterization already passes, record it honestly; prove it fails by temporarily removing invalid-intent retirement or changing the specific validation precedence rather than claiming RED from a syntax error. Restore mutations before extraction.
- [ ] **Step 2: Refactor cohesive logic.** Keep exhaustive action dispatch/default denial and validate current projection at confirmation time. Read React best-practice guidance for hook ownership; do not introduce state-sync effects or client authorization authority.
- [ ] **Step 3: Ratchet measured caps down.** Rerun `check:complexity`, update only decreased affected exemptions (remove them once ≤20), report before/after classic and modified scores. Keep permissions/authorization exceptions explicit rather than opportunistically restructuring security code.
- [ ] **Step 4: Verify and commit.** Run focused reducer/UI tests, `pnpm run check:release`, and `git diff --check`. Commit `refactor: separate game confirmation and reducer actions`.

### Task 7: Independent review and truthful handoff

**Files:** Coordinator-owned plan, `docs/PROJECT_SNAPSHOT.md`, and relevant runbook evidence.

**Interfaces:** Consume accepted task commits and exact verification results; keep deployed version/source unchanged because deployment is outside this plan.

- [ ] **Step 1: Whole-branch review.** Review the complete diff from `7142f5481e72c7e49d127e4877b4e7ee5502df1b`, including task-level deferred findings. Resolve material findings with scoped regression fixes and re-review.
- [ ] **Step 2: Fresh final verification.** Run `pnpm run check:release`, `git diff --check`, and `git status --short`; report measured coverage/complexity and any unavailable checks. Do not substitute automated smoke for human acceptance.
- [ ] **Step 3: Update handoff.** Record what is fixed, explicitly deferred join/recovery and browser/operational gaps, the pending CI-provider decision, unchanged staging source, and the next real-player session. Keep worktree/branch and evidence; do not merge, publish, or deploy.
