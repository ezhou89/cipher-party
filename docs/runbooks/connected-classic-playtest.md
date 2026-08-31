# Connected Classic four-human playtest

> **Human playtest: NOT YET RUN**

This is the required Connected Classic human exit gate. Automated checks and a preliminary release gate are preconditions, not substitutes for four humans using four isolated browser profiles or devices. Keep the results record below blank or `PENDING` until the session actually occurs.

## Session setup

Use four human participants and four isolated browser profiles or devices. At least one must be the narrowest available phone or a browser profile set to a phone-sized viewport. Do not share a browser profile, because each seat's credentials live in IndexedDB.

Assign the seats so both teams have exactly one clue-giver and one operative:

| Human | Isolated client  | Team | Role                  |
| ----- | ---------------- | ---- | --------------------- |
| A     | Profile/device A | Red  | Clue-giver (and host) |
| B     | Profile/device B | Red  | Operative             |
| C     | Profile/device C | Blue | Clue-giver            |
| D     | Profile/device D | Blue | Operative             |

Before inviting players:

```bash
npm install
npm run check:release
npm run dev
```

If `npm run check:release` reveals a critical defect, stop and apply the regression rule below before scheduling the human session. Keep `npm run dev` running for the session and have every profile/device open <http://127.0.0.1:5173>. If physical devices cannot reach loopback on the host computer, use an explicitly configured shared test origin and record that origin; do not improvise a production deploy.

## Procedure

1. In client A, create a room. Start the invite-to-first-clue timer when the host shares the displayed invite URL.
2. Humans B, C, and D independently open that invite and join from their assigned isolated clients. Record any uncertainty about joining, team assignment, role assignment, locking, or who acts first.
3. The host assigns the four seats exactly as shown above, locks the room, and starts the board. The clue-giver for the authoritative starting team submits the first clue. Stop and record the invite-to-first-clue timer when that clue is visible to all four clients.
4. Continue normal human play. For every nomination, note whether the nominating human understood it was only a nomination and whether the confirmation dialog prevented an unintended reveal. Record every accidental nomination or reveal, including the card and circumstances.
5. On the narrowest client, inspect all 25 cards, clue/turn status, nomination state, confirmation dialog, and revealed ownership. Record wrapping, clipping, overlap, horizontal page scrolling, or unreadable text.
6. During an active guessing phase, start a recovery timer and refresh one operative client. Stop the timer only when the same seat, current clue, board reveals, active team, and usable controls are restored. Record whether the other three clients continued normally.
7. Play until the authoritative result appears. After every reveal, compare the revealed card and owner on all four clients. At completion, compare the winning team and completion reason on all four clients.
8. Complete every field in the results record. A result stays `PENDING` if it was not directly observed. Log each concrete defect with reproduction steps; do not infer a pass from the absence of a note.

## Pending results record

**Human playtest: NOT YET RUN**

- Date: `PENDING (YYYY-MM-DD)`
- Test origin: `PENDING`
- Facilitator: `PENDING`
- Overall result: `PENDING — PASS or FAIL only after the full session`

### Clients

| Human | Device or viewport | OS      | Browser and version | Input method | Narrowest? |
| ----- | ------------------ | ------- | ------------------- | ------------ | ---------- |
| A     | PENDING            | PENDING | PENDING             | PENDING      | PENDING    |
| B     | PENDING            | PENDING | PENDING             | PENDING      | PENDING    |
| C     | PENDING            | PENDING | PENDING             | PENDING      | PENDING    |
| D     | PENDING            | PENDING | PENDING             | PENDING      | PENDING    |

### Required observations

| Metric                                            | Recorded value | Pass/Fail | Concrete observation or defect ID |
| ------------------------------------------------- | -------------- | --------- | --------------------------------- |
| Invite-to-first-clue elapsed time                 | PENDING        | PENDING   | PENDING                           |
| Role-assignment confusion                         | PENDING        | PENDING   | PENDING                           |
| Accidental nomination or reveal                   | PENDING        | PENDING   | PENDING                           |
| Card readability on the narrowest client          | PENDING        | PENDING   | PENDING                           |
| Guessing-phase refresh recovery time              | PENDING        | PENDING   | PENDING                           |
| All clients converged on every reveal             | PENDING        | PENDING   | PENDING                           |
| All clients agreed on the final winner and reason | PENDING        | PENDING   | PENDING                           |

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
4. Repeat the affected human steps with four humans and record the new evidence. The milestone can close only when the relevant human playtest has no critical blocker.
