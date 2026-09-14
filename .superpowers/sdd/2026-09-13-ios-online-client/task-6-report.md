# Task 6 Report: Invite Routing, QR, Camera Scanning, and Universal Links

## Status

Complete on `feature/ios-online-client`. The change stays within the Entry/Join surfaces and reuses the existing `AppEnvironment`, `APIClient`, `SeatCredentialStore`, `RoomSocket`, and `RoomSession` seams. It does not add lobby, board, or session-protocol behavior.

## Implemented scope

- Added `InviteRouter`, accepting:
  - `https://oddlyuseful.studio/room/{code}`
  - `cipherparty://room/{code}`
  - manual room-code input
- Room codes use the existing `RoomCode` canonicalizer, including whitespace/hyphen removal and the `O -> 0`, `I/L -> 1` aliases. Unsupported origins, malformed or extra paths, empty input, and invalid codes return typed errors. Query strings and fragments on otherwise valid incoming links are ignored.
- Added Core Image QR rendering. The encoded payload is exactly the supplied safe room invite URL. User info, query strings, fragments, invalid room paths, insecure non-loopback HTTP, and credential-shaped values are rejected before rendering.
- Added Entry/Create/Join SwiftUI surfaces using existing API and session seams. Universal/custom links prefill the Join surface; successful create/join responses are persisted before constructing the existing online session handoff.
- Added an AVFoundation QR metadata scanner. Camera authorization is not inspected or requested until the user explicitly chooses **Scan invite**. Invalid QR payloads are ignored, the first valid code stops capture, and denied/restricted/no-camera states dismiss to a visible manual-code fallback.
- Registered the `cipherparty` URL scheme, camera usage description, and `applinks:oddlyuseful.studio` entitlement.
- Added a Worker AASA endpoint at `/.well-known/apple-app-site-association`. A valid deployment-provided `APPLE_APP_ID` produces a no-redirect JSON association limited to `/room/*`; missing or malformed configuration fails closed with a non-cacheable 404.
- Added a static web AASA file with an empty association as the safe browser-only fallback. The Worker is configured to run first for the AASA path, so production can supply the registered App ID without committing a placeholder team identifier.
- Preserved the existing `/room/{code}` web route and made the browser-fallback regression test name explicit.

## TDD evidence

### RED

1. Invite parsing and QR tests were added before their production types.

   Command:

   ```sh
   DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
     -project apps/ios/CipherParty.xcodeproj -scheme CipherParty \
     -destination 'platform=iOS Simulator,name=iPhone 16' \
     -only-testing:CipherPartyTests/InviteRouterTests test
   ```

   Result: build failed because `InviteRouter`, `InviteRouterError`, `QRCodeRenderer`, and `QRCodeRendererError` did not exist.

2. Worker AASA tests were added before the handler and routing branch.

   Command:

   ```sh
   pnpm --filter @cipher-party/worker exec vitest run test/apple-app-site-association.test.ts
   ```

   Result: 2 failures; the AASA request returned no routed response instead of the required 200/404 behavior.

3. The scan/manual fallback UI test was added before the Entry navigation was implemented.

   Command:

   ```sh
   DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
     -project apps/ios/CipherParty.xcodeproj -scheme CipherParty \
     -destination 'platform=iOS Simulator,name=iPhone 16' \
     -only-testing:CipherPartyUITests/EntryFlowUITests/testEntryOffersScanAndManualCodeFallback test
   ```

   Result: 1 failure; `entry.scanInvite` did not exist.

### GREEN

1. Focused routing/QR suite: **8 tests passed, 0 failures**. This includes a round-trip QR decode with `CIDetector` proving the exact server invite URL is encoded.
2. Focused Entry UI test: **1 test passed, 0 failures**. It verifies both the explicit scan affordance and manual-code fallback.
3. Focused Worker AASA suite: **3 tests passed, 0 failures**.
4. Focused browser fallback regression: **1 test passed, 3 skipped, 0 failures**.

## Final verification

### iOS

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj -scheme CipherParty \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/cipher-party-ios-task6-build-final \
  build-for-testing -quiet
```

Result: exit 0.

```sh
plutil -lint apps/ios/CipherParty/Info.plist \
  apps/ios/CipherParty/CipherParty.entitlements \
  apps/ios/CipherParty.xcodeproj/project.pbxproj
```

Result: all three files `OK`.

The built Debug app plist was also inspected: its registered scheme is `cipherparty` and it contains the camera usage description. The generated simulator entitlements contain `applinks:oddlyuseful.studio`.

A later optional combined simulator run reached the XCTest runner but stalled while Xcode waited for test workers to materialize; it was cancelled rather than treated as a product failure. The same focused routing/QR and Entry UI tests had already passed independently, and the final build-for-testing is green.

### Worker and browser

```sh
pnpm --filter @cipher-party/worker exec vitest run \
  test/apple-app-site-association.test.ts --reporter=dot
```

Result: 1 file passed, 3 tests passed.

```sh
pnpm --filter @cipher-party/web exec vitest run \
  src/features/lobby/RoomPage.test.tsx \
  -t 'browser join fallback' --reporter=dot
```

Result: 1 file passed, 1 test passed, 3 skipped.

```sh
pnpm --filter @cipher-party/worker run typecheck
pnpm --filter @cipher-party/web run typecheck
```

Result: both `tsc --noEmit` commands exited 0.

```sh
pnpm exec prettier --check \
  apps/worker/src/env.ts \
  apps/worker/src/http/apple-app-site-association.ts \
  apps/worker/src/http/router.ts \
  apps/worker/test/apple-app-site-association.test.ts \
  apps/web/src/features/lobby/RoomPage.test.tsx
git diff --check
```

Result: Prettier reported all matched files conform; `git diff --check` exited 0.

## Security and privacy review

- No account is introduced and room links remain account-free.
- QR and link payloads contain only the room invite URL/code. Seat and host tokens are neither appended to URLs nor included in QR payloads.
- Token-shaped payloads are explicitly covered by rejection tests.
- The Worker does not log or expose `APPLE_APP_ID`; malformed/missing values fail closed.
- Existing API credentials are persisted through `SeatCredentialStore` before session handoff and are not printed.

## Self-review

- Reviewed every changed production and test file against the task brief.
- Confirmed exact-path parsing rejects trailing slashes and extra components while URL query/fragment data is not propagated into the room code.
- Confirmed camera setup is initiated only from the scan sheet after an explicit user action and capture stops on the first valid result.
- Confirmed the AASA branch precedes asset fallback and does not intercept `/room/{code}`.
- Confirmed no lobby/board view or realtime protocol files changed.
- Added `@MainActor` to the UI test class to avoid Swift concurrency warnings from actor-isolated XCUI APIs.

## Lifecycle review fix

A post-implementation review identified a cancellation race: dismissing the scanner while camera authorization was pending, or while metadata delivery was queued, did not prevent the old callback from starting capture or delivering a room code.

The scanner now owns a visibility/generation lifecycle. Each appearance activates a new generation. `viewWillDisappear` invalidates it at the earliest disappearance callback, and `viewDidDisappear` repeats the idempotent invalidation as a teardown guarantee. Permission callbacks and capture startup require the generation to remain active. Metadata delivery uses a per-generation delegate and must atomically claim completion for that active generation. Dismissal and completion both clear the metadata delegate, remove the preview layer, and stop capture before any external callback.

Deterministic regression coverage was added without accessing a physical camera:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj -scheme CipherParty \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/cipher-party-ios-task6-lifecycle-red \
  -only-testing:CipherPartyTests/CameraInviteScannerLifecycleTests \
  build-for-testing -quiet
```

RED result: exit 65 with three `cannot find 'CameraInviteScannerLifecycle' in scope` errors.

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj -scheme CipherParty \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/cipher-party-ios-task6-lifecycle-build \
  build-for-testing -quiet
```

GREEN build result: exit 0 with no output or warnings.

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj -scheme CipherParty \
  -destination 'platform=iOS Simulator,id=61DB0B2D-74E1-4DB2-9910-73F8B1E970B1' \
  -derivedDataPath /tmp/cipher-party-ios-task6-lifecycle-build \
  -only-testing:CipherPartyTests/CameraInviteScannerLifecycleTests \
  -only-testing:CipherPartyTests/InviteRouterTests \
  test-without-building -quiet
```

GREEN test result: exit 0. The three lifecycle tests cover a pending permission generation after dismissal, queued metadata after dismissal, and rejection of an old generation after a new appearance; the eight existing routing/QR tests also remain green.

## Concerns / deployment follow-up

- The registered Apple Team ID/App ID was not available in repository configuration. Production must set `APPLE_APP_ID` to the exact registered value (for example, `TEAMID.bundle.identifier`). Until then, the Worker intentionally returns 404 and the static web fallback advertises no app association.
- A signed-device Universal Link validation against the deployed staging host remains necessary after the App ID and associated-domain entitlement are provisioned in Apple Developer signing.
- Simulator verification covers parsing, generated QR decoding, UI fallback, configuration, and compilation. Actual camera metadata capture and the system permission prompt still require a physical-device smoke test.
- Moving `AVCaptureSession.startRunning()` and `stopRunning()` off the main queue remains the previously accepted minor follow-up; this lifecycle fix intentionally does not broaden into that refactor.
