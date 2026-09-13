# Configurable Multi-Team Classic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the connected Classic game from a two-team-only board to a host-selectable two-, three-, or four-team single-board Classic game while preserving legacy rooms, privacy, and the existing two-team experience.

**Architecture:** Keep the server-authoritative Cloudflare Durable Object and pure `@cipher-party/game-core` reducer. The core owns serializable board/game state and transition invariants; the Worker owns room/lobby authority, v1-to-v2 snapshot normalization, and one-revision public history; the React DOM client renders projection-provided grid/team metadata and never infers hidden ownership or game authority.

**Tech Stack:** TypeScript, React 19, Vite, Zod, Vitest, fast-check, Playwright, Cloudflare Workers, SQLite-backed Durable Objects, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-12-multi-team-design.md` (approved 2026-09-12)

## Global Constraints

- Host-selectable `teamCount` is `2`, `3`, or `4`, with default `2`; it may change only in an unlocked lobby.
- Canonical configured slots are ordered `red`, `blue`, `green`, `yellow`; three-team rooms use the first three and four-team rooms use all four.
- Board distributions are exact: 2 teams = 5 × 5 with 9/8/7/1; 3 teams = 5 × 6 with 8/7/7/1; 4 teams = 6 × 6 with 8/7/6/1.
- Each configured team needs exactly one clue-giver and at least one operative; team sizes differ by no more than one; minimum active seats are 4, 6, or 8.
- Multi-team hazard eliminates only the active team, converts its unrevealed targets to neutral, skips it in future turns, and awards the board immediately only when one team remains.
- One accepted command produces one monotonically increasing revision and one public history entry; a multi-team hazard uses optional `eliminatedTeam` metadata on its `card_revealed` entry.
- New state and wire contracts are v2; valid v1 two-team snapshots normalize to v2 with `teamCount: 2`, `[red, blue]`, 5 × 5 dimensions, and no eliminations.
- Persisted `initialOwners` provenance is server-only, keyed by card ID, and must never appear in any client projection.
- Operatives and spectators never receive unrevealed ownership or unrevealed target totals; clue-giver keys remain complete and role-specific.
- This increment is a single-board Classic text implementation. Blitz, campaigns, campaign scoring/rotation, Pack Studio, AI, picture/mixed cards, and licensed content are not implemented here.
- The play surface remains React DOM/CSS rather than canvas or Phaser; team identity uses centralized CSS/text presentation with redundant label, symbol, color, and pattern.
- Preserve the existing 16 active-seat and 16 spectator capacities, Cloudflare room/ticket/socket safeguards, deterministic seed streams, and source-bound release workflow.
- Keep the existing four-human two-team playtest as a regression gate and add a separate eight-active-player four-team gate before claiming multi-team social validation.
- Do not deploy to staging, change domains, alter the Durable Object namespace, or add paid services without a separate explicit release authorization after verification.

## File Map

### Core simulation

- Create `packages/game-core/src/team-rules.ts` for canonical team IDs, team counts, configured-team derivation, board specifications, and deterministic starting-team selection.
- Modify `packages/game-core/src/domain.ts` and `packages/game-core/src/index.ts` to expose the four-team domain values and helpers.
- Modify `packages/game-core/src/board.ts` to generate 25/30/36-card boards from the selected team count and expose `rows`/`columns`.
- Modify `packages/game-core/src/reducer.ts` to track eliminations, skip eliminated teams, and expose transition metadata without breaking `applyGameAction` callers.
- Extend `packages/game-core/src/domain.test.ts`, `board.test.ts`, and `reducer.test.ts` with table-driven and property tests.

### Protocol and projections

- Modify `packages/protocol/src/commands.ts` for protocol v2, `TeamCount`, four-team assignment, and `set_team_count`.
- Modify `packages/protocol/src/projections.ts` for v2 team/grid/elimination metadata, revealed-only summaries, and composite hazard history.
- Modify `packages/protocol/src/transport.ts` only where protocol-version parsing or error fixtures require it.
- Update `packages/protocol/src/projections.typecheck.ts` and all protocol tests/fixtures.

### Worker room authority and persistence

- Modify `apps/worker/src/room/room-state.ts` for persisted team configuration and v2 state.
- Modify `apps/worker/src/room/room-snapshot.ts` for strict v1 acceptance, v1-to-v2 normalization, and dynamic board/game invariants.
- Modify `apps/worker/src/room/room-session.ts` for dynamic lobby validation, assignment, authorization, elimination seat transitions, and transition history.
- Update `apps/worker/src/room/room-session.test.ts`, `apps/worker/test/room-snapshot.test.ts`, `apps/worker/test/room-durable-object.test.ts`, and related command envelopes.

### React game and lobby UI

- Modify `apps/web/src/lib/team-presentation.ts` and `apps/web/src/components/TeamPanel.tsx` for all four canonical teams.
- Modify `apps/web/src/features/lobby/LobbyView.tsx` for team-count selection, dynamic assignment/readiness, and eliminated-seat copy.
- Modify `apps/web/src/features/game/GameView.tsx`, `TeamScore.tsx`, `BoardResult.tsx`, `GameHistory.tsx`, `BoardGrid.tsx`, and `BoardCard.tsx` for dynamic teams, dimensions, and elimination announcements.
- Modify `apps/web/src/styles/globals.css` and `tokens.css` for CSS-grid dimensions, four-team HUD density, mobile board viewport, contrast, and forced-colors behavior.
- Update `apps/web/src/features/lobby/LobbyView.test.tsx` and `apps/web/src/features/game/GameView.test.tsx`; add focused presentation tests where a component has a new independent contract.

### Browser verification and operating docs

- Modify `e2e/helpers/room.ts` without weakening the current credential/privacy observer.
- Keep `e2e/connected-classic.spec.ts` as the two-team regression and add `e2e/multi-team.spec.ts` for a four-team flow and hazard elimination.
- Update `docs/runbooks/connected-classic-playtest.md` with the unchanged two-team gate and create `docs/runbooks/multi-team-playtest.md` for the eight-player staging session.
- The root coordinator updates `docs/PROJECT_SNAPSHOT.md` after each accepted implementation task; implementers do not rewrite the snapshot.

---

### Task 1: Canonical teams and board geometry

**Files:**

- Create: `packages/game-core/src/team-rules.ts`
- Modify: `packages/game-core/src/domain.ts`, `packages/game-core/src/index.ts`, `packages/game-core/src/board.ts`
- Test: `packages/game-core/src/domain.test.ts`, `packages/game-core/src/board.test.ts`, `packages/game-core/src/reducer.test.ts`, `packages/protocol/src/projections.test.ts` (compatibility fixture metadata only)

**Interfaces:**

- Consumes: existing `TextCard`, seeded random streams, and two-team `createClassicBoard` callers.
- Produces: `TeamId`, `TeamCount`, `TEAM_IDS`, `configuredTeams(teamCount)`, `classicBoardSpec(teamCount)`, `chooseStartingTeam(teamCount, seed)`, and a `ClassicBoard` containing `teamCount`, `configuredTeams`, `rows`, `columns`, `order`, `cards`, and `startingTeam`.

- [x] **Step 1: Add failing domain/geometry tests.**

Add table-driven tests that assert the canonical IDs and exact board specifications:

```ts
it.each([
  [2, 5, 5, 25, 9, 8, 7],
  [3, 5, 6, 30, 8, 7, 7],
  [4, 6, 6, 36, 8, 7, 6],
] as const)(
  "derives the %d-team board specification",
  (teamCount, rows, columns, cardCount, startingTargets, otherTargets, neutralCards) => {
    expect(classicBoardSpec(teamCount)).toMatchObject({
      teamCount,
      rows,
      columns,
      cardCount,
      startingTargets,
      otherTargets,
      neutralCards,
      hazardCards: 1,
    });
  },
);

it("derives configured teams without holes", () => {
  expect(configuredTeams(2)).toEqual(["red", "blue"]);
  expect(configuredTeams(3)).toEqual(["red", "blue", "green"]);
  expect(configuredTeams(4)).toEqual(["red", "blue", "green", "yellow"]);
});
```

- [x] **Step 2: Run the focused tests and verify the RED failure.**

Run:

```bash
pnpm --filter @cipher-party/game-core test -- src/domain.test.ts src/board.test.ts
```

Expected: failures because the current domain exposes only Red/Blue and `classicBoardSpec` does not exist.

- [x] **Step 3: Implement the canonical team rules.**

Create the central catalog with strict count validation:

```ts
export const TEAM_IDS = ["red", "blue", "green", "yellow"] as const;
export type TeamId = (typeof TEAM_IDS)[number];
export const TEAM_COUNTS = [2, 3, 4] as const;
export type TeamCount = (typeof TEAM_COUNTS)[number];

export interface ClassicBoardSpec {
  teamCount: TeamCount;
  rows: 5 | 6;
  columns: 5 | 6;
  cardCount: 25 | 30 | 36;
  startingTargets: 8 | 9;
  otherTargets: 7 | 8;
  neutralCards: 6 | 7;
  hazardCards: 1;
}

export function configuredTeams(teamCount: TeamCount): TeamId[];
export function classicBoardSpec(teamCount: TeamCount): ClassicBoardSpec;
export function chooseStartingTeam(teamCount: TeamCount, seed: string): TeamId;
```

Update `Ownership` to be `TeamId | "neutral" | "hazard"`, export the helpers from `index.ts`, and keep invalid counts impossible at typed call sites while validating runtime inputs in protocol/Worker boundaries.

- [x] **Step 4: Generalize deterministic board generation.**

Change `createClassicBoard` to accept `teamCount`, derive the spec, validate `uniqueCardIds >= spec.cardCount`, select/order exactly `spec.cardCount` cards using the existing `/cards` and `/grid-order` streams, and build ownership as:

```ts
[
  ...Array<Ownership>(spec.startingTargets).fill(startingTeam),
  ...configuredTeams(teamCount)
    .filter((teamId) => teamId !== startingTeam)
    .flatMap((teamId) => Array<Ownership>(spec.otherTargets).fill(teamId)),
  ...Array<Ownership>(spec.neutralCards).fill("neutral"),
  "hazard",
]
```

Return `rows`, `columns`, `teamCount`, and a copied `configuredTeams` array. Make `countOwnership` initialize all four team keys plus neutral/hazard and count only the owners present.

- [x] **Step 5: Add RED-to-GREEN coverage for all distributions and determinism.**

Extend `board.test.ts` to assert every table row, exact card/order lengths, all configured owners, one hazard, duplicate rejection, deterministic replay for the same seed/team count, different starting-team selection across eligible slots, and preservation of the existing 25-card two-team board shape.
Update the existing fixed-board fixture in `reducer.test.ts` with the required two-team metadata so the new `ClassicBoard` interface remains strict without weakening reducer tests.
Update the manually constructed board in `packages/protocol/src/projections.test.ts` with the same 5 × 5/two-team metadata; this is a compile-only fixture adjustment, while projection behavior remains Task 3's responsibility.

Run:

```bash
pnpm --filter @cipher-party/game-core test -- src/domain.test.ts src/board.test.ts
pnpm --filter @cipher-party/game-core typecheck
```

- [x] **Step 6: Commit the core geometry slice.**

```bash
git add packages/game-core/src/domain.ts packages/game-core/src/team-rules.ts packages/game-core/src/index.ts packages/game-core/src/board.ts packages/game-core/src/domain.test.ts packages/game-core/src/board.test.ts
git commit -m "feat: generalize classic boards to four teams"
```

### Task 2: Multi-team reducer and transition metadata

**Files:**

- Modify: `packages/game-core/src/reducer.ts`
- Test: `packages/game-core/src/reducer.test.ts`

**Interfaces:**

- Consumes: `ClassicBoard` team metadata and `TeamId` helpers from Task 1.
- Produces: `ClassicGameState.eliminatedTeams`, `GameTransitionEvent`, `GameTransition`, `applyGameActionWithEvent(state, action)`, and backward-compatible `applyGameAction(state, action)`.

- [x] **Step 1: Add failing reducer tests for rotation, challenges, and hazard elimination.**

Add a three-team fixed-board fixture and tests with these exact assertions:

```ts
expect(applyGameAction(state, { type: "end_turn", teamId: "red" }).activeTeam)
  .toBe("blue");
expect(applyGameAction(blueState, { type: "end_turn", teamId: "blue" }).activeTeam)
  .toBe("green");
expect(applyGameAction(greenState, { type: "end_turn", teamId: "green" }).activeTeam)
  .toBe("red");

const transition = applyGameActionWithEvent(hazardGuessState, confirmHazard);
expect(transition.state.eliminatedTeams).toEqual([hazardGuessState.activeTeam]);
expect(transition.event).toMatchObject({
  type: "card_revealed",
  owner: "hazard",
  eliminatedTeam: hazardGuessState.activeTeam,
});
expect(transition.state.phase).toBe("clue");
expect(transition.state.winner).toBeNull();
```

Also add tests for a four-team turn skipping an eliminated team, any non-active active clue-giver challenging, two-team hazard immediate loss, last-team-wins after elimination, target-to-neutral conversion, stale/duplicate card rejection, and no mutation of the input state.

- [x] **Step 2: Run the focused reducer tests and verify the RED failure.**

```bash
pnpm --filter @cipher-party/game-core test -- src/reducer.test.ts
```

Expected: failures because state has no elimination list, turn advancement calls `otherTeam`, and hazard always completes the board.

- [x] **Step 3: Add transition metadata without changing existing callers.**

Add these exported types and wrapper:

```ts
export interface GameTransitionEvent {
  type: "card_revealed";
  cardId: CardId;
  owner: Ownership;
  eliminatedTeam?: TeamId;
}

export interface GameTransition {
  state: ClassicGameState;
  event: GameTransitionEvent | null;
}

export function applyGameActionWithEvent(
  state: ClassicGameState,
  action: GameAction,
): GameTransition;

export function applyGameAction(
  state: ClassicGameState,
  action: GameAction,
): ClassicGameState {
  return applyGameActionWithEvent(state, action).state;
}
```

All non-reveal actions return `event: null`; every accepted reveal returns the authoritative card ID/owner, with `eliminatedTeam` only for a non-two-team hazard.

- [x] **Step 4: Implement active-team iteration and hazard semantics.**

Replace `otherTeam` with helpers that filter `board.configuredTeams` by `eliminatedTeams`. Ensure `requireOpposingTeam` accepts any non-eliminated team other than `activeTeam`, and `advanceTurn` wraps over the remaining teams. On a multi-team hazard, reveal the hazard, convert only unrevealed cards owned by the active team to neutral, append the team once to `eliminatedTeams`, and either advance to the next remaining team or complete the board for the sole remaining team. Keep two-team hazard loss unchanged.

- [x] **Step 5: Run reducer, type, and property coverage.**

```bash
pnpm --filter @cipher-party/game-core test -- src/reducer.test.ts
pnpm --filter @cipher-party/game-core typecheck
```

Add a fast-check property that every non-terminal transition leaves `activeTeam` configured and non-eliminated, and that `eliminatedTeams` remains unique and a subset of configured teams.

- [x] **Step 6: Commit the reducer slice.**

```bash
git add packages/game-core/src/reducer.ts packages/game-core/src/reducer.test.ts
git commit -m "feat: add multi-team classic transitions"
```

### Task 3: Protocol v2 and projection contract

**Files:**

- Modify: `packages/protocol/src/commands.ts`, `packages/protocol/src/projections.ts`, `packages/protocol/src/transport.ts`, `packages/protocol/src/projections.typecheck.ts`
- Test: `packages/protocol/src/commands.test.ts`, `packages/protocol/src/projections.test.ts`, `packages/protocol/src/transport.test.ts`

**Interfaces:**

- Consumes: Task 1 team types and Task 2 `GameTransitionEvent` shape.
- Produces: `PROTOCOL_VERSION = 2`, strict `TeamCountSchema`, `set_team_count`, v2 `ProjectionBase`, `PublicBoard` grid/team/elimination fields, public revealed-only team summaries, and optional `eliminatedTeam` history metadata.

- [x] **Step 1: Add failing schema and projection fixtures.**

Update fixtures to assert v2 and add a four-team public board:

```ts
expect(ClientCommandSchema.safeParse({
  type: "set_team_count",
  teamCount: 4,
}).success).toBe(true);

expect(ClientCommandSchema.safeParse({
  type: "set_team_count",
  teamCount: 5,
}).success).toBe(false);

expect(ClientProjectionSchema.safeParse(fourTeamOperativeProjection).success)
  .toBe(true);
expect(ClientProjectionSchema.safeParse({
  ...fourTeamOperativeProjection,
  board: { ...fourTeamOperativeProjection.board, teamSummaries: [
    { teamId: "red", revealedTargets: 0, eliminated: false, targetTotal: 8 },
  ]},
}).success).toBe(false);
```

The second projection fixture intentionally proves unrevealed `targetTotal` cannot enter the public shape.

- [x] **Step 2: Run protocol tests and verify the RED failure.**

```bash
pnpm --filter @cipher-party/protocol test
```

Expected: failures because schemas are protocol v1, team IDs stop at Blue, and `set_team_count`/grid metadata do not exist.

- [x] **Step 3: Define v2 wire types.**

Set `PROTOCOL_VERSION` to `2`. Derive `TeamIdSchema` from the four canonical IDs and add:

```ts
export const TeamCountSchema = z.union([
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export interface PublicTeamSummary {
  teamId: TeamId;
  revealedTargets: number;
  eliminated: boolean;
}
```

Add `set_team_count` to `ClientCommandSchema`, broaden `assign_seat`, and add `teamCount`/`configuredTeams` to the projection base. Add `rows`, `columns`, `configuredTeams`, `eliminatedTeams`, and `teamSummaries` to `PublicBoard`. Add optional `eliminatedTeam` to the `card_revealed` history variant and validate it only when `owner` is `hazard`.

- [x] **Step 4: Keep privacy structural and schema-strict.**

Update `ClientProjectionSchema` so clue-giver keys exactly cover the board order for 25/30/36 cards, while all public roles structurally omit `key`, ownership maps, and target totals. Validate dimensions against the supported triplets and require team summaries to contain exactly the configured teams.

- [x] **Step 5: Run all protocol checks and commit.**

```bash
pnpm --filter @cipher-party/protocol test
pnpm --filter @cipher-party/protocol typecheck

git add packages/protocol/src/commands.ts packages/protocol/src/projections.ts packages/protocol/src/transport.ts packages/protocol/src/projections.typecheck.ts packages/protocol/src/*.test.ts
git commit -m "feat: version protocol for multi-team projections"
```

### Task 4: v1-to-v2 room state and snapshot migration

**Files:**

- Modify: `apps/worker/src/room/room-state.ts`, `apps/worker/src/room/room-snapshot.ts`, `apps/worker/src/room/room-session.ts` (board-start provenance seam only)
- Test: `apps/worker/test/room-snapshot.test.ts`, `apps/worker/test/room-durable-object.test.ts`

**Interfaces:**

- Consumes: Task 1 board metadata and Task 3 v2 schemas.
- Produces: v2 `RoomState`, persisted `teamCount`/`configuredTeams` plus server-only `initialOwners` provenance, dynamic snapshot validation, and `parseRoomSnapshot` normalization of valid v1 rooms.

- [x] **Step 1: Add failing v1/v2 snapshot tests.**

Add tests that a generated v2 four-team snapshot parses with exact `initialOwners`, a post-hazard v2 snapshot keeps eliminated-team seats as spectators and preserves revealed target ownership even after an order permutation, a v1 two-team fixture parses and normalizes with derived `initialOwners`, and invalid dimensions/teams/eliminations/history metadata fail closed:

```ts
const normalized = parseRoomSnapshot(legacyV1State);
expect(normalized.schemaVersion).toBe(2);
expect(normalized.protocolVersion).toBe(2);
expect(normalized.teamCount).toBe(2);
expect(normalized.configuredTeams).toEqual(["red", "blue"]);
expect(normalized.game?.board.rows).toBe(5);
expect(normalized.game?.board.columns).toBe(5);
expect(normalized.game?.eliminatedTeams).toEqual([]);
```

- [x] **Step 2: Run Worker snapshot tests and verify the RED failure.**

```bash
pnpm --filter @cipher-party/worker test -- test/room-snapshot.test.ts test/room-durable-object.test.ts
```

Expected: failures because the current validator accepts only schema/protocol v1 and exactly 25 Red/Blue cards.

- [x] **Step 3: Add the v2 room fields and normalization boundary.**

Change `RoomState` to the v2 in-memory shape (import `CardId` and `Ownership` from `@cipher-party/game-core`):

```ts
export interface RoomState {
  schemaVersion: 2;
  protocolVersion: 2;
  teamCount: TeamCount;
  configuredTeams: TeamId[];
  initialOwners: Record<CardId, Ownership> | null;
  // existing fields remain, including room-level startingTeam as a compatibility mirror
}
```

Keep v1 and v2 Zod schemas separate. The parser first recognizes the version, validates the complete v1 shape, injects two-team defaults, 5 × 5 metadata, and an `initialOwners` map copied from the unchanged legacy board owners, then validates the normalized v2 state. New board state writes an exact server-only `initialOwners` map keyed by card ID before any reveal; the minimal `start_board` writer seam may be added here so a freshly persisted board is reloadable. It is never included in client projections. No SQLite migration is added.

- [x] **Step 4: Generalize snapshot invariants.**

Validate exact board dimensions/distribution using `classicBoardSpec`, configured/eliminated subsets, active-team/winner coherence, role minimums for every non-eliminated configured team, and spectator-only seats for eliminated teams. Require `initialOwners` to have exactly the board card IDs and the original exact distribution. Validate post-hazard ownership against this immutable server-side map so only unrevealed targets originally owned by the eliminated team may have become neutral; revealed target ownership must remain unchanged even when old history entries are absent or `board.order` is permuted. Keep the existing null-prototype card map restoration. Preserve room-level `startingTeam` as a mirror of `game.board.startingTeam` once a board exists.

- [x] **Step 5: Run focused Worker tests and commit.**

```bash
pnpm --filter @cipher-party/worker test -- test/room-snapshot.test.ts test/room-durable-object.test.ts
pnpm --filter @cipher-party/worker typecheck

git add apps/worker/src/room/room-state.ts apps/worker/src/room/room-snapshot.ts apps/worker/test/room-snapshot.test.ts apps/worker/test/room-durable-object.test.ts
git commit -m "feat: migrate room snapshots to multi-team state"
```

At this intermediate boundary, the Worker typecheck may still report v2 adoption errors in `room-session.ts` or its existing tests; Task 5 owns those command/projection changes. The only room-session change permitted here is the minimal `initialOwners` write at `start_board`. Record exact remaining failures without pulling in other room-session behavior, and require the focused snapshot/durable-object tests and all Task 4-owned typechecks to pass.

### Task 5: Worker lobby, authorization, and atomic room transitions

**Files:**

- Modify: `apps/worker/src/room/room-session.ts`, `apps/worker/src/room/room-durable-object.ts` only if v2 initialization types require it (the Task 4 board-start provenance seam must be preserved)
- Test: `apps/worker/src/room/room-session.test.ts`, `apps/worker/test/room-durable-object.test.ts`

**Interfaces:**

- Consumes: Task 2 transition metadata, Task 3 commands/projections, and Task 4 v2 room state.
- Produces: dynamic lobby readiness, `set_team_count`, four-team random/manual assignment, eliminated-seat handling, v2 projection source, `initialOwners` provenance at board start, and one-revision composite hazard history.

- [ ] **Step 1: Add failing room-session tests.**

Cover these cases with command envelopes at protocol v2. Reuse the existing
room-session test helpers for `session`, `hostActor`, `envelope`, and
`COMMAND_AT`; the four-team hazard fixture must provide `hazardActor` and
`hazardCardId` for the reveal assertion:

```ts
async function dispatchHost(command: ClientCommand): Promise<CommandResult> {
  const current = session.snapshot();
  return session.dispatch(
    hostActor(),
    envelope(current.revision, command),
    COMMAND_AT,
  );
}

expect(await dispatchHost({ type: "set_team_count", teamCount: 4 })).toMatchObject({ ok: true });
expect(await dispatchHost({ type: "set_team_count", teamCount: 2 })).toMatchObject({
  ok: false,
  code: "invalid_command",
}); // green/yellow assignments must be moved first

const startFailure = await dispatchHost({ type: "start_board" });
expect(startFailure.ok).toBe(false);
if (!startFailure.ok) {
  expect(startFailure.message).toMatch(/at least|configured team/u);
}

// The four-team fixture supplies a valid active hazard actor/card and uses the
// same envelope helper as the other commands.
const beforeRevision = session.snapshot().revision;
const hazardResult = await session.dispatch(
  hazardActor,
  envelope(beforeRevision, {
    type: "confirm_reveal",
    cardId: hazardCardId,
  }),
  COMMAND_AT,
);
expect(hazardResult.ok).toBe(true);
expect(hazardResult.revision).toBe(beforeRevision + 1);
expect(session.snapshot().publicHistory.at(-1)).toMatchObject({
  type: "card_revealed",
  owner: "hazard",
  eliminatedTeam: "red",
});
expect(session.snapshot().publicHistory.at(-1)?.revision).toBe(
  session.snapshot().revision,
);
```

Also test inactive-team assignment rejection, balanced 2/3/4 randomization, spectator-capacity reservation when a hazard can eliminate the largest team, any active opposing clue-giver challenge, rejected actions from eliminated seats, and all remaining-team turn rotations.

- [ ] **Step 2: Run the focused room tests and verify the RED failure.**

```bash
pnpm --filter @cipher-party/worker test -- src/room/room-session.test.ts test/room-durable-object.test.ts
```

- [ ] **Step 3: Implement dynamic lobby configuration and validation.**

Add the host-only `set_team_count` branch in the unlocked lobby. Reject a reduction that would leave an active seat assigned to a removed configured team. Make randomization distribute across `state.configuredTeams`; make `validateStart` require `2 × teamCount` active seats, one clue-giver and one operative per team, a maximum size difference of one, and enough spectator capacity for any hazard elimination (`existing spectators + largest active team size ≤ 16`). Use `classicBoardSpec(state.teamCount).cardCount` for card-pool validation. When starting a board, copy each generated card owner into the server-only `initialOwners` map before any gameplay mutation.

- [ ] **Step 4: Implement dynamic authorization and projection source.**

Reject gameplay commands when the actor’s team is eliminated. Pass configured team metadata, grid dimensions, elimination state, and revealed-only summaries to `projectRoomForSeat`. Convert affected active seats to the existing spectator representation in the same state mutation as hazard elimination; do not add campaign restoration in this slice.

- [ ] **Step 5: Connect `applyGameActionWithEvent` and history atomically.**

Capture the actor’s team before applying the transition. Persist the next state (including unchanged `initialOwners` provenance), convert eliminated seats, append the single composite `card_revealed` history entry using the transition event, increment revision once, and broadcast only after persistence. Preserve processed-command replay behavior and public-history limits.

- [ ] **Step 6: Run Worker tests, typecheck, and commit.**

```bash
pnpm --filter @cipher-party/worker test -- src/room/room-session.test.ts test/room-durable-object.test.ts
pnpm --filter @cipher-party/worker typecheck

git add apps/worker/src/room/room-session.ts apps/worker/src/room/room-durable-object.ts apps/worker/src/room/room-session.test.ts apps/worker/test/room-durable-object.test.ts
git commit -m "feat: authorize and persist multi-team rooms"
```

### Task 6: Dynamic React lobby and game surface

**Files:**

- Modify: `apps/web/src/lib/team-presentation.ts`, `apps/web/src/components/TeamPanel.tsx`, `apps/web/src/features/lobby/LobbyView.tsx`
- Modify: `apps/web/src/features/game/GameView.tsx`, `TeamScore.tsx`, `BoardResult.tsx`, `GameHistory.tsx`, `BoardGrid.tsx`, `BoardCard.tsx`
- Modify: `apps/web/src/styles/globals.css`, `apps/web/src/styles/tokens.css`
- Test: `apps/web/src/features/lobby/LobbyView.test.tsx`, `apps/web/src/features/game/GameView.test.tsx`, focused component tests as needed

**Interfaces:**

- Consumes: v2 projection fields from Task 3 and Worker output from Task 5.
- Produces: dynamic team presentation, team-count control, dimension-driven CSS grid, eliminated-team status, explicit input/focus behavior, and responsive four-team layouts.

- [ ] **Step 1: Add failing UI tests for dynamic teams and dimensions.**

Add projections for 2/3/4 teams and assert:

```ts
expect(screen.getAllByRole("heading", { name: /team$/i })).toHaveLength(4);
expect(screen.getByLabel("Number of teams")).toHaveValue("4");
expect(document.querySelector<HTMLElement>(".board-grid"))
  .toHaveStyle({ "--board-columns": "6" });
expect(screen.getByText("Amber")).toBeVisible();
expect(screen.getByText("Eliminated")).toBeVisible();
```

Keep existing two-team assertions and add checks that public roles have no secret-key DOM nodes, first card activation only nominates, and Escape cancels/restores focus.

- [ ] **Step 2: Run web tests and verify the RED failure.**

```bash
pnpm --filter @cipher-party/web test -- src/features/lobby/LobbyView.test.tsx src/features/game/GameView.test.tsx
```

- [ ] **Step 3: Expand centralized team presentation and lobby rendering.**

Add Green/Verdant and Yellow/Amber to `TEAM_PRESENTATION` with symbols and callsigns. Update `TeamPanelIdentity` to accept all canonical IDs plus waiting. Render configured teams from projection data, add the host’s unlocked-lobby team selector, and derive readiness messages/minimum counts from `teamCount` rather than Red/Blue branches.

- [ ] **Step 4: Make board and game components projection-driven.**

Replace local Red/Blue maps with the centralized catalog. Render `TeamScore`, `BoardResult`, `GameHistory`, announcements, and turn labels by iterating configured teams. Add an elimination announcement from `card_revealed.eliminatedTeam`; show eliminated seats as spectators and disable their actions. Pass `rows`/`columns` into `BoardGrid` and set a CSS custom property from the projection:

```tsx
import type { CSSProperties } from "react";

const cardsById = new Map(cards.map((card) => [card.id, card]));

<ol
  className="board-grid"
  style={{ "--board-columns": String(board.columns) } as CSSProperties}
>
  {order.map((cardId) => (
    <li key={cardId}>
      <BoardCard
        card={cardsById.get(cardId)!}
        nominated={false}
        disabled={false}
      />
    </li>
  ))}
</ol>
```

- [ ] **Step 5: Implement responsive and accessibility behavior.**

Add CSS for `repeat(var(--board-columns), minmax(0, 1fr))`, 5 × 6/6 × 6 bounded board scrolling, compact four-team desktop chips, phone bottom-sheet details, high-contrast/forced-colors team patterns, and no horizontal page overflow at 320 × 780. Keep card buttons at least 44px where possible; retain explicit reveal confirmation. Add an accessible zoom control or native-scroll fallback rather than gesture-only navigation.

- [ ] **Step 6: Verify web tests and commit.**

```bash
pnpm --filter @cipher-party/web test -- src/features/lobby/LobbyView.test.tsx src/features/game/GameView.test.tsx
pnpm --filter @cipher-party/web typecheck

git add apps/web/src/lib/team-presentation.ts apps/web/src/components/TeamPanel.tsx apps/web/src/features/lobby/LobbyView.tsx apps/web/src/features/game apps/web/src/styles/globals.css apps/web/src/styles/tokens.css
git commit -m "feat: render dynamic multi-team classic UI"
```

### Task 7: Browser flows, privacy regression, and playtest runbooks

**Files:**

- Modify: `e2e/helpers/room.ts`, `e2e/connected-classic.spec.ts`
- Create: `e2e/multi-team.spec.ts`, `docs/runbooks/multi-team-playtest.md`
- Modify: `docs/runbooks/connected-classic-playtest.md`

**Interfaces:**

- Consumes: v2 room/projection contract and dynamic UI from Tasks 3–6.
- Produces: preserved two-team privacy/convergence coverage, four-team browser hazard coverage, and reproducible human-session procedures.

- [ ] **Step 1: Update observer fixtures to protocol v2 without weakening privacy checks.**

Change synthetic projections/envelopes to v2, permit `eliminatedTeam` only on public hazard reveal entries, and keep raw-frame auditing rules that reject hidden ownership, ownership maps, and target totals on public roles.

- [ ] **Step 2: Keep the existing two-team end-to-end test green.**

Run:

```bash
pnpm exec playwright test e2e/connected-classic.spec.ts
```

Expected: the existing five-seat two-team flow still completes, including refresh recovery, privacy assertions, mobile geometry, pause/resume, and final convergence.

- [ ] **Step 3: Add the four-team browser flow.**

Create eight isolated observed seats (two per team), select four teams in the host lobby, assign one clue-giver and one operative per team, start the 6 × 6 board, use a fixed test seed/fixture to identify the hazard from the clue-giver-only key inside the test process, and nominate it from the active operative. Assert one revision, one composite history entry, eliminated-team spectator projections, next-team rotation, public convergence, and absence of hidden ownership in all operative/spectator frames.

- [ ] **Step 4: Add responsive screenshot assertions.**

Capture public-role screenshots for lobby, active 6 × 6 board, and post-elimination state at exact 320 × 780 and 1280 × 900. Assert board bounding boxes remain within the viewport, no horizontal page scroll occurs, and the four-team HUD does not obscure the board.

- [ ] **Step 5: Write separate human runbook coverage.**

Leave the existing four-human two-team runbook intact as the regression gate. Add `multi-team-playtest.md` requiring eight active participants/devices, one window per participant, staging attestation, a facilitator-controlled fixed card pool/seed or clue-giver-directed hazard, measured setup/first-clue/board duration, elimination comprehension, turn-skip clarity, recovery, mobile layout observations, and convergence across all eight profiles.

- [ ] **Step 6: Run browser tests and commit.**

```bash
pnpm exec playwright test e2e/connected-classic.spec.ts e2e/multi-team.spec.ts
git add e2e/helpers/room.ts e2e/connected-classic.spec.ts e2e/multi-team.spec.ts docs/runbooks/connected-classic-playtest.md docs/runbooks/multi-team-playtest.md
git commit -m "test: cover multi-team browser play"
```

### Task 8: Full verification, snapshot refresh, and release handoff

**Files:**

- Modify: `docs/PROJECT_SNAPSHOT.md` (root coordinator only, after reviewed implementation tasks)
- Modify: `docs/superpowers/plans/2026-09-12-multi-team-classic.md` to check completed tasks and record verification outputs

**Interfaces:**

- Consumes: all implementation and browser-test outputs from Tasks 1–7.
- Produces: a clean, source-bound, documented handoff ready for explicit staging deployment authorization and the two human gates.

- [ ] **Step 1: Run focused package checks after each task is accepted.**

Use the package commands recorded in each task; do not skip the focused test cycle or commit boundary.

- [ ] **Step 2: Run the complete local release gate.**

```bash
pnpm install --frozen-lockfile
pnpm run check:release
```

Expected: all existing coverage floors, complexity thresholds, builds, preflight checks, local Worker dry run, two-team E2E, and four-team E2E pass. Any failure receives a focused regression test before a fix.

- [ ] **Step 3: Verify the clean checkout and source identity.**

```bash
git diff --check
git status --short
git rev-parse HEAD
```

The worktree must be clean, and the plan/snapshot must record the exact reviewed commit. Do not deploy a dirty or unverified checkout.

- [ ] **Step 4: Refresh the project snapshot.**

Increment the snapshot revision, set the approved multi-team plan as the active plan, state that implementation is complete only if Tasks 1–7 and release checks passed, retain the current staging deployment as the prior two-team reference until a new deployment is authorized, and set the next task to the appropriate human gate. Preserve the existing safety boundaries and record the v1-to-v2, composite-history, and eight-player decisions.

- [ ] **Step 5: Prepare but do not execute live deployment without authorization.**

```bash
pnpm run deploy:staging --dry-run
```

After explicit authorization, the release operator may run the tracked staging deployment, `check:staging` with exact expected commit/version/namespace, and `pnpm run smoke:staging:public`. The eight-player staging session follows only after fresh attestation.

- [ ] **Step 6: Commit the release handoff.**

```bash
git add docs/PROJECT_SNAPSHOT.md docs/superpowers/plans/2026-09-12-multi-team-classic.md
git commit -m "docs: record multi-team implementation handoff"
```

## Self-review checklist

- [ ] Every spec section maps to a task: team model (1), board distributions (1), reducer/hazard rules (2), v2 protocol/projections (3), migration (4), lobby/authorization (5), UI/input (6), browser/human gates (7), rollout/snapshot (8).
- [ ] No task relies on a two-entry same-revision history; composite hazard metadata is defined in Tasks 2, 3, and 5.
- [ ] No task leaks target totals to public roles; `teamSummaries` contain revealed counts only.
- [ ] No task introduces Phaser, canvas, Blitz, campaigns, Pack Studio, picture assets, or licensed content.
- [ ] All interfaces use the same names: `teamCount`, `configuredTeams`, `eliminatedTeams`, `rows`, `columns`, `teamSummaries`, `eliminatedTeam`, `applyGameActionWithEvent`.
- [ ] Legacy v1 loading, protocol v2 clients, exact board distributions, 16/16 capacities, and two-team regression coverage are explicit.
- [ ] Human validation includes the existing four-human two-team gate and a separate eight-active-player four-team gate.
