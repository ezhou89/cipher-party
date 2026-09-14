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
the selected `.xcconfig`. Seat tokens, host tokens, and WebSocket tickets are
runtime credentials; never add them to these files, the bundle, URLs, or logs.

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
