# Cipher Party Delivery Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each detailed milestone plan task-by-task. Detailed plan steps use checkbox syntax for tracking.

**Goal:** Deliver the approved private multiplayer Cipher Party MVP through four independently playable and reviewable milestones.

**Architecture:** A React/TypeScript DOM client sends validated commands to a Cloudflare Worker and one authoritative Durable Object per room. Pure rules, wire projections, and pack formats live in focused workspace packages; R2 and Workers AI enter only when Pack Studio needs them.

**Tech Stack:** pnpm workspaces, React, TypeScript, Vite, Cloudflare Workers, Durable Objects with SQLite storage, R2, Workers AI, Zod, Vitest, fast-check, Testing Library, and Playwright.

**Spec:** docs/superpowers/specs/2026-08-30-cipher-party-design.md

## Global Constraints

- Support 4–16 active players across 2–4 teams, plus up to 16 spectators by MVP completion.
- Require at least one clue-giver and one operative per active team.
- Use React DOM rather than Phaser or canvas.
- Keep the server authoritative for game state and absolute deadlines.
- Make unrevealed ownership structurally absent from operative and spectator projections.
- Keep host and seat tokens out of URLs and logs.
- Expire temporary room state and assets after 24 hours of inactivity.
- Ship no unlicensed franchise artwork.
- Limit MVP AI assistance to host-reviewed text suggestions.
- Preserve current stable browser support as defined by the approved spec.

---

## Canonical context system

Every milestone uses:

- AGENTS.md for automatically loaded repository rules.
- docs/PROJECT_SNAPSHOT.md for current state and handoff.
- This roadmap for milestone order and cross-milestone contracts.
- One detailed plan for the active milestone.
- The approved design specification for product truth.

The coordinator refreshes the snapshot after every accepted task and writes the next milestone's detailed plan only after the current milestone passes its exit gate. This prevents a stale long-range plan from overriding evidence learned during implementation.

## Milestone 1: Connected Classic

**Detailed plan:** docs/superpowers/plans/2026-08-30-connected-classic.md

**Outcome:** A deployable, account-free, two-team Classic text game that a host, two clue-givers, two or more operatives, and spectators can complete across separate browsers.

**Introduces:**

- Workspace, quality gate, and Cloudflare development environment.
- Deterministic 5×5 board generation.
- Pure two-team turn reducer.
- Role-safe projections and bounded public action history.
- Room creation, joining, ticketed WebSockets, seat reconnect, and Durable Object persistence.
- A 24-hour inactivity alarm that closes sockets and clears room storage.
- Responsive landing, lobby, and game board.
- Complete browser test for one board.

**Exit gate:**

- A complete board passes in isolated Playwright browser contexts.
- Refreshing an operative preserves the seat and current turn.
- An operative and spectator payload inspection contains no unrevealed ownership field.
- Durable Object integration coverage proves room expiry and alarm rescheduling.
- pnpm run check, pnpm run test:e2e, and git diff --check pass.

## Milestone 2: Pack Studio

**Plan timing:** Write the detailed Milestone 2 plan after Milestone 1's snapshot records a passing exit gate.

**Outcome:** Hosts can build, validate, save, import, export, and temporarily upload text, picture, and mixed packs.

**Introduces:**

- Versioned .cipherpack schemas and archive validation.
- IndexedDB host library.
- Five-step pack wizard.
- Workers AI structured text suggestions with manual fallback.
- Client-side raster processing and server-side signature/dimension validation.
- Private R2 assets and 24-hour deletion.
- Picture and mixed-card rendering.

**Consumes from Milestone 1:**

- Room host authorization.
- Worker routing and environment bindings.
- Projection-safe room updates.
- Responsive card and modal primitives.

**Exit gate:**

- A host exports and reimports an equivalent pack.
- Malformed and unsafe archives fail without entering the library.
- AI failure leaves manual creation usable.
- A picture/mixed board completes across phone and laptop contexts.
- Room expiry removes temporary R2 objects.

## Milestone 3: Party Modes

**Plan timing:** Write the detailed Milestone 3 plan after Pack Studio passes its exit gate.

**Outcome:** The stable core supports Blitz, three and four teams, and best-of-3/5/7 campaigns.

**Introduces:**

- Server deadline alarms and disconnect grace pause.
- 5×6 and 6×6 ownership distributions.
- Multi-team hazard elimination and target-to-neutral conversion.
- Fixed campaign scoring and tie-break statistics.
- Between-board clue-giver and starter rotation.
- Campaign summary export.

**Consumes from earlier milestones:**

- Pure reducer and board generator extension points.
- Role projection and reconnect contracts.
- Pack eligibility and deterministic sampling.

**Exit gate:**

- Unit/property tests cover every distribution and reveal outcome.
- Browser tests cover one Blitz timeout, one hazard elimination, and one best-of-3 campaign.
- Starting team and clue-giver rotation remain deterministic after reconnect.
- Larger boards retain spatial order at required phone and desktop widths.

## Milestone 4: Hardening and MVP Release

**Plan timing:** Write the detailed Milestone 4 plan after Party Modes passes its exit gate.

**Outcome:** The complete MVP meets resilience, accessibility, security, browser, and deployment requirements.

**Introduces:**

- Co-host and abandoned-seat recovery.
- Rate-limit and abuse-control completion.
- Schema migration coverage.
- PWA-ready manifest and canonical-domain configuration.
- Accessibility, network-loss, hibernation, and cross-browser hardening.
- Production preflight, observability boundaries, and release runbook.

**Exit gate:**

- Mixed-device human playtest completes a best-of-3 campaign.
- No critical accessibility issue remains.
- No hidden-key, token, archive, or stale-command security regression remains.
- Production preflight verifies bindings, quotas, selected Workers AI model, cleanup, and custom domain.
- All repository and end-to-end checks pass from a clean checkout.

## Deferred modes

Co-op, powers, double agents, mid-board team switching, shared-TV mode, full-room skins, public packs, accounts, and licensed asset connectors require new approved designs or amendments after the MVP. They are not opportunistic additions to the four milestone plans.

## Change-control rule

When implementation evidence requires a design change:

1. Stop the affected task.
2. Record the conflict in docs/PROJECT_SNAPSHOT.md.
3. Present the smallest concrete design amendment for approval.
4. Update the design, active plan, and snapshot in that order.
5. Resume from a new failing test that captures the approved behavior.
