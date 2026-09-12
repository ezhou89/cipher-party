# Cipher Party Multi-Team Design

**Date:** 2026-09-12

**Status:** Proposed — the direction was confirmed in chat; this written spec is awaiting review.

**Parent design:** [Cipher Party Multiplayer Web Game Design](2026-08-30-cipher-party-design.md)

## 1. Purpose

The current connected Classic slice is intentionally two-team. This amendment brings the delivered product toward the approved product target: a host can choose two, three, or four teams before a board starts. Two teams remain the default, while the rules, protocol, room state, board generator, and UI work for the selected team count.

The feature must support 4–16 active players and up to 16 spectators, subject to the role minimums below. It is a configurable room rule, not a separate game mode.

## 2. Scope and non-goals

### In scope

- Host-selectable `teamCount`: `2`, `3`, or `4`; default `2`.
- Stable canonical team slots and labels for all supported counts.
- Classic board generation and scoring for all three counts.
- Team-aware lobby assignment, turn rotation, challenges, projections, history, and score UI.
- Hazard behavior that eliminates only the active team on three- and four-team boards.
- Backward-compatible decoding of existing two-team room snapshots.
- Automated and browser coverage for every supported count, plus two-team regression coverage.

### Out of scope

- Arbitrary custom team names, colors, or symbols.
- Changing team count or switching a player’s team after a board has started.
- Co-op, power cards, double agents, sudden team switching, or other experimental rules.
- Mid-board clue-giver rotation.
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

The host selects it in the lobby. The default is `2`. The setting is locked when the lobby locks or the first board starts and remains fixed for every board in a campaign. A host may choose a different count only before locking a new, unstarted room; changing it mid-board or mid-campaign is rejected.

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

The starting team is selected from the configured team list using the existing deterministic board seed. Ownership assignment is deterministic for a persisted campaign seed and board index, and contains exactly one hazard. Board generation fails with a clear validation error when the selected pack cannot supply enough unique cards for the requested grid.

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
4. preserves already revealed cards and history for scoring/audit;
5. removes the team from future turn, challenge, and operative authorization; and
6. updates every projection and score immediately.

If two or more active teams remain, play continues with the next non-eliminated team. If exactly one active team remains, that team wins immediately. A target belonging to an eliminated team cannot remain unrevealed ownership after elimination and therefore cannot later complete that team.

Persist explicit board elimination state (for example, `eliminatedTeams: TeamId[]`) rather than inferring it from card counts. Legacy two-team states decode with an empty list.

## 7. State, protocol, and privacy

### 7.1 Authoritative state

Room and game state must carry:

- `teamCount` and the ordered configured team list (or an equivalent derivation);
- each seat’s team assignment, role, and spectator status;
- the board’s `startingTeam`, current team, and `eliminatedTeams`;
- per-team target/reveal counts and campaign totals;
- the existing seed, deadlines, phase, nomination, clue, and history fields.

The reducer and room session must derive turn order, opposing teams, winner checks, and lobby constraints from these values. Remove two-team-only helpers such as a single `otherTeam` branch from shared paths.

### 7.2 Wire schemas and commands

- Extend team and ownership schemas to the four canonical IDs while retaining the existing red/blue wire values.
- Add a strict `TeamCount` schema for 2–4 and validate it at room creation, lobby updates, board creation, and snapshot load.
- Include `teamCount`, active/eliminated teams, and generalized scores in room/game payloads and public history where appropriate.
- Keep commands host-authorized: selecting team count, assigning a seat, randomizing teams, and replacing a clue-giver must reject inactive team IDs and illegal phase changes.
- Normalize malformed or duplicate team lists at the boundary; never trust a client-provided opponent or winner.

### 7.3 Projection privacy

Public projections expose team labels, active/eliminated status, revealed ownership, scores, and history, but not unrevealed ownership. Each active team’s clue-giver receives the existing full ownership key for the current board, including the hazard and other teams. Operatives and spectators receive the public projection only. After hazard elimination, clue-giver keys reflect the eliminated team’s unrevealed cards as neutral. Projection tests must assert that adding teams does not leak the key to non-clue-givers.

## 8. UI and responsive behavior

- Lobby configuration shows a clear 2/3/4 team selector, minimum player count, and active team roster.
- Team assignment panels render two, three, or four canonical teams without empty placeholder columns.
- Game HUD, score cards, history, turn labels, result screens, campaign standings, and reconnect/error messages iterate over active teams.
- Eliminated teams remain visible in history and campaign context with an explicit “eliminated” state, but cannot receive new turns or nominations.
- Five-by-six and six-by-six boards use the existing bounded board viewport and pan/zoom behavior; card order remains stable across clients.
- Small-screen layouts collapse team details into the existing bottom sheet/side-panel pattern without hiding whose turn it is or the current team’s status.
- Team identity uses the centralized color/symbol/pattern presentation described in Section 3.

## 9. Compatibility and migration

Existing room snapshots and local fixtures may omit `teamCount`, `configuredTeams`, or `eliminatedTeams`. Snapshot decoding must treat a missing team count as `2`, derive configured teams as `[red, blue]`, and use an empty elimination list. Existing red/blue seats, history, seeds, and board ordering must remain valid without a destructive migration.

New snapshots should write the explicit fields so subsequent loads are unambiguous. A state with an invalid count, inactive seat assignment, duplicate active team, or eliminated starting team is rejected with a safe room error and logged server-side without exposing hidden state. Mixed-version clients are not a product requirement for this private staging rollout; the server remains the source of truth for all validation.

## 10. Testing and acceptance

### Automated coverage

- Board generator properties for 2, 3, and 4 teams: dimensions, card count, exact distribution, one hazard, deterministic replay, and no duplicate cards.
- Reducer tests for turn rotation, opposing-clue-giver challenges, target completion, two-team hazard loss, multi-team hazard elimination, last-team win, stale commands, and reconnect recovery.
- Protocol schema and projection tests for all team counts, legacy defaults, invalid configurations, and key privacy.
- Worker/room tests for lobby minimums, balanced assignment, host-only configuration, seat replacement, campaign persistence, and hibernation/reload.
- Web tests for dynamic team panels, HUD/history/results, responsive board dimensions, eliminated-team state, and two-team visual regression.
- Browser smoke flows for a 2-team default room and a 4-team room with at least one hazard elimination.

### Acceptance criteria

1. A host can create a default two-team room without seeing any new required setup.
2. A host can choose three or four teams, and the lobby blocks start until every team has a clue-giver, operative, and balanced team size.
3. A three- or four-team board displays the exact distribution in Section 5 and rotates turns over only active teams.
4. A multi-team hazard eliminates only the active team, converts its unrevealed cards to neutral, updates all clients, and produces the correct winner when one team remains.
5. Operatives and spectators never receive unrevealed ownership in any team-count configuration.
6. Legacy two-team snapshots load and behave as before.
7. The full release gate, local browser smoke suite, deployment attestation, and staging smoke suite pass before human playtest.

## 11. Rollout

Implementation should proceed in dependency order: domain/board rules, protocol and projections, room/session/lobby authority, web presentation, then automated/browser verification. Keep the existing two-team path green throughout. After the release gate passes, deploy the reviewed source to the Cloudflare staging environment, re-attest the exact commit and bindings, run public smoke tests, and conduct a human session covering both the default two-team flow and a four-team hazard elimination. Do not add a production custom domain or licensed content as part of this feature.

## 12. Decisions recorded

- Default remains two teams for fast, familiar setup.
- Three and four teams use larger rectangular boards and the exact distributions in Section 5.
- Multi-team hazard is an active-team elimination, not a whole-room loss.
- Canonical team slots are red, blue, green, and yellow; no arbitrary team customization is required for this increment.
- Team count is fixed for a campaign and cannot change mid-board.
- This feature lands before the next human playtest so the playtest exercises the actual 2–4 team target.
