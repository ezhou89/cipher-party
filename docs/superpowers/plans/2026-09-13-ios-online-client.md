# Native iOS Online Client Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to execute this plan task-by-task. Work on one
> task at a time, keep the checkboxes accurate, and make one focused commit per
> accepted task.

**Goal:** Add a native SwiftUI iOS 17+ client that lets account-free friends
create or join the existing Cloudflare rooms from separate phones, while
remaining interoperable with the browser client and safe during network changes.

**Architecture:** The iOS app is a client of the existing protocol v1. SwiftUI
views send intents to a `@Observable` `RoomSession`; an injected `APIClient`
handles room bootstrap and tickets, and an actor-isolated `RoomSocket` handles
the ticketed WebSocket. The Cloudflare Worker and one Durable Object per room
remain authoritative for membership, roles, revisions, timers, and game rules.

**Tech Stack:** Xcode, Swift 5.9+, iOS 17+, SwiftUI Observation, Foundation
`URLSessionWebSocketTask`, Network framework `NWPathMonitor`, Security Keychain,
AVFoundation camera metadata scanning, Core Image QR generation, XCTest, and
XCUITest. No third-party runtime dependency is required for this slice.

**Spec:** `docs/superpowers/specs/2026-09-13-ios-online-client-design.md`

**Browser plan:** `docs/superpowers/plans/2026-08-30-connected-classic.md`

## Global constraints

- Do not change the existing Classic rules or replace the Cloudflare authority.
- iOS and browser clients must consume the same protocol v1 schemas, messages,
  revisions, and role-safe projections.
- Clients send commands only; they never send replacement state or derive a
  winning board locally.
- Operatives, spectators, and non-clue-giver hosts must never receive or persist
  the unrevealed ownership key. A clue-giver key may exist in memory for that
  role, but persistent reconnect cache is redacted and app-private.
- Seat and host tokens stay in Keychain and out of URLs, QR payloads, logs,
  notifications, screenshots, and crash reports. Only the short-lived ticket
  may appear in the existing WSS query parameter, and it is never logged.
- The first client is online-only. A network outage produces a labeled,
  read-only cached reference and reconnect attempts; it does not create an
  offline match or local host.
- Keep account-free guests and external voice chat. Do not add chat, analytics,
  social identity, pack creation, AI, picture cards, monetization, or public
  pack sharing to this plan.
- Target iOS 17 or newer and support Dynamic Type, VoiceOver, dark mode, and
  narrow iPhone widths.
- Use Swift concurrency with explicit actor/main-actor boundaries. Inject time,
  networking, path status, Keychain, and WebSocket factories in tests rather
  than relying on sleeps or global singletons.
- Preserve the active browser plan. Any Worker/protocol edit must be justified
  by iOS interoperability or Universal Link support and must include browser
  regression coverage.
- Follow the repository TDD protocol: write a failing test, observe the failure,
  implement the smallest behavior, run focused tests, then run broader checks.
- Do not mark a checkbox complete without fresh command output or simulator
  evidence.

## Planned file structure

```text
apps/
├── ios/
│   ├── CipherParty.xcodeproj/
│   ├── Configurations/
│   │   ├── Debug.xcconfig
│   │   ├── Staging.xcconfig
│   │   └── Release.xcconfig
│   ├── CipherParty/
│   │   ├── CipherPartyApp.swift
│   │   ├── AppEnvironment.swift
│   │   ├── Features/
│   │   │   ├── Entry/EntryView.swift
│   │   │   ├── Entry/JoinRoomView.swift
│   │   │   ├── Lobby/LobbyView.swift
│   │   │   ├── Lobby/SeatListView.swift
│   │   │   ├── Board/BoardView.swift
│   │   │   ├── Board/CardGridView.swift
│   │   │   └── Connection/ConnectionBanner.swift
│   │   ├── Networking/APIClient.swift
│   │   ├── Networking/RoomSocket.swift
│   │   ├── Networking/ProtocolModels.swift
│   │   ├── Persistence/SeatCredentialStore.swift
│   │   ├── Persistence/ProjectionCache.swift
│   │   ├── Routing/InviteRouter.swift
│   │   └── Routing/QRCodeRenderer.swift
│   ├── CipherPartyTests/
│   │   ├── Fixtures/*.json
│   │   ├── ProtocolModelTests.swift
│   │   ├── APIClientTests.swift
│   │   ├── SeatCredentialStoreTests.swift
│   │   ├── RoomSocketTests.swift
│   │   ├── RoomSessionTests.swift
│   │   └── InviteRouterTests.swift
│   └── CipherPartyUITests/
│       ├── EntryFlowUITests.swift
│       ├── LobbyUITests.swift
│       └── BoardAccessibilityUITests.swift
├── web/public/.well-known/apple-app-site-association
└── worker/src/http/apple-app-site-association.ts
packages/
└── protocol/fixtures/ios/*.json
scripts/
└── validate-ios-protocol-fixtures.mjs
```

The project/group layout can be adjusted while creating the Xcode project, but
the boundaries and ownership above are required. `apps/ios` is intentionally
kept beside the existing web and worker apps; it is not a second repository.

## Cross-task interface map

- `APIClient` produces typed create, join, ticket, and API-error responses.
- `SeatCredentialStore` persists `{ code, playerId, seatToken, hostToken? }` and
  exposes async get/put/delete operations.
- `ProtocolModels` decodes the existing `ClientProjection`, `ServerMessage`,
  command, and `CommandResult` unions.
- `RoomSocket` consumes a seat credential and emits connection events and
  decoded server messages. It never owns SwiftUI state.
- `ProjectionCache` persists only a redacted, app-private last-known projection
  for reconnect UX; it never syncs to iCloud or shared extensions.
- `RoomSession` owns the current projection, connection state, command gate,
  cache lifecycle, and user-facing errors on the main actor.
- `InviteRouter` maps HTTPS Universal Links, the development custom URL scheme,
  and manual room codes to one normalized room-code model.
- SwiftUI feature views read permissions and role from `RoomSession`; they do
  not duplicate authorization rules.

## Task 1: Create the iOS target and deterministic app configuration

**Files:**

- Create: `apps/ios/CipherParty.xcodeproj/`
- Create: `apps/ios/Configurations/Debug.xcconfig`
- Create: `apps/ios/Configurations/Staging.xcconfig`
- Create: `apps/ios/Configurations/Release.xcconfig`
- Create: `apps/ios/CipherParty/CipherPartyApp.swift`
- Create: `apps/ios/CipherParty/AppEnvironment.swift`
- Create: `apps/ios/CipherPartyTests/AppEnvironmentTests.swift`
- Create: `apps/ios/CipherPartyUITests/EntryFlowUITests.swift`
- Create: `apps/ios/README.md`

**Interfaces:**

- Produces an iOS 17+ app target named `CipherParty`, unit/UI test targets, and
  build configurations with an injectable `API_BASE_URL`.
- Debug may point to a local Worker; Staging points to the configured
  `https://oddlyuseful.studio` host; Release is a separately signed value.
- The bundle identifier and Apple Team ID are release configuration values
  registered during app setup, not values embedded in the protocol or deep-link
  payload.

- [x] **Step 1: Add a failing configuration test.** Assert that the environment
  rejects a non-HTTPS staging URL, exposes a valid WebSocket base URL, and does
  not include seat/host tokens in its description or debug output.
- [x] **Step 2: Create the Xcode project and app shell.** Set the deployment
  target to iOS 17, add the app/unit/UI targets, wire the `.xcconfig` files,
  enable Swift concurrency checking appropriate for the target, and render a
  minimal entry view.
- [x] **Step 3: Implement the environment.** Centralize base URL, URL scheme,
  Keychain service name, and feature flags in an immutable `AppEnvironment`;
  provide production wiring and test initializers without global mutable state.
- [x] **Step 4: Add launch/accessibility smoke coverage.** Give the entry screen
  stable accessibility identifiers and verify a simulator can launch it at the
  narrowest supported width.
- [x] **Step 5: Verify the scaffold.** Run `xcodebuild -project
  apps/ios/CipherParty.xcodeproj -scheme CipherParty -sdk iphonesimulator
  -destination 'generic/platform=iOS Simulator' build` and the focused unit/UI
  tests. Commit only the scaffold.

## Task 2: Establish cross-platform protocol fixtures and Swift Codable models

**Files:**

- Create: `packages/protocol/fixtures/ios/*.json`
- Create: `apps/ios/CipherPartyTests/Fixtures/*.json`
- Create: `scripts/validate-ios-protocol-fixtures.mjs`
- Modify: root `package.json` check script only if needed to run fixture validation
- Create: `apps/ios/CipherParty/Networking/ProtocolModels.swift`
- Create: `apps/ios/CipherPartyTests/ProtocolModelTests.swift`
- Modify: `packages/protocol/src/*.test.ts` only for the shared fixture assertions

**Interfaces:**

- Swift models mirror protocol v1: `CommandEnvelope`, all Classic command
  cases, `ServerMessage`, `ClientProjection` variants, `ProjectionPermissions`,
  board/card/history types, and `CommandResult`/error codes.
- JSON fixtures are the canonical cross-language examples. TypeScript validates
  them through the existing Zod schemas; Swift validates the same bytes through
  `Codable`.

- [x] **Step 1: Add fixture assertions first.** Add a test/script that loads
  lobby, operative, clue-giver, spectator, challenged, paused, and complete
  fixtures and fails until the fixture set is valid under the TypeScript schemas.
- [x] **Step 2: Capture safe fixtures.** Include a clue-giver key only in the
  clue-giver fixture; assert that operative, spectator, and unassigned fixtures
  have no `key` field. Include command successes, stale revisions, unauthorized,
  wrong phase, ticket expiry, and room-full errors.
- [x] **Step 3: Implement strict Swift decoding.** Use explicit discriminator
  enums and `Decodable` implementations. Unknown message/role/phase values must
  throw a recoverable protocol error without logging the raw frame.
- [x] **Step 4: Add round-trip and boundary tests.** Verify protocol version 1,
  NFC Unicode strings, optional card ownership, maximum public history, and
  absence of hidden key fields in unauthorized models.
- [x] **Step 5: Run both validators.** Execute the fixture script, the package
  protocol tests, and the focused Swift tests before committing.

## Task 3: Implement HTTP bootstrap and Keychain credentials

**Files:**

- Create: `apps/ios/CipherParty/Networking/APIClient.swift`
- Create: `apps/ios/CipherParty/Persistence/SeatCredentialStore.swift`
- Create: `apps/ios/CipherPartyTests/APIClientTests.swift`
- Create: `apps/ios/CipherPartyTests/SeatCredentialStoreTests.swift`

**Interfaces:**

- `APIClient.createRoom(displayName:)` maps the existing response containing
  `code`, `inviteUrl`, `playerId`, `seatToken`, and `hostToken`.
- `APIClient.joinRoom(code:displayName:asSpectator:)` maps the existing join
  response and normalizes the code before sending.
- `APIClient.requestTicket(credentials:)` sends the seat bearer and optional
  `X-Cipher-Host-Token` and returns an in-memory ticket/expiry.
- `SeatCredentialStore` uses Security Keychain with a device-only accessibility
  class and deletes credentials on explicit leave.

- [x] **Step 1: Write failing URLProtocol tests.** Assert exact HTTP methods,
  paths, JSON bodies, headers, status/error mapping, and that tokens do not
  appear in thrown error descriptions.
- [x] **Step 2: Write failing Keychain tests.** Cover put/get/delete, host-token
  optionality, separate room keys, duplicate replacement, and a failing
  Keychain status surfaced as a typed error.
- [x] **Step 3: Implement typed API errors and requests.** Reuse the browser's
  room-code normalization rules and strict response decoding; never concatenate
  unvalidated path components.
- [x] **Step 4: Implement the Keychain adapter.** Inject a small Keychain client
  protocol so tests use an in-memory fake. Use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
  (or the platform-equivalent constant) and avoid iCloud synchronization.
- [x] **Step 5: Verify focused tests and a local Worker smoke request.** Do not
  log request headers or response tokens.

## Task 4: Build the ticketed WebSocket and reconnect transport

**Files:**

- Create: `apps/ios/CipherParty/Networking/RoomSocket.swift`
- Create: `apps/ios/CipherParty/Networking/NetworkPathMonitor.swift`
- Create: `apps/ios/CipherPartyTests/RoomSocketTests.swift`

**Interfaces:**

- `RoomSocket` is an actor (or has an equivalent single serialization boundary)
  exposing an async stream of `RoomSocketEvent` values: connecting, open,
  reconnecting, message, terminal failure, and closed.
- It obtains a fresh ticket before each connection, opens
  `/api/rooms/{code}/connect?ticket=...`, continuously receives frames, and
  decodes them through `ProtocolModels`.
- Backoff is 500 ms, 1 s, 2 s, and 5 s, capped at 5 s; user close and terminal
  authentication/room errors stop retries. `NWPathMonitor` is a retry hint only.

- [x] **Step 1: Add transport fakes and failing tests.** Build injectable
  WebSocket, ticket, clock, and path-monitor fakes. Test open/receive/close,
  malformed-frame recovery, ticket expiry, and bounded backoff without real
  sleeps.
- [x] **Step 2: Implement the receive loop.** Use
  `URLSessionWebSocketTask`, a cancellation-safe async receive task, and explicit
  close codes. Keep the ticket and raw frame out of logs.
- [x] **Step 3: Implement reconnect behavior.** On unexpected close/error,
  emit reconnecting, wait through the injected clock, request a fresh ticket,
  and accept the first projection as the new source of truth.
- [x] **Step 4: Add foreground/path hooks.** Pause/cancel safely on background,
  resume on foreground, and use `NWPathMonitor` to avoid futile loops while the
  device has no usable path.
- [x] **Step 5: Verify focused transport tests and cancellation races.** Include
  a regression for one close producing one retry schedule and no duplicate
  receive tasks.

## Task 5: Add `RoomSession`, command reconciliation, and redacted cache

**Files:**

- Create: `apps/ios/CipherParty/Persistence/ProjectionCache.swift`
- Create: `apps/ios/CipherParty/Features/RoomSession.swift`
- Create: `apps/ios/CipherPartyTests/RoomSessionTests.swift`
- Create: `apps/ios/CipherPartyTests/ProjectionCacheTests.swift`

**Interfaces:**

- `RoomSession` is `@MainActor @Observable` and exposes `connectionState`,
  `projection`, `lastUpdated`, `pendingCommand`, `lastCommandResult`, `lastError`,
  and `isStale`.
- Intents are typed methods (`assignSeat`, `setRole`, `startBoard`, `submitClue`,
  `nominateCard`, `confirmReveal`, `endTurn`, `pause`, `resume`, etc.) that map
  to protocol commands; views cannot pass arbitrary JSON.
- `ProjectionCache` stores a redacted, room-scoped JSON projection in the app
  sandbox. It strips `key` before persistence, applies file protection, never
  syncs to iCloud, and is deleted on leave.

- [x] **Step 1: Write failing state-machine tests.** Cover projection
  replacement, connection transitions, cached-state labeling, permission-based
  command gating, one in-flight command, and clean leave.
- [x] **Step 2: Write failing reconciliation tests.** Cover successful command
  result followed by projection, stale revision, unauthorized/wrong-phase
  errors, socket loss after send, and a new projection arriving before a result.
- [x] **Step 3: Implement the session.** Subscribe to `RoomSocket`, replace
  state only with complete server projections, persist a redacted cache, and
  clear pending state only when the result/projection revision proves it is
  reconciled.
- [x] **Step 4: Implement explicit retry UX state.** A command with unknown
  delivery is not replayed automatically. After the fresh revision arrives,
  expose retry/cancel intent to the view and generate a new command ID on retry.
- [x] **Step 5: Verify hidden-data and cache tests.** Assert no operative,
  spectator, or persisted projection can contain unrevealed ownership.

## Task 6: Add invite routing, QR sharing, and Universal Link support

**Files:**

- Create: `apps/ios/CipherParty/Routing/InviteRouter.swift`
- Create: `apps/ios/CipherParty/Routing/QRCodeRenderer.swift`
- Create: `apps/ios/CipherParty/Features/Entry/EntryView.swift`
- Create: `apps/ios/CipherParty/Features/Entry/JoinRoomView.swift`
- Create: `apps/ios/CipherPartyTests/InviteRouterTests.swift`
- Modify: `apps/ios/CipherParty.xcodeproj/` for URL schemes and Associated Domains
- Create or modify: `apps/web/public/.well-known/apple-app-site-association`
- Create: `apps/worker/src/http/apple-app-site-association.ts`
- Modify: `apps/worker/src/http/router.ts` and environment types if dynamic AASA
  configuration is required
- Create or modify: Worker tests for the AASA response

**Interfaces:**

- `InviteRouter` accepts `https://oddlyuseful.studio/room/{code}`, the
  development `cipherparty://room/{code}` scheme, and manual code input, then
  returns one normalized room-code value or a typed invalid-link error.
- `QRCodeRenderer` renders only the server-provided invite URL, never a seat or
  host credential.
- The Worker serves an Apple App Site Association response for `/room/*` using
  the registered App ID; missing release association configuration fails safely
  without exposing secrets.

- [x] **Step 1: Add failing routing/QR tests.** Cover URL normalization,
  malformed/extra path components, query/fragment stripping, aliases O/I/L, and
  QR payload inspection with token-like values rejected.
- [x] **Step 2: Implement routing and QR generation.** Use Core Image for QR
  generation and keep scanning separate from parsing. Add a manual code path for
  denied camera permission or devices without a camera.
- [x] **Step 3: Wire camera scanning.** Use AVFoundation metadata scanning only
  after the user chooses **Scan invite**; stop capture after the first valid code
  and provide a clear permission fallback.
- [x] **Step 4: Configure app links.** Add Associated Domains and the development
  URL scheme. Serve and test the AASA response from the staging host once the
  Apple App ID is registered; local tests use the same route parser without
  requiring a signed device.
- [x] **Step 5: Verify Worker/browser compatibility.** Run Worker tests and a
  browser regression proving `/room/{code}` still falls back to the web entry
  when the native app is absent.

## Task 7: Implement the lobby and host controls

**Files:**

- Create: `apps/ios/CipherParty/Features/Lobby/LobbyView.swift`
- Create: `apps/ios/CipherParty/Features/Lobby/SeatListView.swift`
- Create: `apps/ios/CipherParty/Features/Lobby/RoomShareSheet.swift`
- Create: `apps/ios/CipherParty/Features/Connection/ConnectionBanner.swift`
- Create: lobby-focused SwiftUI tests/UI tests

**Interfaces:**

- Lobby reads `RoomSession.projection` and renders code, QR/share actions, room
  phase, lock status, seat connectivity, team/role assignments, and permissions.
- Host actions dispatch only typed session intents and are hidden/disabled when
  `permissions.configure`/`moderate` is false.
- The lobby supports mixed browser/iOS seats and a spectator entry path through
  the shared server-provided seat model. Protocol v1 does not expose client
  platform, so the lobby intentionally does not claim a per-seat device label.

- [x] **Step 1: Add failing view-model/UI tests.** Assert host controls are not
  rendered for non-host projections, disconnected seats are labeled, and the
  invite share payload is exactly the invite URL.
- [x] **Step 2: Implement the lobby layout.** Use `NavigationStack`, focused
  subviews, stable accessibility identifiers, and readable cards/list rows for
  narrow phones.
- [x] **Step 3: Implement sharing and onboarding guidance.** Add system share,
  copy-code, QR presentation, display-name validation, and a concise “what to do
  next” checklist for a group arriving in a room.
- [x] **Step 4: Add connection/offline presentation.** Show reconnecting and
  last-updated states without hiding the board or implying that local actions are
  accepted.
- [x] **Step 5: Verify lobby tests and simulator screenshots.** Check Dynamic
  Type, VoiceOver labels, dark mode, and a compact iPhone viewport.

## Task 8: Implement role-safe Classic board play

**Files:**

- Create: `apps/ios/CipherParty/Features/Board/BoardView.swift`
- Create: `apps/ios/CipherParty/Features/Board/CardGridView.swift`
- Create: `apps/ios/CipherParty/Features/Board/CardView.swift`
- Create: `apps/ios/CipherParty/Features/Board/ClueComposerView.swift`
- Create: `apps/ios/CipherParty/Features/Board/TurnControlsView.swift`
- Create: board-focused SwiftUI tests/UI tests

**Interfaces:**

- Board order always follows `board.order`; card labels, reveal state, owner,
  active team, phase, clue, guesses remaining, nomination, winner, and completion
  reason come from the projection.
- Clue-giver view may render `key`; operative, spectator, and unassigned views
  render the same board without ownership colors/data.
- Operative controls map to nominate, clear, confirm reveal, and end turn;
  clue-giver controls map to submit clue and challenge; pause/resume and
  completion actions follow permissions.

- [x] **Step 1: Add failing projection/view tests.** Assert the key is absent
  from unauthorized view models, card ordering is stable, and every button is
  gated by projection permissions and current phase.
- [x] **Step 2: Implement the responsive card grid.** Use SwiftUI lazy layout,
  readable word typography, semantic labels, and the existing colorblind-safe
  hue/glyph/texture/label indicators.
- [x] **Step 3: Implement clue and guess interactions.** Validate clue word/count
  locally only for immediate feedback, send the typed command, and render the
  server result/revision as authoritative.
- [x] **Step 4: Implement challenged, paused, and complete states.** Preserve
  public history and winner/completion messaging without deriving hidden state.
- [x] **Step 5: Verify UI/accessibility tests.** Exercise all four role views,
  VoiceOver labels, text scaling, dark mode, and read-only cached presentation.

## Task 9: Mixed-client integration, resilience, and security hardening

**Files:**

- Modify: `e2e/` only if a browser regression is required by the iOS protocol/AASA
  seam
- Create: integration harness notes under `apps/ios/README.md`
- Add focused Swift/Worker/browser regression tests where defects are found

**Interfaces:**

- Staging validation uses the existing Worker at `oddlyuseful.studio` and a
  browser client as the interoperability reference.
- No test fixture, snapshot, or log may contain a durable token or a clue-giver
  key in an unauthorized context.

- [x] **Step 1: Run a mixed-room smoke flow.** Create on iOS, join in browser and
  a second iOS simulator, assign roles, start Classic, submit a clue, nominate,
  reveal, and complete a turn.
- [x] **Step 2: Exercise interruption paths.** Background/foreground the app,
  close the WebSocket, toggle simulator network conditions, and verify bounded
  reconnect plus fresh projection replacement.
- [x] **Step 3: Exercise authorization paths.** Attempt host commands from a
  non-host test seat and hidden-key decoding from operative/spectator fixtures;
  verify server rejection and safe UI state.
- [x] **Step 4: Inspect privacy surfaces.** Review OSLog, crash/error text,
  share sheets, QR contents, cache files, and notification payloads for secrets.
- [x] **Step 5: Fix only demonstrated defects.** Add a regression test before
  each fix and keep protocol/browser changes narrowly scoped.

## Task 10: Release-readiness verification and handoff

**Files:**

- Modify: `apps/ios/README.md` with build/test/run instructions and staging
  configuration notes
- Modify: `docs/PROJECT_SNAPSHOT.md` after reviewed milestone completion
- Modify: this plan checkboxes as tasks are accepted

- [ ] **Step 1: Run focused iOS verification.** Build and test the Debug and
  Staging schemes with `xcodebuild`; run simulator UI smoke tests using the iOS
  debugger workflow.
- [ ] **Step 2: Run repository verification.** Execute `pnpm run check`,
  `pnpm run test:e2e` when shared Worker/protocol behavior changed, `git diff
  --check`, and `git status --short`. If dependency installation is blocked by
  the npm registry, record the exact command/error rather than claiming success.
- [ ] **Step 3: Review the diff for scope and secrets.** Confirm no offline
  transport, billing, pack generation, unlicensed art, or hidden-data leakage
  slipped into the client.
- [ ] **Step 4: Update the snapshot.** Increment the revision, record accepted
  iOS tasks and exact passing commands, leave the browser plan pointer intact,
  and list any remaining signing/AASA or environment blocker.
- [ ] **Step 5: Request code review before merge.** Use the repository review
  checklist, then decide whether to open a PR from `feature/ios-online-client`.

## Execution order and gates

Tasks are sequential because the UI depends on the session, the session depends
on protocol/API/transport contracts, and Universal Links depend on the app
configuration. The safe execution order is:

`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10`

After Tasks 1–5, a coordinator review must confirm protocol parity, no blind
command replay, redacted cache behavior, and token handling before UI work
starts. After Task 8, a simulator review must confirm all four role projections
before staging integration. Task 10 is the only task that may declare the first
native client ready for review.
