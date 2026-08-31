# Connected Classic four-human playtest

> **Human playtest: NOT YET RUN**

This is the required Connected Classic human exit gate. Automated checks and a preliminary release gate are preconditions, not substitutes for four real humans using four isolated browser profiles or windows on the same host. Keep the results record below blank or `PENDING` until the session actually occurs.

## Session setup

Use four human participants and four isolated browser profiles or windows on the computer running the development servers. Every participant uses <http://127.0.0.1:5173>. Human B must use DevTools responsive mode at exactly `320 × 780` CSS pixels. Do not share a browser profile, because each seat's credentials live in IndexedDB.

Assign the seats so both teams have exactly one clue-giver and one operative:

| Human | Host-local browser profile/window | Viewport                             | Team | Role                  |
| ----- | --------------------------------- | ------------------------------------ | ---- | --------------------- |
| A     | Profile/window A                  | Normal desktop window                | Red  | Clue-giver (and host) |
| B     | Profile/window B                  | Exactly 320 × 780 CSS px in DevTools | Red  | Operative             |
| C     | Profile/window C                  | Normal desktop window                | Blue | Clue-giver            |
| D     | Profile/window D                  | Normal desktop window                | Blue | Operative             |

Before inviting players:

```bash
npm install
npm run check:release
npm run dev
```

If `npm run check:release` reveals a critical defect, stop and apply the regression rule below before scheduling the human session. Keep `npm run dev` running for the session and have every host-local profile/window open <http://127.0.0.1:5173>.

Physical multi-device validation requires a separately authorized HTTPS staging deployment and is not part of this local exit gate. Do not expose the loopback development server or improvise a LAN or production deployment.

## Procedure

1. In profile/window A, create a room. Start the invite-to-first-clue timer when the host shares the displayed invite URL.
2. Humans B, C, and D independently open that invite and join from their assigned host-local profiles/windows. Record any uncertainty about joining, team assignment, role assignment, locking, or who acts first.
3. The host assigns the four seats exactly as shown above, locks the room, and starts the board. The clue-giver for the authoritative starting team submits the first clue. Stop and record the invite-to-first-clue timer when that clue is visible in all four profiles/windows.
4. Continue normal human play. For every nomination, note whether the nominating human understood it was only a nomination and whether the confirmation dialog prevented an unintended reveal. Record every accidental nomination or reveal, including the card and circumstances.
5. In profile/window B at exactly `320 × 780` CSS pixels, inspect all 25 cards, clue/turn status, nomination state, confirmation dialog, and revealed ownership. Record wrapping, clipping, overlap, horizontal page scrolling, or unreadable text.
6. During an active guessing phase, start a recovery timer and refresh one operative profile/window. Stop the timer only when the same seat, current clue, board reveals, active team, and usable controls are restored. Record whether the other three profiles/windows continued normally.
7. Play until the authoritative result appears. After every reveal, compare the revealed card and owner in all four profiles/windows. At completion, compare the winning team and completion reason in all four profiles/windows.
8. Complete every field in the results record. A result stays `PENDING` if it was not directly observed. Log each concrete defect with reproduction steps; do not infer a pass from the absence of a note.

## Pending results record

**Human playtest: NOT YET RUN**

- Date: `PENDING (YYYY-MM-DD)`
- Test origin: `PENDING (must be http://127.0.0.1:5173)`
- Facilitator: `PENDING`
- Overall result: `PENDING — PASS or FAIL only after the full session`

### Host-local clients

| Human | Browser profile/window | Viewport (CSS px)             | OS      | Browser and version | Input method |
| ----- | ---------------------- | ----------------------------- | ------- | ------------------- | ------------ |
| A     | PENDING                | PENDING                       | PENDING | PENDING             | PENDING      |
| B     | PENDING                | PENDING (required: 320 × 780) | PENDING | PENDING             | PENDING      |
| C     | PENDING                | PENDING                       | PENDING | PENDING             | PENDING      |
| D     | PENDING                | PENDING                       | PENDING | PENDING             | PENDING      |

### Required observations

| Metric                                           | Recorded value | Pass/Fail | Concrete observation or defect ID |
| ------------------------------------------------ | -------------- | --------- | --------------------------------- |
| Invite-to-first-clue elapsed time                | PENDING        | PENDING   | PENDING                           |
| Role-assignment confusion                        | PENDING        | PENDING   | PENDING                           |
| Accidental nomination or reveal                  | PENDING        | PENDING   | PENDING                           |
| Card readability at exactly 320 × 780 CSS px     | PENDING        | PENDING   | PENDING                           |
| Guessing-phase refresh recovery time             | PENDING        | PENDING   | PENDING                           |
| All profiles/windows converged on every reveal   | PENDING        | PENDING   | PENDING                           |
| All profiles/windows agreed on winner and reason | PENDING        | PENDING   | PENDING                           |

### Reveal and result convergence

Record each reveal in order. Add rows as needed.

| Reveal # | Card    | Public owner | A agreed | B agreed | C agreed | D agreed | Notes/defect ID |
| -------- | ------- | ------------ | -------- | -------- | -------- | -------- | --------------- |
| PENDING  | PENDING | PENDING      | PENDING  | PENDING  | PENDING  | PENDING  | PENDING         |

- Final winning team: `PENDING`
- Completion reason: `PENDING`
- Four-client agreement: `PENDING`

### Concrete defects

| ID      | Severity | Reproduction steps | Expected | Observed | Likely owner | Status  | Regression test |
| ------- | -------- | ------------------ | -------- | -------- | ------------ | ------- | --------------- |
| PENDING | PENDING  | PENDING            | PENDING  | PENDING  | PENDING      | PENDING | PENDING         |

## Critical-defect regression rule

A critical defect includes hidden ownership exposure to a non-clue-giver, incorrect or divergent reveals/winner, an unauthorized destructive action, lost seat/game state that cannot recover, or any blocker that prevents completing the four-human board.

If a critical defect appears:

1. Stop the exit gate. Keep **Human playtest: NOT YET RUN** or mark the attempted session `FAIL`; do not mark Task 13 or the milestone complete.
2. Add and run a new failing automated regression test that reproduces the concrete defect before changing implementation.
3. Make the minimum fix, run the focused regression GREEN, then run `npm run check:release` and the Worker dry run again.
4. Repeat the affected human steps with four humans in the four host-local profiles/windows and record the new evidence. The milestone can close only when the relevant human playtest has no critical blocker.
