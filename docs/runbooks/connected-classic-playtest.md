# Connected Classic four-human playtest

> **Human playtest: NOT YET RUN**

This is the required Connected Classic human exit gate. Automated checks and a preliminary release gate are preconditions, not substitutes for four real humans using four distinct browser profiles or devices named A through D. Each participant opens exactly one assigned game window. Keep the results record below blank or `PENDING` until the session actually occurs.

## Session setup

Use four human participants and four genuinely distinct browser profiles or devices named A, B, C, and D. Assign one profile or device to each human, and open exactly one game window for each participant. Choose one origin for the whole session:

- Host-local: every participant uses <http://127.0.0.1:5173> on the development computer. Human B must use DevTools responsive mode at exactly `320 × 780` CSS pixels. Distinct profiles isolate each seat's IndexedDB credentials; multiple windows in one shared profile are not valid evidence.
- Authorized distributed staging: every participant uses <https://staging.oddlyuseful.studio> on their assigned phone or laptop. Use one browser window per device; the staging Worker is `cipher-party-staging` and the apex domain is not part of this session. Record each device's actual CSS viewport, OS, browser/version, and input method. A real phone is not evidence of exactly `320 × 780` CSS pixels unless that viewport was actually measured.

Assign the seats so both teams have exactly one clue-giver and one operative:

| Human | Profile or device | Assigned window | Team | Role                  |
| ----- | ----------------- | --------------- | ---- | --------------------- |
| A     | A                 | One window      | Red  | Clue-giver (and host) |
| B     | B                 | One window      | Red  | Operative             |
| C     | C                 | One window      | Blue | Clue-giver            |
| D     | D                 | One window      | Blue | Operative             |

Before inviting players, run the release gate from the repository:

```bash
pnpm install --frozen-lockfile
pnpm run check:release
```

If `pnpm run check:release` reveals a critical defect, stop and apply the regression rule below before scheduling the human session. For the host-local option, also run `pnpm run dev` and open the one assigned window in each of Profiles A–D at <http://127.0.0.1:5173>.

Before every distributed session, the facilitator must attest the deployed build from the checkout and freshly built `apps/web/dist` used for that deployment. Use the full source SHA and Worker version recorded by the reviewed deployment:

```bash
pnpm run check:staging --expected-commit FULL_SOURCE_SHA --expected-version WORKER_VERSION_UUID --expected-rooms-namespace f2766441dfa24d10bef55dd8ee4f5599
```

Replace both placeholders with the recorded values; do not guess them. The command is read-only: authenticated Wrangler version/traffic/binding reads plus public HTTP GETs. It creates no rooms, issues no tickets, opens no WebSockets, and does not exhaust admission limits. It requires the expected version at 100% traffic, the existing ROOMS namespace, HTTPS transport and security headers, correct health/API routing, and matching SHA-256 bytes for the built index and every JS/CSS file. A deployment change during the check fails it. HTTP requests time out after 15 seconds and each CLI subprocess after 60 seconds. Stop session setup on any failure. Save the successful output in the record below, then open <https://staging.oddlyuseful.studio> on each assigned device/browser; no local server is required.

Do not use the apex `oddlyuseful.studio`, expose the loopback development server, or improvise a LAN or production deployment.

## Procedure

1. In Profile A's assigned window, create a room. Start the invite-to-first-clue timer when the host shares the displayed invite URL.
2. Humans B, C, and D independently open that invite and join from their single assigned window or device in Profiles B, C, and D. Record any uncertainty about joining, team assignment, role assignment, locking, or who acts first.
3. The host assigns the four seats exactly as shown above, locks the room, and starts the board. The clue-giver for the authoritative starting team submits the first clue. Stop and record the invite-to-first-clue timer when that clue is visible in all four distinct profiles.
4. Continue normal human play. For every nomination, note whether the nominating human understood it was only a nomination and whether the confirmation dialog prevented an unintended reveal. Record every accidental nomination or reveal, including the card and circumstances.
5. Inspect all 25 cards, clue/turn status, nomination state, confirmation dialog, and revealed ownership. For host-local sessions, Human B uses exactly `320 × 780` CSS pixels in DevTools. For distributed sessions, each human uses the actual viewport recorded for their device; pay particular attention to the smallest phone viewport. Record wrapping, clipping, overlap, horizontal page scrolling, or unreadable text. Record exact `320 × 780` automated/local evidence separately; it does not replace this human observation.
6. During an active guessing phase, start a recovery timer and refresh one operative's assigned window. Stop the timer only when the same seat, current clue, board reveals, active team, and usable controls are restored. Record whether the other three distinct profiles continued normally.
7. Play until the authoritative result appears. After every reveal, compare the revealed card and owner in all four distinct profiles. At completion, compare the winning team and completion reason in all four distinct profiles.
8. Complete every field in the results record. A result stays `PENDING` if it was not directly observed. Log each concrete defect with reproduction steps; do not infer a pass from the absence of a note.

## Pending results record

**Human playtest: NOT YET RUN**

- Date: `PENDING (YYYY-MM-DD)`
- Test origin: `PENDING (must be http://127.0.0.1:5173 or https://staging.oddlyuseful.studio)`
- Facilitator: `PENDING`
- Overall result: `PENDING — PASS or FAIL only after the full session`
- Session mode: `PENDING — host-local or distributed staging`
- Staging source commit / Worker version: `PENDING (distributed sessions)`
- Pre-session attestation time / successful output: `PENDING (distributed sessions)`

### Host-local clients

Complete this table only for a host-local session; mark it not applicable only after selecting a distributed session.

| Human | Unique browser profile identifier/name | Assigned window count | Viewport (CSS px)             | OS      | Browser and version | Input method |
| ----- | -------------------------------------- | --------------------- | ----------------------------- | ------- | ------------------- | ------------ |
| A     | PENDING                                | PENDING (must be 1)   | PENDING                       | PENDING | PENDING             | PENDING      |
| B     | PENDING                                | PENDING (must be 1)   | PENDING (required: 320 × 780) | PENDING | PENDING             | PENDING      |
| C     | PENDING                                | PENDING (must be 1)   | PENDING                       | PENDING | PENDING             | PENDING      |
| D     | PENDING                                | PENDING (must be 1)   | PENDING                       | PENDING | PENDING             | PENDING      |

### Distributed devices

Complete this table for a distributed session using measured CSS viewports. Record device model and browser version, not a simulated phone preset.

| Human | Device model / unique browser profile | Assigned window count | Actual viewport (CSS px) | OS      | Browser and version | Input method |
| ----- | ------------------------------------- | --------------------- | ------------------------ | ------- | ------------------- | ------------ |
| A     | PENDING                               | PENDING (must be 1)   | PENDING                  | PENDING | PENDING             | PENDING      |
| B     | PENDING                               | PENDING (must be 1)   | PENDING                  | PENDING | PENDING             | PENDING      |
| C     | PENDING                               | PENDING (must be 1)   | PENDING                  | PENDING | PENDING             | PENDING      |
| D     | PENDING                               | PENDING (must be 1)   | PENDING                  | PENDING | PENDING             | PENDING      |

### Separate exact-width evidence

- Exact `320 × 780` automated/local check date, source commit, browser and result: `PENDING`
- Human observation at exactly `320 × 780` (host-local only): `PENDING`
- This record is separate from distributed-device observations and never establishes that four humans played.

### Required observations

| Metric                                        | Recorded value | Pass/Fail | Concrete observation or defect ID |
| --------------------------------------------- | -------------- | --------- | --------------------------------- |
| Invite-to-first-clue elapsed time             | PENDING        | PENDING   | PENDING                           |
| Role-assignment confusion                     | PENDING        | PENDING   | PENDING                           |
| Accidental nomination or reveal               | PENDING        | PENDING   | PENDING                           |
| Card readability at recorded human viewports  | PENDING        | PENDING   | PENDING                           |
| Guessing-phase refresh recovery time          | PENDING        | PENDING   | PENDING                           |
| All four profiles converged on every reveal   | PENDING        | PENDING   | PENDING                           |
| All four profiles agreed on winner and reason | PENDING        | PENDING   | PENDING                           |

### Reveal and result convergence

Record each reveal in order. Add rows as needed.

| Reveal # | Card    | Public owner | A agreed | B agreed | C agreed | D agreed | Notes/defect ID |
| -------- | ------- | ------------ | -------- | -------- | -------- | -------- | --------------- |
| PENDING  | PENDING | PENDING      | PENDING  | PENDING  | PENDING  | PENDING  | PENDING         |

- Final winning team: `PENDING`
- Completion reason: `PENDING`
- Four-profile agreement: `PENDING`

### Concrete defects

| ID      | Severity | Reproduction steps | Expected | Observed | Likely owner | Status  | Regression test |
| ------- | -------- | ------------------ | -------- | -------- | ------------ | ------- | --------------- |
| PENDING | PENDING  | PENDING            | PENDING  | PENDING  | PENDING      | PENDING | PENDING         |

## Critical-defect regression rule

A critical defect includes hidden ownership exposure to a non-clue-giver, incorrect or divergent reveals/winner, an unauthorized destructive action, lost seat/game state that cannot recover, or any blocker that prevents completing the four-human board.

If a critical defect appears:

1. Stop the exit gate. Keep **Human playtest: NOT YET RUN** or mark the attempted session `FAIL`; do not mark Task 13 or the milestone complete.
2. Add and run a new failing automated regression test that reproduces the concrete defect before changing implementation.
3. Make the minimum fix, run the focused regression GREEN, then run `pnpm run check:release` and the Worker dry run again.
4. Repeat the affected human steps with four humans in the four distinct named profiles, using one assigned window per profile, and record the new evidence. The milestone can close only when the relevant human playtest has no critical blocker.

## Staging operator reference

The authorized target is `cipher-party-staging` in account `7514dcd2dc3f092c0420d66eb65a383e`, custom domain `staging.oddlyuseful.studio`, with workers.dev and version preview URLs disabled. `apps/worker/wrangler.staging.jsonc` retains compatibility date `2026-08-30`, class `RoomDurableObject`, SQLite migration `v1`, and the existing `ROOMS` namespace `f2766441dfa24d10bef55dd8ee4f5599`. It adds an explicit ASSETS binding and sends every request through the Worker so static assets receive the same response policy. Do not rename the Worker/class, add a migration, or replace that namespace during this integration.

After the release gate and reviews, the deployment operator runs:

```bash
pnpm run deploy:staging --dry-run
pnpm run deploy:staging
```

Both commands run local TypeScript/Vite builds and the staging Wrangler configuration through the current Node executable. Live deployment requires a clean committed worktree, checks the source again after building, and records `source:FULL_SOURCE_SHA` as version metadata. A dry run permits uncommitted work and labels it `dirty dry run`; it uploads nothing. `pnpm run check:staging` defaults to HEAD and the recorded ROOMS namespace; its explicit expected inputs above are preferred when handing a deployment to a facilitator. Neither command changes the apex. The historical version `bc8b1dc2-0e65-4748-bdc6-5a5e49ddbf94` is a continuity/rollback reference, not evidence of the integrated build. Any rollback is a separate operator decision requiring fresh attestation; the historical build lacks these staging safeguards.

Staging uses Cloudflare's current rate-limit bindings; no R2, AI, extra database, or paid service is activated. These budgets apply to attempts before any room lookup or mutation:

| Binding        | Namespace ID | Budget per 60 seconds | Key scope                  |
| -------------- | ------------ | --------------------- | -------------------------- |
| CREATE_BY_IP   | 2026090701   | 10                    | Trusted client IP          |
| JOIN_BY_IP     | 2026090702   | 60                    | Trusted client IP / misses |
| JOIN_BY_ROOM   | 2026090703   | 120                   | Normalized room code       |
| TICKET_BY_IP   | 2026090704   | 120                   | Trusted client IP          |
| TICKET_BY_ROOM | 2026090705   | 240                   | Normalized room code       |

These IDs are reserved for this app in the account. Keys contain an app/origin/purpose prefix and a SHA-256 digest of the trusted `CF-Connecting-IP` or normalized room code; aliases share the same room counter. IPs, keys, and credentials are not logged. All applicable counters are awaited; denial returns friendly `429` with `Retry-After: 60` and `Cache-Control: no-store`. Missing IP/bindings or limiter errors fail closed on HTTPS staging. Local HTTP configurations omit the staging bindings so automated multi-browser runs do not share these small budgets.

Cloudflare counters are local to each location and eventually consistent, so these are bounded abuse controls, not exact global accounting. Shared NAT/mobile IPs share an IP budget; wait a minute after a 429. Routing all assets through the Worker counts those requests toward the account's existing Worker invocation allowance. [Cloudflare rate-limit documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) describes counter locality and accuracy; [asset billing documentation](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) describes Worker-first billing. No plan change or payment authorization is part of this workflow.
