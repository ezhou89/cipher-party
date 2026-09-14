# Cipher Party iOS Online Client Design

**Date:** 2026-09-13

**Status:** Approved

**Scope:** Native iOS client for online Cipher Party rooms

This document turns the approved iOS direction into a concrete subsystem boundary
before implementation planning. It extends the existing browser game without
changing the active browser milestone or replacing the Cloudflare room backend.

Related documents:

- [Project snapshot](../../PROJECT_SNAPSHOT.md)
- [Cipher Party product design](2026-08-30-cipher-party-design.md)
- [Connected Classic browser plan](../plans/2026-08-30-connected-classic.md)

## Product intent

Friends should be able to stand in the same physical place—such as a queue at
Disneyland—while each person uses their own iPhone. One person can create a room,
others can join from a QR code, Universal Link, or short room code, and every
phone can show the correct private role view. A browser player and an iPhone
player must be able to share the same room.

The iOS client is an online companion for the existing game. The server remains
the authority for room membership, roles, the board, turns, revisions, and
hidden information. A temporary network outage may make the app read-only, but
it must never invent or apply an offline match state.

## Goals

1. Ship a real SwiftUI application for iOS 17 or later, rather than a thin
   web-view wrapper.
2. Support account-free create and join flows against the existing Cloudflare
   HTTP/WebSocket API.
3. Support a mixed room containing iOS and browser clients.
4. Preserve role-safe projections: operatives never receive the key, while
   clue-givers receive the key needed for their role.
5. Make joining in a crowded, mobile setting fast: QR/Universal Link first,
   manual code as a reliable fallback, and a clear display-name step.
6. Reconnect safely after tunnel/queue connectivity changes, with bounded
   retries, foreground resume, and an honest connection indicator.
7. Leave a clean seam for a later host identity, entitlements, StoreKit
   purchases, and a separate nearby/offline mode without adding those systems to
   the first client.

## Non-goals for this slice

- No no-signal peer-to-peer match or local host election.
- No pass-and-play replacement for a disconnected room.
- No new account, social graph, analytics, chat, or voice service.
- No pack builder, AI theme generation, image-card pipeline, or public pack
  marketplace in the native client.
- No changes to the Classic game rules or browser behavior beyond consuming the
  current protocol v2 surface; the client supports host-selected two-, three-,
  and four-team rooms.
- No StoreKit products or paid unlocks before the free online client is proven.
- No requirement that the web client be rewritten; existing web behavior remains
  a compatibility constraint.

## Primary user journeys

### Create a room

1. The player opens Cipher Party on iOS and chooses **Create room**.
2. The app asks for a display name, validates it with the same constraints as
   the web client, and calls `POST /api/rooms`.
3. The response supplies `code`, `inviteUrl`, `playerId`, `seatToken`, and
   `hostToken`. The app stores the durable credentials in Keychain and keeps the
   short-lived WebSocket ticket only in memory.
4. The lobby displays the room code, a locally generated QR representation of
   `inviteUrl`, and a system share action. The host may also copy the code.
5. The app opens the room session and renders the host's role-safe projection.

### Join from a phone

1. A player taps a Cipher Party Universal Link or scans the lobby QR code.
2. If the app is installed, the link opens the app with the normalized room
   code. If it is not installed, the same URL continues to the browser room
   entry point.
3. The app shows a short join screen with the code, display-name field, and
   **Join as spectator** fallback. It never puts a seat token or host token in
   the link.
4. The app calls `POST /api/rooms/{code}/join`, stores the returned seat
   credential in Keychain, then obtains a short-lived ticket and opens WSS.
5. A manual room-code entry path performs the same normalization used by the
   browser (`O` to `0`, `I`/`L` to `1`, whitespace and hyphens removed).

### Play in a mixed room

The lobby and board use the same server projection as the browser. A host can
assign teams and roles, lock the room, and start the board. During play the
native UI exposes only actions allowed by `permissions` and still treats a
server rejection as authoritative. A clue-giver sees the key; an operative,
spectator, or unassigned player does not.

### Recover in a queue

When the app backgrounds, the device changes networks, or the WebSocket closes,
the session stores the last role-safe projection, marks the UI as disconnected,
and retries with bounded backoff. On a successful reconnect it obtains a fresh
ticket, waits for a fresh projection, and replaces the cache only with the
server-provided projection. The app does not blindly replay a command whose
delivery result is unknown; the player gets a retry affordance after the current
revision is known.

## Architecture

```text
SwiftUI screens
      |
      v
RoomSession (@Observable, feature state + intents)
      |
  +---+-------------------+
  |                       |
APIClient             RoomSocket
  |                       |
  +-----------+-----------+
              v
       Cloudflare Worker HTTP
              |
       Room Durable Object
              |
       current protocol v2
```

The iOS app is a new client of the current API, not a second game engine. The
Cloudflare Worker and one Durable Object per room continue to own persistence,
authorization, revisions, timers, and the authoritative `game-core` reducer.
The web and iOS clients consume the same protocol contract.

### HTTP contract

The first client uses the existing endpoints:

- `POST /api/rooms` with `{ displayName }` to create a room.
- `POST /api/rooms/{code}/join` with `{ displayName, asSpectator }` to join.
- `POST /api/rooms/{code}/tickets` with the seat bearer token and optional
  `X-Cipher-Host-Token` to issue a short-lived ticket.
- `GET /api/rooms/{code}/connect?ticket={ticket}` upgraded to WebSocket.

Response decoding is strict enough to surface an incompatible server rather
than silently constructing partial state. API errors map to user-facing states
such as room unavailable, locked, in progress, full, or unauthorized.

### WebSocket contract

The app sends the existing `CommandEnvelope` with `protocolVersion: 2`, a fresh
UUID `commandId`, the current `expectedRevision`, and one typed command. It
decodes these server messages:

- `projection` — complete role-safe `ClientProjection` replacement.
- `command_result` — success or an error code such as `stale_revision`,
  `unauthorized`, `wrong_phase`, `room_locked`, or `room_full`.
- `error` — transport/protocol failure such as an expired ticket.

The app allows at most one command awaiting reconciliation per room session,
matching the current browser client. Every command is disabled while its
revision is unresolved. A stale-revision result triggers a fresh projection and
an explicit retry decision, never a client-side state merge.

## iOS application structure

The native target lives under `apps/ios/` in the existing repository. It is a
SwiftUI app with no third-party runtime dependency in the first slice:

```text
apps/ios/
  CipherParty.xcodeproj
  CipherParty/
    CipherPartyApp.swift
    AppEnvironment.swift
    Features/
      Entry/
      Lobby/
      Board/
      Connection/
    Networking/
      APIClient.swift
      RoomSocket.swift
      ProtocolModels.swift
    Persistence/
      SeatCredentialStore.swift
    Routing/
      InviteRouter.swift
      QRCodeRenderer.swift
  CipherPartyTests/
  CipherPartyUITests/
```

The exact Xcode group layout may be adjusted during implementation, but feature
boundaries and ownership stay as described here. SwiftUI views remain focused
on presentation and intent dispatch; networking, credentials, and projection
decoding are injected through `AppEnvironment`/initializers so tests can use
fakes.

### State ownership

- `RoomSession` is an iOS 17 `@Observable` reference type owned by the room
  flow. It exposes `connectionState`, `projection`, `pendingCommand`,
  `lastCommandResult`, `lastError`, and a user-visible `isStale`/offline state.
- `APIClient` owns HTTP request construction and typed response/error decoding.
- `RoomSocket` owns ticket acquisition, `URLSessionWebSocketTask`, receive
  looping, close handling, and transport backoff. It emits decoded server
  messages; it does not mutate SwiftUI state directly.
- `SeatCredentialStore` owns Keychain reads/writes/deletes and has no UI
  concerns.
- Views derive button visibility and available actions from the projection's
  `permissions` and `viewRole`, while the server remains the final check.

### Protocol model strategy

Swift `Codable` models mirror the TypeScript protocol's discriminated unions.
They include all current Classic commands and projection variants, even if a
particular view does not expose every command yet. Unknown message types and
unknown enum cases fail into a recoverable protocol error with the raw frame
excluded from logs. Contract fixtures captured from `packages/protocol` cover:

- lobby, playing, challenged, paused, and complete projections;
- operative versus clue-giver key visibility;
- command success and every current command error code;
- Unicode display names/clues and normalized room codes.

If the protocol changes, its TypeScript schemas and browser tests are updated in
the same change as the Swift decoder fixtures. An iOS-only interpretation of a
new rule is not permitted.

## Invite and onboarding experience

The entry flow is intentionally short:

1. **Choose a path:** Create room, Join with code, or Scan invite.
2. **Name the seat:** one display-name field, with inline validation.
3. **Explain the next step:** a small checklist tells a host to share the QR or
   code and tells a joiner to choose a team/role in the lobby.
4. **Show the room:** the lobby makes connection status, code, roles, and host
   controls obvious without exposing the key.

The QR is generated from the existing `inviteUrl` using Core Image. Scanning
uses the system camera metadata path with a manual-code fallback; camera access
is requested only after the player chooses **Scan invite**. The Universal Link
association keeps the web fallback working for players without the app.

## Reconnection and “line mode” behavior

`RoomSocket` uses `URLSessionWebSocketTask` and an exponential backoff capped at
the existing browser cadence (500 ms, 1 s, 2 s, 5 s). It stops retrying after an
explicit user close, invalid credentials, or a terminal room error. A
`NWPathMonitor` signal is used as a hint to pause/restart attempts; it never
authorizes a command or declares the room complete.

When the app enters the background, it cancels the receive task safely and
reconnects on foreground. The cached projection is labeled **last updated** and
is never presented as current while disconnected. On reconnect:

1. fetch a fresh ticket using the Keychain seat credential;
2. create a new WebSocket task;
3. accept the first server projection as the source of truth;
4. reconcile any command-result state by revision;
5. re-enable intents only when the connection and projection are current.

If connectivity is unavailable, the board remains useful as a read-only
reference (labels, last known phase, and last updated time), with no local card
reveal or turn mutation. This keeps a group from accidentally diverging while
standing in a queue.

## Security and privacy

- Seat and host tokens are stored in Keychain with a device-only accessibility
  class and are removed when the user leaves a room.
- Tokens are never put in QR payloads, Universal Links, analytics, crash
  messages, or normal logs. The short-lived ticket is used only in the WSS URL
  required by the current backend and is not logged.
- All production API and WebSocket traffic uses HTTPS/WSS and the normal iOS
  App Transport Security policy.
- The app stores only the minimum local data: room code, player ID, encrypted
  seat credential, and the last role-safe projection needed for reconnect UX.
- Hidden information is accepted only in the `clue-giver` projection's key and
  is never copied into shared caches, notifications, widgets, screenshots, or
  deep-link state.
- The server's role/permission checks remain authoritative even if a modified
  client sends a command directly.

## Monetization seam (deferred)

The first native release is free to join and does not require an account. The
credential and room layers are deliberately independent from identity so a
future host account can attach entitlements without changing room membership.
If paid digital packs or native-only features are added later, the iOS surface
will use StoreKit and the server will verify entitlement before enabling a
feature. Public pack sharing would also require the existing moderation and
licensing policy; neither is part of this client slice.

## Nearby/offline phase boundary

True no-signal play is a separate future subsystem. It may use one iPhone as a
temporary host and Network framework peer-to-peer discovery/transport, but it
must define a new authority, persistence, conflict, and migration model. The
online `RoomSession` and protocol are not quietly repurposed for that mode.
The current app only reports loss of connectivity and reconnects to the
Cloudflare room.

## Testing and verification

### Swift unit tests

- decode every protocol fixture and reject malformed/unknown discriminators;
- normalize invite URLs and room codes;
- Keychain store round trips and deletion;
- ticket/API error mapping;
- WebSocket receive loop, close, ticket expiry, backoff, and foreground resume;
- command gating, expected-revision handling, stale-result reconciliation, and
  no blind replay;
- role-safe UI state: the clue-giver key is absent from operative/spectator
  models.

### Integration and UI tests

- create a room on the staging Worker, join from a second simulator/browser,
  and verify mixed-client lobby and Classic turn flow;
- Universal Link and QR/manual-code entry;
- app background/foreground and simulated network loss;
- host-only controls and all four role views;
- Dynamic Type, VoiceOver labels, dark mode, and narrow iPhone widths;
- Xcode simulator build/run and screenshot inspection using the iOS debugger
  workflow.

The existing repository checks remain part of the handoff: `npm run check`, the
browser end-to-end suite for any shared protocol change, `git diff --check`, and
`git status --short`. If dependency installation is blocked by the environment,
the handoff records that exact blocker instead of claiming a passing check.

## Acceptance criteria

The first native client is ready for review when all of the following are true:

1. A fresh iOS install can create a room and another iOS/browser client can join
   it without an account.
2. A room created in the browser can be joined from iOS through a QR, Universal
   Link, or manual code.
3. iOS and browser clients can complete the existing Classic flow with the same
   server revisions and no hidden-data leakage.
4. The app reconnects after a WebSocket/network interruption and displays a
   clearly labeled cached state while offline.
5. Seat credentials survive a normal app restart in Keychain and are removed by
   an explicit leave-room action.
6. No ticket, seat token, host token, or clue-giver key appears in logs, URLs
   shared by the user, notifications, or non-authorized projection models.
7. Swift unit/UI tests and the applicable web/protocol checks provide evidence
   for the above behaviors.

## Decision record

- **Native stack:** SwiftUI, iOS 17+, Observation, Foundation URLSession,
  Network framework path monitoring, and Keychain.
- **Transport:** reuse the existing Cloudflare HTTP/WebSocket protocol v2.
- **Deployment:** the first client targets the existing Cloudflare staging host
  at `https://staging.oddlyuseful.studio`; the release base URL remains
  configuration, not a hard-coded protocol assumption.
- **Offline:** explicitly deferred; online reconnect UX is the first slice.
- **Scope discipline:** do not modify the active connected-browser plan except
  for protocol changes required by a demonstrated iOS interoperability gap.
