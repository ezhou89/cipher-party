# Task 1 report: iOS target and deterministic app configuration

## Status

Implemented the native iOS 17 scaffold in `apps/ios` without changing browser or
shared protocol behavior. The scaffold includes a SwiftUI app, unit and UI test
targets, deterministic Debug/Staging/Release configuration, and immutable
runtime environment wiring.

## Files changed

- `apps/ios/CipherParty.xcodeproj/project.pbxproj` — app, unit-test, and UI-test
  targets; iOS 17 deployment target; Swift 5.9 strict concurrency; three build
  configurations wired to the configuration files.
- `apps/ios/CipherParty.xcodeproj/project.xcworkspace/contents.xcworkspacedata`
  — Xcode workspace metadata.
- `apps/ios/CipherParty.xcodeproj/xcshareddata/xcschemes/CipherParty.xcscheme`
  — shared build/test/run scheme.
- `apps/ios/Configurations/Debug.xcconfig` — loopback Worker configuration for
  simulator development.
- `apps/ios/Configurations/Staging.xcconfig` — HTTPS staging configuration for
  `oddlyuseful.studio`.
- `apps/ios/Configurations/Release.xcconfig` — separately injected production
  API origin, registered bundle identifier, and Apple Team ID.
- `apps/ios/CipherParty/AppEnvironment.swift` — immutable, `Sendable`
  environment; configuration validation; WebSocket URL derivation; safe
  descriptions; production and test construction without global mutable state.
- `apps/ios/CipherParty/CipherPartyApp.swift` — production environment wiring
  and minimal accessible entry screen.
- `apps/ios/CipherParty/Info.plist` — expanded configuration values and a narrow
  local-network ATS allowance needed by the Debug loopback Worker.
- `apps/ios/CipherPartyTests/AppEnvironmentTests.swift` — transport, WebSocket,
  and credential-redaction tests.
- `apps/ios/CipherPartyUITests/EntryFlowUITests.swift` — narrow-phone launch and
  accessibility smoke test.
- `apps/ios/README.md` — local setup, release configuration, security guidance,
  and verification commands.

## TDD evidence

1. Added `AppEnvironmentTests` before the implementation. The first
   build-for-testing failed with `cannot find type 'AppEnvironment' in scope`,
   establishing the configuration-test red state.
2. Added the immutable environment implementation. All three focused unit
   tests then passed.
3. Added `EntryFlowUITests` before the stable screen identifiers. The first UI
   run failed because `entry.screen` did not exist, establishing the UI red
   state.
4. Added the app shell and identifiers. The focused UI test then passed at the
   375-point iPhone SE width.
5. During integration, the generated plist omitted the custom configuration
   keys and the hosted unit test could not launch reliably. An explicit plist
   was added at the configuration boundary; clean focused tests then passed.

## Verification

- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/ios/CipherParty.xcodeproj -scheme CipherParty -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build`
  - Result: `** BUILD SUCCEEDED **`.
- The same generic simulator build with `-configuration Staging`
  - Result: `** BUILD SUCCEEDED **`.
  - Inspected built plist values: `APIBaseURL=https://oddlyuseful.studio`,
    `AppEnvironmentName=staging`, and bundle identifier
    `studio.oddlyuseful.cipherparty.staging`.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/ios/CipherParty.xcodeproj -scheme CipherParty -sdk iphonesimulator -destination 'id=A2F34315-5495-46DD-874E-F8248399991F' -only-testing:CipherPartyTests/AppEnvironmentTests -only-testing:CipherPartyUITests/EntryFlowUITests test`
  - Result: `** TEST SUCCEEDED **`; 3 unit tests and 1 UI test passed on an
    iPhone SE (3rd generation) simulator.
- `plutil -lint apps/ios/CipherParty/Info.plist`
  - Result: `OK`.
- `pnpm run check`
  - Result: passed project-document validation, Prettier, ESLint, all workspace
    typechecks, and 136 repository tests (22 game-core, 22 protocol, 53 web, 38
    Worker, 1 root).
  - The first sandboxed test attempt failed because Wrangler could neither
    write its user log nor bind `127.0.0.1`. The same command passed outside the
    sandbox. Before that rerun, Prettier identified the new README; formatting
    that one file made its focused and repository checks pass.

## Self-review

- Scope is limited to the requested scaffold plus the explicit plist required
  to make the injected configuration available at runtime.
- The project has app/unit/UI targets and Debug/Staging/Release configurations;
  the app deployment target is iOS 17.0 and strict Swift concurrency checking
  is enabled.
- `AppEnvironment` is immutable and carries only non-secret configuration.
  Public environments require HTTPS, Debug HTTP is restricted to loopback, URL
  credentials/query/fragment are rejected, and descriptions expose only the
  deployment plus API host.
- Release bundle ID, signing team, and production API origin remain external
  build values. Tokens are not embedded in build settings, plist data, URL
  schemes, accessibility identifiers, or descriptions.
- The entry shell has stable identifiers and was launched on the narrowest
  supported simulator. Existing web and Worker checks remain green.
- Reviewed the complete scoped diff and found no browser/protocol source
  changes or generated build artifacts included.

## Concerns

- A physical-device archive/signing pass was not possible because the final
  Apple Team ID, registered Release bundle ID, and production API origin are
  intentionally deployment-owned values. The simulator and Staging builds are
  verified; release operators must supply those three settings before device
  distribution.
- This machine's selected developer directory is Command Line Tools, so Xcode
  commands require the documented `DEVELOPER_DIR` prefix unless `xcode-select`
  is changed by the developer.

## Review follow-up

- Corrected the README security guidance to preserve the shared transport
  contract: long-lived seat/host tokens never enter URLs, while the short-lived,
  one-use WebSocket ticket may appear only in the established WSS
  `/api/rooms/{code}/connect?ticket=...` query and must never be logged.
- Covering check: a Node assertion over `apps/ios/README.md` verified all four
  constraints (durable-token URL exclusion, WSS-only ticket allowance, exact
  connect query, and no ticket logging); result: `README protocol guidance OK`.
- `pnpm exec prettier --check apps/ios/README.md .superpowers/sdd/2026-09-13-ios-online-client/task-1-report.md`
  - Result: both files match Prettier formatting.
- `git diff --check`
  - Result: passed with no whitespace errors.
- The review's separate ATS observation remains deferred as requested; no code
  or project configuration changed in this follow-up.
