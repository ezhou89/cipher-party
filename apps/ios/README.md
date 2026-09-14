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

Build the app for the simulator:

```sh
xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  build
```

Run the focused unit and UI tests on the narrowest supported simulator:

```sh
xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone SE (3rd generation)' \
  -only-testing:CipherPartyTests/AppEnvironmentTests \
  -only-testing:CipherPartyUITests/EntryFlowUITests \
  test
```

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

The current environment can parse every Swift source with the iOS 17 target,
but simulator execution is not deterministic here when CoreSimulatorService or
the Observation macro service is unavailable. A signed-device run is still
required for camera capture, Universal Link association, share-sheet behavior,
background/foreground transitions, and VoiceOver/dark-mode visual checks.
The configured `oddlyuseful.studio` host must also route the Cipher Party
Worker before staging create/join can be exercised; if it serves another site,
use the deployed Worker origin instead and do not treat a 404 as an iOS protocol
failure.
