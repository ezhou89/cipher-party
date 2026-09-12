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

## Audit disposition

Tasks below address release hygiene, terminal/throttled reconnect, resource budgets, snapshot compatibility, coverage/complexity measurement, deployment gating, and the two highest-value refactors. Lost join responses and disconnect-write failure receive concrete fault evidence and an explicit recovery disposition in Task 4; do not invent a credential protocol or full seat-replacement subsystem. Hosted CI awaits a repository/provider destination; strengthen the provider-neutral local gate now. Screen-reader/real Android/Firefox/forced-colors coverage and operational alert/rollback drills remain named Milestone 4 acceptance work, not silently completed claims.

### Task 1: Restore the artifact boundary and track public staging smoke

**Files:** Modify `eslint.config.js`, `package.json`, `scripts/check-project-docs.mjs`, `scripts/check-project-docs.test.ts`, `docs/runbooks/connected-classic-playtest.md`; create `staging/public-smoke.spec.ts`, `playwright.staging.config.ts`, `scripts/release-hygiene.test.ts`.

**Interfaces:** `verifyProjectDocs(root)` must validate the actual `**Active plan:**` link in the snapshot, not require the historical plan by a hardcoded substring. Add `smoke:staging:public` invoking the dedicated Playwright config; default `test:e2e` remains local. Coordinator owns snapshot and this plan, not the implementer.

- [ ] **Step 1: Add regression tests and observe RED.** Extend temporary documentation fixtures to include a new valid active plan and an old plan elsewhere in the snapshot; missing active target must reject. Add an ESLint Node API test proving scratch is ignored and the tracked smoke is not; test explicit smoke script/config isolation. Example assertions:

```ts
expect(await eslint.isPathIgnored(".superpowers/sdd/example/helper.ts")).toBe(true);
expect(await eslint.isPathIgnored("staging/public-smoke.spec.ts")).toBe(false);
await expect(verifyProjectDocs(rootWithMissingActivePlan)).rejects.toThrow();
```

Run `pnpm exec vitest run scripts/check-project-docs.test.ts scripts/release-hygiene.test.ts` and retain meaningful failures.
- [ ] **Step 2: Implement the boundary.** Add `.superpowers/**` to flat ESLint ignores. Parse a single canonical relative `docs/superpowers/plans/*.md` active-plan path, reject traversal/absolute/missing/multiple active declarations, and verify its existence. Leave old plan evidence untouched.
- [ ] **Step 3: Implement the tracked public smoke.** Use two projects: desktop Chromium and 320×780 mobile WebKit. Check landing and `/room/ABC123` public invite shell, same-origin GET/HEAD only, block WebSocket creation before connection, compare navigation HTML SHA-256 to `apps/web/dist/index.html`, check focus/narrow overflow and zero CSP/console/page/request/HTTP errors. Set trace/screenshots/video off; capture no credential artifacts. Production-CSP local tests remain separate. Update the runbook to the tracked opt-in command and warn that the local build must match the deployed source.

```ts
await page.routeWebSocket("**/*", (socket) => socket.close());
// Count attempted sockets as a smoke failure, even though the route blocks them.
```

- [ ] **Step 4: Verify and commit.** Run the focused tests, `pnpm run check`, `pnpm exec playwright test --config playwright.staging.config.ts --list`, `git diff --check`. Do not run the live smoke in this task. Commit `fix: make release hygiene and public smoke reproducible` and report exact results.

### Task 2: Make reconnect failure handling bounded and recoverable

**Files:** Modify `apps/web/src/lib/api.ts`, `api.test.ts`, `room-socket.ts`, `room-socket.test.ts`, `apps/web/src/features/lobby/useRoom.ts`, `RoomPage.tsx`, `LobbyView.test.tsx`; create `apps/web/src/lib/reconnect-policy.ts`, `reconnect-policy.test.ts` if policy extraction keeps the socket class focused.

**Interfaces:** Extend `ApiError` with optional `retryAfterMs: number | null`, maintaining existing construction defaults. Extend `RoomConnectionSnapshot` with an optional public error field (no raw server text). Terminal transport sets `connection: "closed"`, clears role projection and in-flight command, publishes safe error; transient retries retain the exact command envelope. `useRoom` consumes terminal error and clears pending UI. Explicit user discard remains the only credential deletion path.

- [ ] **Step 1: Reproduce with failing fake-clock tests.** After one successful connection, make ticket fetch return 401 unauthorized or 404 room_unavailable; assert closed, no queued retry, no old projection, public recovery copy. For 429 with `Retry-After: 60`, assert no fetch before 60 seconds. Cover HTTP-date, malformed/negative/nonfinite retry headers, network/5xx backoff, initial failure, stale-generation callbacks, and terminal failure while a command is pending. Preserve all existing resend/privacy tests.

```ts
expect(snapshot.connection).toBe("closed");
expect(snapshot.projection).toBeNull();
expect(pendingTimers()).toHaveLength(0);
// For throttling: advance 59_999 ms -> no new ticket; final 1 ms -> one retry.
```

- [ ] **Step 2: Implement classified recovery.** Recognized terminal 401/404 and policy close code 1008 stop automatic retry. Expiry close 1001 with exact locally defined `Room expired` reason stops retry; generic 1001 remains transient. 429 honors valid Retry-After delay; absent/invalid delay uses existing bounded exponential backoff. Clamp scheduling safely to the maximum platform timer and re-evaluate remaining absolute deadline rather than overflow into immediate retry. Use injected clock for deterministic HTTP-date tests. Never render server-supplied error text or delete stored credentials automatically.
- [ ] **Step 3: Implement recovery UI regression.** A formerly mounted game/lobby losing terminal authorization must no longer show stale/key UI, pending controls must clear, and the explicit forget/rejoin path must remain reachable. Add a component test through the existing socket fixture; retain cancel/focus and live-region behavior.
- [ ] **Step 4: Verify and commit.** Run focused web API/socket/lobby tests, `pnpm run check`, `pnpm run test:e2e`, and `git diff --check`. Commit `fix: stop terminal reconnect loops and honor throttling`.

### Task 3: Bound upgrade, socket, and message amplification

**Files:** Modify `apps/worker/src/index.ts`, `env.ts`, `http/admission-limits.ts`, `room/room-durable-object.ts`, `room/room-websocket.ts`, `apps/worker/test/staging.test.ts`, `room-websocket.test.ts`, `room-durable-object.test.ts`, `apps/worker/wrangler.staging.jsonc`, `scripts/staging-common.mjs`, `scripts/staging.test.ts`; create `apps/worker/src/room/connection-budget.ts` and focused tests. Keep local/test Wrangler configs without production rate bindings.

**Interfaces:** Extend admission kind with `connect`, using `CONNECT_BY_IP` 120/min and `CONNECT_BY_ROOM` 240/min, purpose-scoped hashed keys and all-settled semantics before Durable Object lookup. Live cap: 4 sockets per seat, 64 per room. Message budget: 30 frames per seat and 120 per room in a 10-second server-clock window, enforced before parsing/dispatch; count malformed/rejected frames too. Close overloaded connection with 1013 and fixed public reason; no credential values. Store small budget counters in hibernating socket attachments, validate old/new attachment shape, and bound computation by capped sockets. Do not persist a room snapshot for each rejected frame.

- [ ] **Step 1: Add RED budget and gateway tests.** Denied/failing/missing production connect limiters prevent namespace lookup. Exact cap permits the last allowed socket and rejects the next before accept; multiple tabs below cap still work. Frames exceeding either dimension never reach command dispatch. Old attachments remain readable. Test reset boundary, multiple sockets for one seat, malformed frames, and hibernation reconstruction.

```ts
expect(dispatchCountAfterOverBudget).toBe(dispatchCountAtLimit);
expect(otherSeatProjectionCountAfterRejectedCommand).toBe(before);
expect(requestingSeatReceivedFreshProjection).toBe(true);
```

- [ ] **Step 2: Implement focused admission/budget helpers.** Keep ticket consumption and markConnected persistence ordering. Reject capacity without evicting existing sockets; ticket may already be consumed safely. Bound outstanding ticket verification by existing lifetime plus an explicit outstanding-ticket cap if current issuance is unbounded; retain hash-only v1 credentials and one-use semantics. Raise any compatibility ambiguity to coordinator before changing persisted/wire formats.
- [ ] **Step 3: Restrict failed-command resync fanout.** Send command result and fresh role-safe projection to the requesting socket after stale/unauthorized/duplicate-no-state-change results; broadcast accepted revision-changing mutations only. Preserve duplicate resend completion behavior and monotonic projection sequence. Failed writes never become accepted state.
- [ ] **Step 4: Update config attestation and verify.** Account for the two new bindings in strict staged config validation/fixtures and docs; do not deploy. Run focused Worker/root staging tests, `pnpm run check`, `pnpm run test:e2e`, `pnpm run build`, `pnpm run preflight`, and `git diff --check`. Commit `fix: bound realtime admission and message fanout`.

### Task 4: Validate persisted snapshots and characterize recovery faults

**Files:** Create `apps/worker/src/room/room-snapshot.ts`, `apps/worker/test/room-snapshot.test.ts`, `docs/runbooks/room-recovery.md`; modify `room-storage.ts`, `room-durable-object.ts`, `apps/worker/test/room-durable-object.test.ts`, `room-websocket.test.ts`, `rooms-api.test.ts` as required by regression seams.

**Interfaces:** `parseRoomSnapshot(input: unknown): RoomState` validates supported schema/protocol versions and the complete v1 storage shape before controller installation. Reuse existing Zod dependency and public command/history schemas where valid; do not serialize hidden state into errors. `RoomStorage.read()` reads unknown then validates; unsupported/corrupt storage remains unchanged and admission fails opaque. Do not create a fictitious v2 migration.

- [ ] **Step 1: Add RED compatibility tests.** Round-trip real lobby/playing/complete snapshots, pending tickets, and processed results. Reject unknown schema/protocol, malformed game/card/reveal shapes, broken seat/host references, invalid timestamps and inconsistent phase. Assert rejected load neither writes nor clears storage and never returns any projection/credentials. Keep tests using genuine production-generated state where possible.

```ts
expect(parseRoomSnapshot(structuredClone(validState))).toEqual(validState);
expect(() => parseRoomSnapshot({ ...validState, schemaVersion: 2 })).toThrow();
expect(storageWrites).toBe(0);
expect(storageClears).toBe(0);
```

- [ ] **Step 2: Implement the validation boundary.** Distinguish absent snapshot from invalid snapshot; do not silently initialize over invalid existing data. Preserve v1 snapshots and the original serialized payload until any future real migration commits.
- [ ] **Step 3: Add fault evidence and safe recovery disposition.** Inject a failed last-socket disconnect write and a lost successful join response followed by retry. Record what actually happens, including seat allocation and persisted presence. If offline presence can be safely reconciled from authoritative hibernating socket inventory without changing lastActivity or room rules, implement a bounded retry/reconciliation on the next room event with a regression. Do not retain raw credential receipts or silently redesign join admission; document retry-safe join identity as a prerequisite before automated join retries, plus current explicit user recovery limitations and future host replacement gate.
- [ ] **Step 4: Verify and commit.** Run focused Worker resilience tests, `pnpm run check`, `pnpm run test:e2e`, `git diff --check`. Commit `fix: validate room snapshots and document recovery boundaries`.

### Task 5: Establish measurable quality and source-bound release gates

**Files:** Create `scripts/check-complexity.mjs`, `scripts/check-complexity.test.ts`, `scripts/complexity-baseline.json`, `scripts/release-staging.mjs`, `scripts/release-staging.test.ts`, `docs/runbooks/release-quality.md`; modify `package.json`, `pnpm-lock.yaml`, all five `vitest.config.ts` files (root plus four workspaces), `scripts/deploy-staging.mjs`, `scripts/staging.test.ts`, `.gitignore`.

**Interfaces:** `check:complexity` uses installed ESLint Node API classic complexity across tracked runtime TS/TSX, excludes test/spec/typecheck/helpers. Baseline keys identify file+function, not line numbers. Fail new functions over 20, increases over an existing cap, duplicate/missing/stale exemptions; report above 10. Existing exceptions: GameWorkspace 36, permissionsFor 34, applyGameAction 30, authorize 24, ModerationPanel 21, applyLobbyCommand 21. `test:coverage` uses Istanbul in all workspaces, separate report directories; risk-weighted numeric floors are derived from the fresh measurement and recorded exactly, never invented. Add both checks to `check:release` without causing ordinary test recursion.

- [ ] **Step 1: Add RED gate tests.** Synthetic functions test allowed baseline, cap increase, new over-limit, renamed/stale exception, nested function naming, and excluded files. Release orchestrator injections assert a failed gate prevents deploy, changed HEAD or dirt after gate prevents deploy, expected revision is passed through, and dry-run does not deploy. Verify exact source check remains after build.

```ts
await expect(runRelease({ gate: failingGate, deploy })).rejects.toThrow();
expect(deploy).not.toHaveBeenCalled();
// successful gate at commit S -> deploy({ expectedCommit: S }) only if still clean S
```

- [ ] **Step 2: Implement complexity measurement and baseline.** Count functions consistently with the audit; keep classic and optionally modified report output separate. Do not add file-wide waivers or score-only fragment extraction. Test harness uses injectable source/file lists instead of changing tracked source.
- [ ] **Step 3: Measure coverage and ratchet it.** Add exact compatible `@vitest/coverage-istanbul` 4.1.11 as development tooling, frozen lockfile update only for its required graph. Workers use instrumented Istanbul (V8 is unsupported there). Run all coverage suites, retain concise per-workspace branch/function/line/statement totals in the runbook, select floors at measured whole-number values (rounded down) for covered runtime scopes, and require these in the release command. Exclude generated/test/config/fixture code deliberately and disclose exclusions; do not raise claims from test counts alone.
- [ ] **Step 4: Bind deploy to the full gate.** `deploy:staging` points at a separate orchestrator: clean HEAD S → `check:release` → clean same S → low-level deploy with required expectedCommit S. No stored reusable pass token and no recursive gate from imported low-level functions. Run pnpm via absolute validated `npm_execpath`; JS entries use `process.execPath`, native absolute entries use execFile without shell; absent entry fails with an invoke-via-pnpm instruction. Existing local JS tool entrypoints stay unchanged. Gate subprocess timeout must accommodate the full release. Keep dry-run explicit and non-mutating. Document clean-checkout frozen-install and gate procedure without inventing a hosted provider.
- [ ] **Step 5: Verify and commit.** Run focused tooling tests, `pnpm run check:release`, `pnpm install --frozen-lockfile`, and `git diff --check`. Commit `build: ratchet quality and require verified staging releases`. No live deploy.

### Task 6: Reduce the two highest-value complexity hotspots

**Files:** Modify `apps/web/src/features/game/GameView.tsx`, `GameView.test.tsx`, `packages/game-core/src/reducer.ts`, `reducer.test.ts`, `scripts/complexity-baseline.json`; create `apps/web/src/features/game/useGameConfirmation.ts`, `game-availability.ts` and focused tests only if needed for cohesive ownership.

**Interfaces:** The reducer keeps `applyGameAction(state, action)` public API and immutable/error semantics; extract typed private clue/reveal handlers. Game UI retains one identity-scoped, projection-validated modal owner with transport-gated confirmation, enabled Cancel during reconnect, and focus return/fallback. Extract pure availability derivation and the confirmation hook, not many one-line helpers. No game rule or permission change.

- [ ] **Step 1: Add targeted RED characterization cases.** Cover intention invalidation across fresh nomination/turn/role projections and reducer invalid clue/reveal phase/action inputs before extraction. Existing property/privacy/keyboard tests remain unchanged and passing. If an added characterization already passes, record it honestly; prove it fails under a narrowly injected old-behavior mutation rather than claiming RED from a syntax error.
- [ ] **Step 2: Refactor cohesive logic.** Keep exhaustive action dispatch/default denial and validate current projection at confirmation time. Read React best-practice guidance for hook ownership; do not introduce state-sync effects or client authorization authority.
- [ ] **Step 3: Ratchet measured caps down.** Rerun `check:complexity`, update only decreased affected exemptions (remove them once ≤20), report before/after classic and modified scores. Keep permissions/authorization exceptions explicit rather than opportunistically restructuring security code.
- [ ] **Step 4: Verify and commit.** Run focused reducer/UI tests, `pnpm run check:release`, and `git diff --check`. Commit `refactor: separate game confirmation and reducer actions`.

### Task 7: Independent review and truthful handoff

**Files:** Coordinator-owned plan, `docs/PROJECT_SNAPSHOT.md`, and relevant runbook evidence.

**Interfaces:** Consume accepted task commits and exact verification results; keep deployed version/source unchanged because deployment is outside this plan.

- [ ] **Step 1: Whole-branch review.** Review the complete diff from `7142f5481e72c7e49d127e4877b4e7ee5502df1b`, including task-level deferred findings. Resolve material findings with scoped regression fixes and re-review.
- [ ] **Step 2: Fresh final verification.** Run `pnpm run check:release`, `git diff --check`, and `git status --short`; report measured coverage/complexity and any unavailable checks. Do not substitute automated smoke for human acceptance.
- [ ] **Step 3: Update handoff.** Record what is fixed, explicitly deferred join/recovery and browser/operational gaps, the pending CI-provider decision, unchanged staging source, and the next real-player session. Keep worktree/branch and evidence; do not merge, publish, or deploy.
