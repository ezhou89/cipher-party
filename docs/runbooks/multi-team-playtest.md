# Multi-team Classic eight-human playtest

> **Human playtest: NOT YET RUN**

This is the separate four-team social-validation gate. It requires eight real active participants, two per team, using eight distinct devices or browser credential stores named A through H. Each participant opens exactly one assigned game window. Automated browser coverage and the [four-human two-team regression gate](connected-classic-playtest.md) are preconditions, not substitutes for this session, and neither human gate replaces the other.

## Gate boundary

The counted session runs only against an explicitly authorized and freshly attested deployment at <https://staging.oddlyuseful.studio>. The Worker is `cipher-party-staging`; the apex domain is not part of this gate. A host-local rehearsal may find defects but cannot be recorded as the completed eight-human staging gate.

Use eight active participants and no pre-existing spectators. Assign exactly one clue-giver and one operative to each configured team:

| Human | Device or profile | Assigned windows | Team   | Role                  |
| ----- | ----------------- | ---------------- | ------ | --------------------- |
| A     | A                 | Exactly one      | Red    | Clue-giver (and host) |
| B     | B                 | Exactly one      | Red    | Operative             |
| C     | C                 | Exactly one      | Blue   | Clue-giver            |
| D     | D                 | Exactly one      | Blue   | Operative             |
| E     | E                 | Exactly one      | Green  | Clue-giver            |
| F     | F                 | Exactly one      | Green  | Operative             |
| G     | G                 | Exactly one      | Yellow | Clue-giver            |
| H     | H                 | Exactly one      | Yellow | Operative             |

At least one operative must use a real phone. Record every device's measured CSS viewport, OS, browser/version, and input method. A device model or browser preset is not a viewport measurement. Keep all eight credential stores isolated; extra tabs or windows invalidate reconnect and convergence evidence.

## Pre-session verification and staging attestation

From the exact reviewed source checkout, run:

```bash
pnpm install --frozen-lockfile
pnpm run check:release
```

Stop if the release gate fails. Do not deploy from this runbook. After a separately authorized deployment, build the same exact source locally and attest its full source SHA, Worker version, traffic, bindings, transport policy, and static bytes:

```bash
pnpm run check:staging --expected-commit FULL_SOURCE_SHA --expected-version WORKER_VERSION_UUID --expected-rooms-namespace f2766441dfa24d10bef55dd8ee4f5599
pnpm run smoke:staging:public
```

Replace the placeholders only with values from the reviewed deployment handoff. Do not guess them. The attestation and public smoke are read-only and do not create a multiplayer room. Stop if either command fails or if the deployment changes during verification. Record the successful output and timestamp below before opening the eight assigned windows. Do not use the apex domain, a preview URL, an improvised LAN server, or a different Durable Object namespace.

## Reproducible hazard setup

The session must exercise one multi-team hazard elimination. Before inviting participants, choose and record exactly one of these facilitator-controlled methods:

1. A reviewed test-only fixed card-pool/seed fixture already present in the attested build. Record its public fixture identifier and expected 6 × 6 geometry. Do not add or improvise a production query parameter, debug command, replacement state, or key-bearing URL.
2. The default staging card pool with clue-giver-directed hazard selection. After the board starts, the clue-giver for the authoritative opening team privately opens the ownership veil, identifies the one hazard, closes the veil, and directs only that team's operative to nominate and confirm it. Do not speak, chat, log, photograph, or transcribe the hazard label, card ID, position, ownership key, room credentials, or seed before the reveal makes the card public. The facilitator records the card only after the authoritative public reveal.

Method 2 is the default when no reviewed deterministic staging fixture exists. It makes the elimination reproducible without weakening the production protocol or disclosing the key to an operative or spectator.

## Timers

Use three independent elapsed timers:

- **Setup duration:** start when Human A opens the attested staging origin; stop when all eight assigned seats visibly agree on four configured teams, two seats per team, the assigned roles, and the locked lobby.
- **Invite-to-first-clue:** start when Human A shares the invite URL; stop when the first accepted clue is visible in all eight windows.
- **Board duration:** start when Human A activates **Start board**; stop when the authoritative board result is visible and agrees in all eight windows.

Also time the recovery step below from refresh until the same seat and usable authoritative state return.

## Procedure

1. Human A creates the room at the attested staging origin and selects four teams before locking. Start the setup timer when A first opens the origin and the invite-to-first-clue timer when A shares the displayed invite.
2. Humans B through H independently join from their one assigned window. A assigns the exact team/role matrix above. Before explaining any controls, ask each participant to state their team and role; record uncertainty or correction. Verify each team shows exactly two active seats, then lock the lobby. Stop the setup timer only after all eight windows agree on the locked roster.
3. Start the board and the board-duration timer. Verify all eight windows preserve the same 6 × 6 card order. The authoritative opening clue-giver submits a normal first clue. Stop the invite-to-first-clue timer only after the same clue, active team, and guessing phase appear in all eight windows.
4. Complete at least one ordinary nomination/cancel cycle before the hazard. Ask the active operative what the first activation did and whether the confirmation dialog prevented an unintended reveal. Record any accidental nomination or reveal.
5. Apply the recorded reproducible hazard method. Immediately after confirmation—and before the facilitator explains the rule—ask all eight participants to identify: the public owner of the revealed card, which team was eliminated, the new spectator status of both affected seats, and which team acts next. Record every incorrect or uncertain answer.
6. Confirm the eliminated team never receives another turn and both eliminated seats have only the spectator interface. The next team must be the next non-eliminated team in Red → Blue → Green → Yellow order with wraparound. Record whether the skip was clear from turn status, team progress, history, and controls.
7. Compare the hazard reveal, eliminated-team marker, next active team, and public history in all eight windows. The hazard must appear as one public reveal entry, not separate reveal and elimination entries. Never inspect another participant's credentials or use a clue-giver key as public-convergence evidence.
8. During a later active guessing phase, start the recovery timer and refresh one non-eliminated operative's assigned window. Stop only when the same seat, public history, reveals, current clue, active team, and usable operative controls return. Confirm the other seven windows continued normally and remained converged.
9. Continue normal play to the board result. After every reveal, compare the public card/owner and active team in all eight windows. At completion, compare the winner and completion reason across all eight profiles, then stop the board-duration timer.
10. On the smallest phone viewport, inspect the lobby, active 6 × 6 board, post-elimination team strip/history, nomination state, confirmation dialog, and recovery state. Record clipping, overlap, unreadable labels, inaccessible native scrolling, obscured turn status, or horizontal page scrolling. Automated exact `320 × 780` and `1280 × 900` screenshots remain separate evidence and do not replace this observation.
11. Complete every field below. Leave a field `PENDING` when it was not directly observed; absence of a note is not a pass.

## Pending results record

**Human playtest: NOT YET RUN**

- Date: `PENDING (YYYY-MM-DD)`
- Facilitator: `PENDING`
- Overall result: `PENDING — PASS or FAIL only after the full session`
- Staging source commit: `PENDING`
- Worker version at 100% traffic: `PENDING`
- Pre-session attestation timestamp/output: `PENDING`
- Public smoke timestamp/result: `PENDING`
- Hazard method and public fixture identifier (if any): `PENDING`

### Participants and devices

| Human | Participant | Unique device/profile | Assigned windows    | Measured CSS viewport | OS/browser/version | Input method | Team/role understood without correction |
| ----- | ----------- | --------------------- | ------------------- | --------------------- | ------------------ | ------------ | --------------------------------------- |
| A     | PENDING     | PENDING               | PENDING (must be 1) | PENDING               | PENDING            | PENDING      | PENDING                                 |
| B     | PENDING     | PENDING               | PENDING (must be 1) | PENDING               | PENDING            | PENDING      | PENDING                                 |
| C     | PENDING     | PENDING               | PENDING (must be 1) | PENDING               | PENDING            | PENDING      | PENDING                                 |
| D     | PENDING     | PENDING               | PENDING (must be 1) | PENDING               | PENDING            | PENDING      | PENDING                                 |
| E     | PENDING     | PENDING               | PENDING (must be 1) | PENDING               | PENDING            | PENDING      | PENDING                                 |
| F     | PENDING     | PENDING               | PENDING (must be 1) | PENDING               | PENDING            | PENDING      | PENDING                                 |
| G     | PENDING     | PENDING               | PENDING (must be 1) | PENDING               | PENDING            | PENDING      | PENDING                                 |
| H     | PENDING     | PENDING               | PENDING (must be 1) | PENDING               | PENDING            | PENDING      | PENDING                                 |

### Timing and comprehension

| Metric                                                        | Recorded value | Pass/Fail | Concrete observation or defect ID |
| ------------------------------------------------------------- | -------------- | --------- | --------------------------------- |
| Setup duration                                                | PENDING        | PENDING   | PENDING                           |
| Invite-to-first-clue duration                                 | PENDING        | PENDING   | PENDING                           |
| Total board duration                                          | PENDING        | PENDING   | PENDING                           |
| Recovery duration                                             | PENDING        | PENDING   | PENDING                           |
| Team/role comprehension before correction                     | PENDING        | PENDING   | PENDING                           |
| Nomination versus reveal comprehension                        | PENDING        | PENDING   | PENDING                           |
| Eliminated-team comprehension across A–H                      | PENDING        | PENDING   | PENDING                           |
| Spectator-conversion comprehension for both affected seats    | PENDING        | PENDING   | PENDING                           |
| Next-team and eliminated-team skip clarity                    | PENDING        | PENDING   | PENDING                           |
| Smallest-phone lobby/board/elimination readability            | PENDING        | PENDING   | PENDING                           |
| Native board-scroll discoverability and keyboard/touch access | PENDING        | PENDING   | PENDING                           |
| All eight profiles converged after every public change        | PENDING        | PENDING   | PENDING                           |
| All eight profiles agreed on winner and reason                | PENDING        | PENDING   | PENDING                           |

### Hazard-elimination checkpoint

- Opening team: `PENDING`
- Publicly revealed hazard card (record only after reveal): `PENDING`
- Eliminated team: `PENDING`
- Expected next non-eliminated team: `PENDING`
- Actual next team in A/B/C/D/E/F/G/H: `PENDING / PENDING / PENDING / PENDING / PENDING / PENDING / PENDING / PENDING`
- Affected clue-giver spectator view: `PENDING`
- Affected operative spectator view: `PENDING`
- One composite public history entry observed in all eight windows: `PENDING`
- Any hidden key shown or sent to an operative/spectator: `PENDING (must be NO)`

### Reveal and result convergence

Add one row per public reveal.

| Reveal # | Card    | Public owner | Active team after reveal | A       | B       | C       | D       | E       | F       | G       | H       | Notes/defect ID |
| -------- | ------- | ------------ | ------------------------ | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | --------------- |
| PENDING  | PENDING | PENDING      | PENDING                  | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING         |

- Final winning team: `PENDING`
- Completion reason: `PENDING`
- Eight-profile agreement: `PENDING`

### Mobile and recovery observations

- Smallest measured phone viewport and device: `PENDING`
- Lobby overflow/readability: `PENDING`
- Active 6 × 6 board bounds, labels, and scroll affordance: `PENDING`
- Post-elimination HUD/history/board overlap or horizontal page scroll: `PENDING`
- Refreshed participant and phase: `PENDING`
- Same seat and controls restored: `PENDING`
- Other seven profiles remained usable and converged: `PENDING`

### Concrete defects

| ID      | Severity | Reproduction steps | Expected | Observed | Likely owner | Status  | Regression test |
| ------- | -------- | ------------------ | -------- | -------- | ------------ | ------- | --------------- |
| PENDING | PENDING  | PENDING            | PENDING  | PENDING  | PENDING      | PENDING | PENDING         |

## Critical-defect regression rule

A critical defect includes hidden ownership or credentials exposed to a public role, divergent reveals/elimination/turn/winner state, more than one revision or public entry for the hazard command, an eliminated seat retaining gameplay authority, unrecoverable seat/game state, unusable phone layout, or any blocker preventing completion with all eight humans.

If a critical defect appears:

1. Stop the gate and record `FAIL`; keep **Human playtest: NOT YET RUN** until a complete later session passes.
2. Add and observe a focused failing automated regression before changing implementation.
3. Make the minimum authorized fix, rerun the focused regression and `pnpm run check:release`, obtain review, and use a separately authorized staging deployment.
4. Re-attest the exact deployment and rerun the affected steps with all eight humans, eight isolated credential stores, and one assigned window each.

No automated result, partial attendance, extra-window simulation, or facilitator inference can mark this gate complete.
