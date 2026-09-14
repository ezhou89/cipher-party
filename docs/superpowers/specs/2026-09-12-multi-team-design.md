# Cipher Party Multi-Team Design

**Date:** 2026-09-12

**Status:** Approved — user approved the amended direction on 2026-09-12.

**Parent design:** [Cipher Party Multiplayer Web Game Design](2026-08-30-cipher-party-design.md)

## 1. Purpose

The current connected Classic slice is intentionally two-team. This amendment brings the delivered product toward the approved product target: a host can choose two, three, or four teams before a board starts. Two teams remain the default, while the rules, protocol, room state, board generator, and UI work for the selected team count.

The feature must support 4–16 active players and up to 16 spectators, subject to the role minimums below. It is a configurable room rule, not a separate game mode.

## 2. Scope and non-goals

### In scope

- Host-selectable `teamCount`: `2`, `3`, or `4`; default `2`.
- Stable canonical team slots and labels for all supported counts.
- A single-board Classic text implementation with board generation and scoring for all three counts.
- Team-aware lobby assignment, turn rotation, challenges, projections, history, and score UI.
- Hazard behavior that eliminates only the active team on three- and four-team boards.
- An explicit versioned state/projection contract, including grid dimensions and elimination state.
- Backward-compatible decoding of existing two-team room snapshots.
- Automated and browser coverage for every supported count, plus two-team regression coverage and a dedicated four-team human session.

### Out of scope

- Arbitrary custom team names, colors, or symbols.
- Changing team count or switching a player’s team after a board has started.
- Co-op, power cards, double agents, sudden team switching, or other experimental rules.
- Mid-board clue-giver rotation.
- Blitz timers, campaign scoring/rotation, best-of-3/5/7 flow, and campaign summaries. The later Party Modes milestone will consume this team model.
- Pack Studio, image uploads, AI suggestions, picture boards, and mixed-card rendering. The board surface must remain extensible, but those assets are not part of this increment.
- Public matchmaking, accounts, built-in voice, or licensed franchise assets.

## 3. Canonical team model

Team identity is a stable domain value, not a display-only string. The supported slots are ordered and never renumbered:

| Slot | ID | Default label | Visual identity |
| --- | --- | --- | --- |
| 1 | `red` | Ruby | red accent, diamond symbol, diamond reveal pattern |
| 2 | `blue` | Cobalt | blue accent, circle symbol, circle reveal pattern |
| 3 | `green` | Verdant | green accent, triangle symbol, triangle reveal pattern |
| 4 | `yellow` | Amber | yellow accent, square symbol, square reveal pattern |

For a selected count `N`, the configured team list is the first `N` slots in this order. A room never has a hole in its configured list: three-team rooms use red, blue, and green; four-team rooms use all four. A configured team may later be marked eliminated by the multi-team hazard rule. Existing red/blue labels and IDs remain unchanged.

The UI must render every team with label, color, symbol, and pattern so color is never the sole identifier. Team presentation is centralized in the existing team-presentation module rather than duplicated in views.

## 4. Room configuration and lobby rules

Add a persisted room setting:

```ts
teamCount: 2 | 3 | 4
```

The host selects it in the lobby. The default is `2`. The setting is locked when the lobby locks or the first board starts. In this single-board increment, changing it after the board starts is rejected. When campaign flow is added later, the same value will be fixed for that campaign; campaign rotation is not implemented here. A host may change the count only while the room is unlocked and in the lobby; once locked or started, the server rejects the command.

Team assignment and validation use only the configured team list. Randomization distributes active players as evenly as possible across those teams. Manual assignment can be used by the host, but a board cannot start unless:

- every active team has one clue-giver and at least one operative;
- each team therefore has at least two active seats; and
- active team sizes differ by no more than one.

The minimum active-player count is consequently `2 × teamCount` (4, 6, or 8), and the maximum remains 16. The lobby shows the selected count’s minimum and a blocking explanation when it is not met. Spectators do not satisfy a team minimum. A player can be a host and still be assigned to a team.

There is no mid-board reassignment. A disconnected clue-giver may be replaced by the host using the existing recovery flow; the replacement must be an eligible operative on that same team.

## 5. Board sizes and ownership distributions

Board generation takes the selected configured team list rather than assuming an `otherTeam`. The server derives the following exact distribution from `teamCount`:

| Teams | Grid | Starting team | Each other team | Neutral | Hazard | Total |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 5 × 5 (25) | 9 | 8 | 7 | 1 | 25 |
| 3 | 5 × 6 (30) | 8 | 7 | 7 | 1 | 30 |
| 4 | 6 × 6 (36) | 8 | 7 | 6 | 1 | 36 |

The starting team is selected from the configured team list at board creation using the existing deterministic board seed (`boardSeed/board-0/starting-team`). Ownership assignment is deterministic for that board seed and contains exactly one hazard. Campaign seed/index derivation is deferred to the later campaign design. Board generation fails with a clear validation error when the selected card pool cannot supply enough unique cards for the requested grid.

Generalize ownership counting and win calculations to iterate over active teams. No consumer may assume that a team has exactly one opponent or that red and blue are the only ownership values.

## 6. Turn, challenge, and hazard rules

### 6.1 Turn rotation

Turns follow the canonical active-team order, beginning with the generated starting team and wrapping at the end. When a team is eliminated, it is skipped. A normal turn still consists of clue and guessing phases, with the existing clue syntax, reveal confirmation, deadlines, and stale-command protections.

An opposing clue-giver means any clue-giver whose team is active and differs from the current team. The current team’s clue-giver cannot challenge its own clue. Authorization and challenge notifications must work for two, three, and four teams.

### 6.2 Hazard elimination

On a two-team board, preserve the existing immediate-loss behavior: revealing the hazard awards the board to the opposing team.

On a three- or four-team board, revealing the hazard:

1. ends the active team’s turn;
2. marks that team eliminated for the board;
3. converts only that team’s unrevealed targets to neutral;
4. preserves already revealed cards and history for scoring/audit; the hazard reveal history entry carries the eliminated team as metadata;
5. removes the team from future turn, challenge, and operative authorization; and
6. updates every projection and score immediately.

If two or more active teams remain, play continues with the next non-eliminated team. If exactly one active team remains, that team wins immediately. A target belonging to an eliminated team cannot remain unrevealed ownership after elimination and therefore cannot later complete that team.

Persist explicit board elimination state (for example, `eliminatedTeams: TeamId[]`) rather than inferring it from card counts. For this single-board increment, affected seats become spectators for the remainder of the board; campaign seat restoration and clue-giver rotation are deferred to the later campaign design. Legacy two-team states decode with an empty list.

### 6.3 Transition and history atomicity

The current room model assigns one monotonically increasing revision to each accepted command and requires history revisions to be strictly increasing. Preserve that contract. A multi-team hazard reveal is therefore one composite `card_revealed` history entry with an optional `eliminatedTeam` field, not two entries with the same revision. The optional field is present only when a three- or four-team hazard eliminates the active team. The reducer/room transition must apply the reveal, elimination, target-to-neutral conversion, next-team selection, and public event atomically before broadcasting.

## 7. State, protocol, and privacy

### 7.1 Authoritative state

Room and game state must carry:

- `teamCount` and the ordered configured team list (or an equivalent derivation);
- each seat’s team assignment, role, and spectator status;
- the board’s `startingTeam`, grid dimensions, current team, and `eliminatedTeams`;
- per-team revealed-target counts; campaign totals are deferred to the later campaign design;
- the existing seed, deadlines, phase, nomination, clue, and history fields.

The reducer and room session must derive turn order, opposing teams, winner checks, and lobby constraints from these values. Remove two-team-only helpers such as a single `otherTeam` branch from shared paths. `ClassicGameState.board.startingTeam` is authoritative once a board exists; retain the room-level `startingTeam` only as the compatibility mirror for the board being created. A future campaign design must introduce an explicit next-board value rather than overloading this field.

State invariants are mandatory at construction, command dispatch, and snapshot load:

- `configuredTeams` is the first `teamCount` canonical slots, with no duplicates.
- `eliminatedTeams` is a unique subset of `configuredTeams`.
- Before terminal completion, `activeTeam` belongs to `configuredTeams` and is not eliminated.
- A board owner is a configured team, `neutral`, or `hazard`; there is exactly one hazard before and after any conversion.
- `rows × columns` equals the board card count: 5 × 5, 5 × 6, or 6 × 6 for team counts 2, 3, and 4 respectively.
- Seats assigned to an eliminated team cannot submit, challenge, nominate, confirm, or end a turn.
- `winner` and `completionReason` are both null unless the board is terminal; a non-terminal hazard elimination does not set either field.

### 7.2 Wire schemas and commands

- Use the expanded v2 wire contract for new clients: extend team and ownership schemas to the four canonical IDs while retaining the existing red/blue values.
- Add a strict `TeamCount` schema for 2–4 and validate it at room creation, lobby updates, board creation, and snapshot load.
- Add a host-authorized `set_team_count` command that is valid only in an unlocked lobby.
- Include `teamCount`, configured teams, board `rows`/`columns`, `eliminatedTeams`, and public revealed-target summaries in room/game payloads. Never include unrevealed target totals in public projections.
- Extend `card_revealed` history with optional `eliminatedTeam` metadata for a composite multi-team hazard transition; preserve one history entry per command revision.
- Keep commands host-authorized: selecting team count, assigning a seat, randomizing teams, and replacing a clue-giver must reject inactive team IDs and illegal phase changes.
- Normalize malformed or duplicate team lists at the boundary; never trust a client-provided opponent or winner.

### 7.3 Projection privacy

Public projections expose team labels, active/eliminated status, grid dimensions, revealed ownership, revealed-target summaries, and history, but not unrevealed ownership. Each active team’s clue-giver receives the existing full ownership key for the current board, including the hazard and other teams. Operatives and spectators receive the public projection only. After hazard elimination, eliminated-team seats receive the spectator projection and clue-giver keys reflect the eliminated team’s unrevealed cards as neutral. Projection tests must assert that adding teams does not leak the key to non-clue-givers or target totals.

## 8. UI and responsive behavior

- Lobby configuration shows a clear 2/3/4 team selector, minimum player count, and active team roster.
- Team assignment panels render two, three, or four canonical teams without empty placeholder columns.
- Game HUD, score cards, history, turn labels, result screens, and reconnect/error messages iterate over configured teams. Campaign standings are deferred.
- Eliminated teams remain visible in board history and the team roster with an explicit “eliminated” state, but cannot receive new turns or nominations.
- The board receives `rows` and `columns` from the projection and renders a stable CSS grid: 5 × 5, 5 × 6, or 6 × 6. It must not infer dimensions from card count or reflow card order between clients.
- Five-by-six and six-by-six boards use the existing bounded board viewport and a visible pan/zoom affordance; a card’s first tap/click nominates only, and the existing explicit confirmation prevents an unintended reveal.
- Small-screen layouts collapse team details into the existing bottom sheet/side-panel pattern without hiding whose turn it is or the current team’s status.
- Team identity uses the centralized color/symbol/pattern presentation described in Section 3.

The play surface remains React DOM/CSS rather than canvas or Phaser. The board is the primary visual surface; the HUD keeps current team, phase, clue, guesses remaining, connection state, and the most important team status visible while secondary history/details remain collapsible. Four-team desktop layouts may show compact team chips with the current team expanded; four-team phone layouts must not place four equal-weight panels above the board. Green and Amber tokens require CSS variables and high-contrast/forced-colors treatment; yellow text on light card surfaces is not acceptable.

### 8.1 Input and focus map

The browser maps physical input to these explicit actions:

| Action | Pointer/touch | Keyboard/accessibility |
| --- | --- | --- |
| Nominate card | Tap/click an unrevealed card | Focus card, then Enter or Space |
| Confirm or cancel reveal | Dialog buttons | Enter confirms; Escape cancels and restores focus |
| Submit clue | Form submit button | Enter submits from the clue form |
| Challenge clue | Challenge button | Focus and activate the button |
| End turn / clear nomination | Visible controls | Focus and activate the button |
| Hide/show clue-giver key | Privacy veil control | Enter/Space; Escape hides the key |
| Pan/zoom board | Scroll, drag, or pinch where supported | Native scroll plus an accessible zoom control; no gesture-only path |

Focus must return to the triggering card after a canceled reveal, to the status fallback after a reconnect when the trigger is gone, and to the next active-team status after elimination. Timer or connection updates must not steal focus. Reduced-motion and forced-colors modes remain supported.

### 8.2 Asset boundary

This increment adds no raster or external-font assets. Team identity uses existing CSS/text primitives and centralized presentation data. Picture and mixed-card content will later use the Pack Studio manifest and accessible image labels; this board implementation must leave a content slot for that work without importing its asset pipeline now.

### 8.3 Pacing and rendering budget

Classic remains untimed in this increment; Blitz owns server deadlines later. The facilitator records invite-to-first-clue and board duration during human sessions, along with idle-turn observations, so a pacing target can be set from evidence without silently introducing a new rule. Countdown or connection updates must update status selectors only, preserve stable card keys, and avoid rerendering the full 36-card grid.

## 9. Compatibility and migration

The expanded contract is schema/protocol version 2. New snapshots and projections write `schemaVersion: 2` and `protocolVersion: 2`. The loader accepts a valid v1 snapshot, normalizes it to the v2 in-memory shape with `teamCount: 2`, configured teams `[red, blue]`, 5 × 5 dimensions, and an empty elimination list, and writes v2 on the next successful state mutation. New clients speak v2; mixed-version sockets are rejected rather than partially interpreting a projection. No Durable Object SQL migration is required because the room state remains a versioned serialized snapshot.

The legacy room-level `startingTeam` field remains a compatibility mirror for the board being created; the board-level value is authoritative once play begins. A state with an invalid count, inactive seat assignment, duplicate configured team, eliminated starting/current team, mismatched dimensions, invalid ownership, or impossible event metadata is rejected with a safe room error and logged server-side without exposing hidden state. The server remains the source of truth for all validation.

## 10. Testing and acceptance

### Automated coverage

- Board generator properties for 2, 3, and 4 teams: dimensions, card count, exact distribution, one hazard, deterministic replay, and no duplicate cards.
- Reducer tests for turn rotation, opposing-clue-giver challenges, target completion, two-team hazard loss, multi-team hazard elimination, last-team win, stale commands, concurrent reveal/challenge races, and reconnect recovery.
- Protocol schema and projection tests for all team counts, v1-to-v2 defaults, invalid configurations, grid metadata, composite hazard history, and key privacy.
- Worker/room tests for lobby minimums, balanced assignment, host-only configuration, inactive-team rejection, eliminated-seat projection, snapshot migration, 16-player capacity, and hibernation/reload.
- Web tests for dynamic team panels, HUD/history/results, explicit 5 × 5/5 × 6/6 × 6 layouts, eliminated-team state, input/focus behavior, high-contrast team identity, and two-team visual regression.
- Browser smoke flows for a 2-team default room and a 4-team room with a deterministic hazard-elimination fixture. Capture screenshots at exact `320 × 780` and representative desktop widths for lobby, active play, and elimination states.

### Human playtest gates

- Keep the existing four-human Connected Classic session as the two-team regression gate. It remains valid and must not be weakened.
- Add a separate multi-team session on staging with eight active players/devices (two per team) for a four-team board. A six-player three-team session is recommended when available; automated coverage is required regardless.
- Use a facilitator-controlled deterministic test pack/seed or a test-only fixture to make hazard elimination reproducible without adding a production debug command or leaking the key to operatives.
- Record setup time, role/team comprehension, first-clue time, board duration, hazard-elimination comprehension, turn-skip clarity, reveal convergence across all profiles, recovery during active play, and mobile layout observations.
- A four-team implementation is not considered socially playtested if it has only unit tests or an automated browser flow.

### Acceptance criteria

1. A host can create a default two-team room without seeing any new required setup.
2. A host can choose three or four teams, and the lobby blocks start until every team has a clue-giver, operative, and balanced team size.
3. A three- or four-team board displays the exact distribution in Section 5 and rotates turns over only active teams.
4. A multi-team hazard eliminates only the active team, converts its unrevealed cards to neutral, updates all clients, and produces the correct winner when one team remains.
5. Operatives and spectators never receive unrevealed ownership in any team-count configuration.
6. A hazard transition is one atomic revision and one composite public history entry; no duplicate-revision history is produced.
7. Legacy v1 two-team snapshots load, normalize to v2, and behave as before.
8. The existing four-human two-team gate passes, and the separate eight-player four-team session observes hazard elimination and profile convergence.
9. The full release gate, local browser smoke suite, deployment attestation, and staging smoke suite pass before either human gate is marked complete.

## 11. Rollout

This is a targeted multi-team Classic slice pulled forward from the roadmap’s later Party Modes milestone. Implementation should proceed in dependency order: domain/board rules and invariants, v1-to-v2 snapshot/protocol normalization, projections/history, room/session/lobby authority, web presentation/input, then automated/browser verification. Keep the existing two-team path green throughout. After the release gate passes, deploy the reviewed source to the Cloudflare staging environment, re-attest the exact commit and bindings, run public smoke tests, and run both human gates in Section 10. Do not add Blitz, campaigns, Pack Studio, picture/mixed rendering, a production custom domain, or licensed content as part of this feature.

## 12. Decisions recorded

- Default remains two teams for fast, familiar setup.
- Three and four teams use larger rectangular boards and the exact distributions in Section 5.
- Multi-team hazard is an active-team elimination, not a whole-room loss.
- Canonical team slots are red, blue, green, and yellow; no arbitrary team customization is required for this increment.
- Team count is fixed once the single board starts; campaign-level fixation and rotation are deferred.
- New state/projection contracts are v2, with v1 snapshots normalized to the two-team default.
- A hazard reveal carries elimination metadata in the same history entry/revision rather than producing duplicate-revision events.
- The existing four-human two-team gate remains, and an eight-player four-team gate is required for social validation.
- This feature lands before the next full human playtest so the playtest exercises the actual 2–4 team target.
