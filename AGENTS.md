# Cipher Party Agent Instructions

## Required context

Before planning, editing, reviewing, or testing:

1. Read docs/PROJECT_SNAPSHOT.md.
2. Read the active plan linked from that snapshot.
3. Read the relevant sections of docs/superpowers/specs/2026-08-30-cipher-party-design.md.
4. Inspect the current Git status and preserve unrelated work.

If context is compacted or a task is resumed in a new session, repeat these steps.

## Source-of-truth order

Use this precedence when documents disagree:

1. The user's latest explicit instruction.
2. The approved design specification.
3. The active milestone implementation plan.
4. The living project snapshot.
5. Existing implementation details.

Do not silently reinterpret a higher-priority document. Stop and surface a conflict when a requested change would alter approved scope, game rules, security boundaries, or architecture.

## Product invariants

- This is a private, account-free multiplayer browser game.
- The server is authoritative for rules, turns, timers, scores, roles, and room lifecycle.
- Operatives and spectators must never receive unrevealed ownership data.
- The UI is React DOM, not Phaser or canvas.
- Cloudflare Workers, Durable Objects, R2, and Workers AI are the approved platform.
- Theme packs may contain host-supplied images, but the shipped app contains no unlicensed franchise artwork.
- AI assistance generates editable text suggestions only in the MVP.
- Temporary room state and assets expire after 24 hours of inactivity.
- Co-op, powers, double agents, team switching, TV mode, full skins, public packs, and persistent accounts are post-MVP.

## Execution protocol

- Execute one active-plan task at a time.
- Use test-driven development: failing test, observed failure, minimal implementation, passing test, then broader verification.
- Keep plan checkboxes accurate; never mark a step complete without fresh evidence.
- Make one focused commit per accepted plan task.
- Do not pull future-milestone behavior forward unless an approved interface explicitly requires a seam.
- Prefer small files with one responsibility and the interfaces named in the plan.
- Do not add production dependencies that are absent from the plan without recording and approving the reason.
- Never expose durable seat or host tokens in URLs, logs, browser-visible projections, or test snapshots.

## Snapshot discipline

docs/PROJECT_SNAPSHOT.md is the compact handoff for every agent.

- The primary/coordinating agent updates it after each reviewed task, approved scope change, or milestone transition.
- A worker agent reads it but does not edit it; the worker includes proposed snapshot changes in its handoff.
- An agent working alone acts as the coordinator and updates it after verification.
- Keep it concise: current state, active task, verified commands, accepted decisions, blockers, and next action.
- Historical detail belongs in Git history, the design spec, or milestone plans—not in the snapshot.

## Verification

Before reporting completion, run the exact checks required by the active task. Once the workspace is scaffolded, the repository-wide baseline is:

- npm run check
- npm run test:e2e for tasks that change a user-visible multiplayer flow
- git diff --check
- git status --short

Report the commands and observed results. Do not claim unrun checks pass.

## Code review rules

- Reject any client payload that contains hidden ownership for an operative or spectator.
- Reject client-authored state replacement; clients may send commands only.
- Reject timer behavior based on a client clock.
- Reject pack import paths that can execute content or escape the archive root.
- Reject scope additions that bypass the approved milestone sequence.
- Require a regression test for every gameplay, authorization, reconnect, and pack-validation defect.
