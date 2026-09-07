# Creative Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one verified staging build combining Gemini's creative direction and pnpm workflow with the reviewed Connected Classic multiplayer implementation, preserving the creative source for later milestones.

**Architecture:** Start the isolated `feature/creative-integration` branch at reviewed `fe264e3`. Import selected creative material from `main@128c0f7` and the two identified Antigravity artifact directories. Retain the reviewed server, protocol, recovery, confirmation, and privacy test contracts; adapt presentation, tooling, board sampling, and staging controls around them.

**Tech Stack:** Node 22+, pnpm 11 workspaces, React DOM, TypeScript, Vite, Cloudflare Workers/SQLite Durable Objects, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-08-30-cipher-party-design.md (including the September 7 integration amendment).

## Global Constraints

- Milestone 1 supports two teams, a 5×5 text board, and one board per room.
- The server is authoritative; clients send commands and never replacement state.
- An accepted state-changing command persists before any broadcast.
- Unrevealed ownership is structurally absent from operative, host-only, and spectator projections.
- Durable seat and host tokens stay out of URLs, logs, test artifacts, and public projections.
- Retain all reviewed reconnect, strict parsing, intent freshness, room expiry, and privacy-harness regressions.
- Gemini's Neo 8-Bit visual direction and pnpm choice are retained. Card words use readable sans-serif; pixel typography is reserved for chrome.
- Preserve source artifacts and original branches. Prototypes and image recipes are design references, not implemented product claims.
- In-app AI remains text-only; picture/mixed boards, Pack Studio, audio/token customization, and campaigns are not implemented by this integration.
- Deploy only the separate `cipher-party-staging` Worker at `https://staging.oddlyuseful.studio`; the apex is outside this task.
- Never claim the required four-human playtest occurred until real participants complete and record it.

## Context and ownership

Reviewed source: `/Users/eugenezhou/Code/cipher-party/.worktrees/connected-classic`, `fe264e3`.
Creative implementation source: `/Users/eugenezhou/Code/cipher-party`, `128c0f7`.
Creative artifact roots:

- `/Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b`
- `/Users/eugenezhou/.gemini/antigravity/brain/648bd5c6-d395-44e0-a80a-903c25e5c772`

The coordinator owns `docs/PROJECT_SNAPSHOT.md` and task completion checkboxes. Workers supply proposed snapshot updates in reports. Work on one implementation task at a time. Independent read-only investigation can run alongside it. Use `apply_patch` for authored edits; exact file imports and generated lockfiles/assets are mechanical operations. All imported artifacts remain outside Vite public assets and the shipped bundle.

### Task 1: Preserve creative source and complete the pnpm release workflow

**Files:**

- Create: `creative/README.md`, `creative/manifest.json`, `creative/source/` (selected original HTML/Markdown/JPEG only).
- Create: `docs/CREATIVE_HANDOFF.md`, `docs/DESIGN_SYSTEM.md`, `docs/SCAFFOLDING_HANDOFF.md` (imported provenance with status explained by handoff).
- Create: `.npmrc`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`.
- Modify: root/workspace manifests, `tsconfig.base.json`, `playwright.config.ts`, `.gitignore`, `.prettierignore`, `eslint.config.js`, `README.md`, `AGENTS.md`, local-development runbook, active documentation references, and preflight scripts/tests.
- Fix baseline test fixtures: `apps/worker/test/rooms-api.test.ts` and `room-websocket.test.ts` retain past August timestamps that let workerd's real alarm scheduler consume alarms before explicit test invocation. Reuse the future-relative fixture pattern already present in `room-durable-object.test.ts`; keep the exact expiry assertions.
- Preserve: existing runtime files, reviewed tests, ES2022-only library types, credential ignore patterns, and the two untracked E2E files in the original main checkout.

**Interfaces:** Consumes existing `check`, `build`, `test:e2e`, `preflight`, and `check:release` scripts. Produces their pnpm equivalents without reducing their checks, a portable lockfile installation, and a versioned creative handoff.

- [ ] **Step 1: Copy and inventory the creative artifacts.** Select the HTML/Markdown/JPEG files in the two named source roots, excluding metadata/history and unrelated sessions. Preserve original bytes under separate source-root identifiers. Record each original filename, repository path, original SHA-256, byte length, and status (`prototype`, `content-draft`, `sample-art`, `historical-notes`) in `creative/manifest.json`. Use `createHash('sha256').update(bytes).digest('hex')` to verify every copy against its source. Link the seven main UI prototypes, the image demo, two word lists, image gallery/recipes, and samples from the README; note browser-local paths/CDN dependencies in originals. Do not promise these originals are a portable production app. Do not execute imported scripts during copying.
- [ ] **Step 2: Write a practical creative handoff.** Record source ownership (Gemini/Antigravity), approved direction versus experiments, where assets/previews belong, implementation status, and a future submission template: purpose, preview, editable source, assets, usage/provenance notes, accessibility notes, and decisions. Record the verified content inventory: 200 core entries plus five internally unique 100-entry expansions, 682 unique labels across all six packs; mixed selections deduplicate. The runtime still uses its 50-word fixture. Original image recipes are asset-preparation references; in-app AI remains text-only.
- [ ] **Step 3: Migrate the executable gate.** Prefer importing the reviewed npm lock to pnpm so working runtime versions remain stable; retain Gemini's explicit build-script approvals and workspace isolation. Workspace dependencies use `workspace:*`. Remove the machine-specific `storeDir`; use the default store or a relative local store. Retain the reviewed Worker test typecheck. Keep ES2022-only shared `lib` and add useful `isolatedModules`/casing settings if supported. Retain the existing plugin unless integration requires Gemini's purposeful `cloudflare:test-internal` patch; record exact plugin/patch selection and upgrade obligations. Remove the superseded npm lock only after a verified pnpm lock/install. Preserve original history in Git.

Root script contracts:

```json
{
  "check": "pnpm run check:docs && pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test",
  "check:release": "pnpm run check && pnpm run build && pnpm run preflight && pnpm run test:e2e",
  "test": "pnpm -r --if-present run test && vitest run --config vitest.config.ts"
}
```

- [ ] **Step 4: Adapt preflight and documentation.** First change preflight fixtures/expectations to require `pnpm-lock.yaml`, observe the focused preflight failure, then change preflight to retain all eight checks and seven real expiry-test identities under pnpm. Update the Playwright server command to pnpm. Keep local tests independent of Cloudflare login. Exclude immutable `creative/source/**` archives from formatting/lint, while linting authored project code normally. Update current npm instructions; label the original Connected Classic plan a historical execution record instead of rewriting historical evidence.
- [ ] **Step 4a: Stabilize the two observed baseline expiry failures.** Baseline `npm test` on September 7 failed `rooms-api.test.ts:389` and `room-websocket.test.ts:909`: `runDurableObjectAlarm` returned false because real workerd had already run overdue alarms; logs included `SQLite alarm overdue`. Establish fixture times relative to real process time before fake timers, preserving elapsed ticket/expiry boundaries and exact assertions. Run both focused files GREEN. Do not change production TTL or relax the tests.
- [ ] **Step 5: Verify and commit.** Run checksum inventory verification, `pnpm install --frozen-lockfile`, focused preflight tests, `pnpm run check`, `pnpm run build`, `pnpm run preflight`, and `git diff --check`. Record actual results and any tooling warnings. Commit `chore: preserve creative source and unify pnpm workflow`.

### Task 2: Integrate arcade presentation and board sampling

**Files:**

- Modify: `apps/web/src/styles/tokens.css`, `globals.css`, relevant game/home/lobby presentation components, `apps/web/index.html` only if needed for production-safe font loading.
- Modify: `packages/game-core/src/board.ts`, `board.test.ts`.
- Modify tests only for intentional public copy/presentation changes; preserve all existing behavioral and privacy assertions.

**Interfaces:** Consumes the reviewed component props, `useRoom`, `RoomSocket`, protocol projections, and pure `createClassicBoard`. Produces the same behavior/contracts with Gemini's arcade presentation and independent card/grid/ownership streams.

- [ ] **Step 1: Add a meaningful board-sampling regression.** Retain the accepted duplicate-ID and `__proto__` coverage. Test that selected membership and spatial order are reproducible from the separate stream derivations below, then observe failure on the base algorithm.

```ts
const selected = shuffled(input.cards, createSeededRandom(`${input.seed}/cards`)).slice(0, 25);
const ordered = shuffled(selected, createSeededRandom(`${input.seed}/grid-order`));
// Ownership retains createSeededRandom(`${input.seed}/ownership`).
// Keep duplicate rejection and Object.create(null) for the card map.
```

- [ ] **Step 2: Port the focused generator change.** Preserve starting-team input, ownership distribution, `order`/`cards` shape, and deterministic behavior. Do not mutate live room snapshots or change IDs.
- [ ] **Step 3: Integrate the visual language.** Adapt Gemini's palette, warm word cards, hard shadows, stepped/tactile controls, Ruby/Red and Cobalt/Blue symbols/labels/patterns, and nomination styling to the reviewed component classes. Preserve accessible names or update tests explicitly for equivalent public copy. Make home, lobby, and board visibly coherent; keep the board hierarchy, clue status, and action area readable at 320px. Use local/system font fallbacks or self-hosted font files; do not require an executable third-party CDN for the app. Preserve reduced-motion support, keyboard focus, 44px controls where feasible, five-column spatial order, default-closed privacy veil, public-only scores, and fresh confirmation intents.
- [ ] **Step 4: Verify behavior and visuals.** Run focused board tests, affected web component tests, then the full `pnpm run check:release` including Chromium and WebKit Mobile. Inspect public-role screenshots at desktop and 320px; capture no clue-giver screens or hidden values. Check console errors, keyboard confirmation/cancel, narrow word wrapping, and nomination visibility. Add a regression for any observed defect. Record screenshots in ignored artifacts with paths in the report. Commit `feat: integrate arcade presentation with reviewed multiplayer`.

### Task 3: Make staging secure and reproducible

**Files:**

- Create: `apps/worker/wrangler.staging.jsonc`, staging/security helper(s) and focused tests as appropriate, static asset `_headers` if used, `scripts/check-staging.mjs` and focused tests for its meaningful validation.
- Modify: Worker request routing/environment types, package scripts, dev/test configs only for local binding parity, and `docs/runbooks/connected-classic-playtest.md`.

**Interfaces:** Consumes existing Worker fetch/API/DO routes. Produces a deterministic `deploy:staging` command and read-only `check:staging` that verifies the currently deployed build. Preserve `ROOMS` class/migration and live serialized-state compatibility.

- [ ] **Step 1: Test the concrete security failures.** Tests must prove production HTTP cannot reach token-bearing APIs or serve an insecure app; localhost HTTP remains usable. Verify CSP, nosniff, referrer/frame/permissions controls on SPA and API errors, HSTS on HTTPS only, no-store on credential responses, and unchanged successful WebSocket upgrades. Use a narrowly scoped host/protocol policy rather than redirecting arbitrary hosts to the canonical origin.
- [ ] **Step 2: Implement staging policy.** Reproducible config names `cipher-party-staging`, canonical origin `https://staging.oddlyuseful.studio`, custom domain exactly that hostname, SQLite `RoomDurableObject` v1, SPA assets and API-first routing. Enforce HTTPS for this deployment and include security headers on assets as well as Worker responses. CSP permits only resources actually used by the app and same-origin WebSockets (explicit wss origin if required by supported engines). No R2/AI bindings or paid services.
- [ ] **Step 3: Add bounded abuse controls.** Use current supported Cloudflare rate-limit bindings if available without a paid prerequisite; otherwise use a small explicit existing-platform limiter. Limit unauthenticated creation and repeated joins/code misses by trusted client-IP-derived key, and room joins/ticket issuance by room as well. Suggested staging budgets: create 10/minute/IP, join/lookup 60/minute/IP, room admissions 120/minute/room, ticket issuance 120/minute/IP and 240/minute/room. Preserve normal multi-browser tests and return 429 with Retry-After/no-store on exhaustion. Do not log raw keys or credentials. Test allow/deny and no mutation on denial. Record exact chosen mechanism, locality limitations, and deployment bindings; do not imply global/exact protection from local counters.
- [ ] **Step 4: Add deterministic deployment and live attestation.** `deploy:staging` builds then invokes the staging config with the Git revision recorded as version metadata. `check:staging` is read-only and fails on HTTP serving content, incorrect HTTPS health, missing required headers, wrong canonical origin/bindings/traffic, or bundle mismatch. Verify active version via authenticated Wrangler/API and compare local built index/JS/CSS hashes with HTTPS responses. Permit an explicit expected commit/version input; never echo auth tokens. Tests exercise mismatches via injected responses; they do not mutate live rooms.
- [ ] **Step 5: Correct the human runbook and verify.** Split distributed-device evidence from exact 320×780 automated/local evidence; real phones record their actual viewport/device/browser. Add pre-session live attestation, keep results `PENDING`, and preserve the four-real-human requirement. Run focused tests, full release gate and staging dry run; commit `fix: harden and reproduce staging deployment`.

### Task 4: Review, deploy, and hand off the combined build

**Files:** coordinator-owned snapshot and completion ledger; staging runbook evidence if applicable.

**Interfaces:** Consumes Tasks 1–3, fresh automated results, independent task/whole-branch reviews. Produces verified staging deployment and a truthful four-human playtest handoff.

- [ ] **Step 1: Resolve review findings.** Generate the whole-branch review package against `fe264e3`; review integration contracts, preserved creative sources, release checks, privacy, and any deferred findings. Implement and review concrete fixes before deployment.
- [ ] **Step 2: Deploy only after checks pass.** Run the tracked staging deploy with source revision metadata using existing Cloudflare authority. Do not merge/push the original branches. Record Worker version and run `check:staging`; perform a public landing/invite smoke check in desktop/mobile browsers. If a new issue appears, fix it through focused regression and reverify affected gates.
- [ ] **Step 3: Update snapshot and handoff.** Record integration branch/worktree, source revisions, exact tests and deploy evidence, archive/design locations, remaining known issues, and the pending four-human session. The integration plan can finish with that human milestone gate explicitly pending; it does not claim Connected Classic or Pack Studio is complete.
