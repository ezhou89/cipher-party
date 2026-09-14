# Cipher Party for iOS

Cipher Party is a native SwiftUI companion for the existing online rooms. The
app targets iOS 17 or later and keeps the Worker authoritative for room and game
state.

## Open and run

Open `CipherParty.xcodeproj` in Xcode 16 or later, select the `CipherParty`
scheme, and run on an iPhone simulator. The Debug configuration uses the local
Worker at `http://127.0.0.1:8787`; only a loopback HTTP host is accepted.

If command-line tools are not already pointed at the full Xcode installation,
prefix commands with:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

## Configurations

| Configuration | API base                                   | Signing                                           |
| ------------- | ------------------------------------------ | ------------------------------------------------- |
| Debug         | Local Worker at `http://127.0.0.1:8787`    | Simulator/local development                       |
| Staging       | `https://oddlyuseful.studio`               | Supply `CIPHER_PARTY_APPLE_TEAM_ID` for devices   |
| Release       | Supply `CIPHER_PARTY_RELEASE_API_BASE_URL` | Supply the registered bundle ID and Apple Team ID |

Release builds require these user-defined Xcode build settings, supplied by the
release environment or an uncommitted local configuration:

- `CIPHER_PARTY_RELEASE_API_BASE_URL` — the HTTPS production Worker origin
- `CIPHER_PARTY_RELEASE_BUNDLE_IDENTIFIER` — the registered App ID's bundle ID
- `CIPHER_PARTY_APPLE_TEAM_ID` — the Apple Developer team that signs the app

The URL scheme, Keychain service name, and feature flags are also injected by
the selected `.xcconfig`. Seat and host tokens are durable runtime credentials;
never add them to these files, the bundle, URLs, or logs. A short-lived,
one-use WebSocket ticket may appear only in the existing WSS
`/api/rooms/{code}/connect?ticket=...` query parameter; keep it in memory and
never log it.

## Verification

Build the app for the simulator in each runtime configuration:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/cipher-party-task10-debug \
  CODE_SIGNING_ALLOWED=NO \
  build

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -configuration Staging \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/cipher-party-task10-staging \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Run the unit and UI test targets on the available narrow simulator. Pin the
destination ID when several architecture entries or multiple runtimes are
installed:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'id=A2F34315-5495-46DD-874E-F8248399991F' \
  -derivedDataPath /private/tmp/cipher-party-task10-debug \
  CODE_SIGNING_ALLOWED=NO \
  test

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -configuration Staging \
  -sdk iphonesimulator \
  -destination 'id=A2F34315-5495-46DD-874E-F8248399991F' \
  -derivedDataPath /private/tmp/cipher-party-task10-staging \
  CODE_SIGNING_ALLOWED=NO \
  test
```

The current verification run passed both configurations on the iPhone SE
(3rd generation) simulator (iOS 18.2). It also passed Debug and Staging
`build-for-testing`. A signed device remains required for camera capture,
Universal Link activation, share sheets, background/foreground behavior, and
the final Dynamic Type, dark-mode, and VoiceOver visual pass.

Repository checks for the current branch:

```sh
pnpm run check
git diff --check
```

`pnpm run check` passed outside the restricted shell (including 24 protocol
fixture tests, formatting, lint, typecheck, 22 game-core tests, 46 protocol
tests, 53 web tests, 41 Worker tests, and the root test). The first restricted
shell attempt failed because Wrangler could not write its log or bind its test
port; it is not a code failure.

The repository Playwright command remains an environment/configuration
follow-up in this handoff:

```sh
pnpm run test:e2e
```

The configured web-server readiness URL uses `127.0.0.1:5173`, while Vite
listens on `localhost:5173` in this environment. `curl
http://localhost:5173/api/health` returned `200`, while the configured
`127.0.0.1` URL refused the connection, so no E2E pass is claimed. Keep this
as a test-harness follow-up rather than changing the iOS client or protocol.

## Mixed-client integration and privacy harness

The Worker is the interoperability reference for the native client. It uses
the same HTTP room bootstrap, bearer-token ticket issuance, one-use WSS ticket,
role-specific projection, command-revision, and reconnect contracts consumed by
the iOS app. Run these checks from the repository root before a staging smoke:

```sh
pnpm --filter @cipher-party/worker exec vitest run \
  test/rooms-api.test.ts test/room-websocket.test.ts --reporter=dot
```

This covers room creation and join, browser-compatible ticket issuance,
multiple simultaneous seats, role-safe projections at a shared revision,
authorization, command broadcasts, duplicate/reconnect behavior, and fresh
projection recovery. The verified local result for the current client is 14
tests passed.

The browser fallback remains a separate compatibility check:

```sh
pnpm --filter @cipher-party/web exec vitest run \
  src/features/lobby/RoomPage.test.tsx --reporter=dot
```

The verified local result is 4 tests passed, including a room URL opening in
the browser when the native app is not installed and an in-page browser join.
Worker authorization and Universal Link association regressions are covered by:

```sh
pnpm --filter @cipher-party/worker exec vitest run \
  test/auth.test.ts test/apple-app-site-association.test.ts --reporter=dot
```

The verified local result is 6 tests passed.

For an iOS-side smoke, create a room in the app, open the invite URL in a
browser, join from the browser, and connect a second iOS install or simulator
with the same code. In the lobby, assign at least one clue-giver and operative
to each team, lock and start the board, then complete one clue/nomination/reveal
turn. Background the app between the clue and reveal, restore it, and confirm
that the connection banner stays read-only until a fresh server projection
arrives. The app must obtain a new short-lived ticket on reconnect; never copy
or inspect a durable seat/host token from a URL, QR payload, log, notification,
share item, or cache file.

The following local audit is intentionally source-level and safe to run in CI:

```sh
rg -n --glob '*.swift' \
  '(print\(|NSLog|os_log|Logger\(|UNNotification|UserDefaults|NSUbiquitous)' \
  apps/ios/CipherParty apps/ios/CipherPartyTests apps/ios/CipherPartyUITests
```

Expected production output is empty. Invite/QR tests reject query strings,
fragments, and credential-shaped payloads; projection/cache tests reject hidden
keys outside the clue-giver projection; API/Keychain tests assert that error
descriptions do not contain durable credentials.

The current environment can build and run the native XCTest/XCUITest targets on
the available iOS 18.2 simulator when Xcode is invoked with the full
`DEVELOPER_DIR`. The optional XcodeBuildMCP debugger connector did not expose
`simctl` in this session, so no debugger-plugin screenshot is claimed. A
signed-device run is still required for camera capture, Universal Link
association, share-sheet behavior, background/foreground transitions, and
VoiceOver/dark-mode visual checks.
Native `InviteRouter`, the Associated Domains entitlement, dynamic/static AASA,
and the invite URL/QR origin are all bound to `oddlyuseful.studio`. Preferred
staging is therefore to route the Cipher Party Worker at that host with
`CANONICAL_ORIGIN=https://oddlyuseful.studio`. If an alternate Worker origin is
used instead, update the Worker's `CANONICAL_ORIGIN`,
`InviteRouter.universalLinkHost`, invite URL/QR origin, Associated Domains
entitlement, and both dynamic and static AASA together, then validate Universal
Links before running the smoke flow. Do not treat a 404 from the currently
unrelated host as an iOS protocol failure.
