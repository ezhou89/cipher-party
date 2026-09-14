# Task 10 report — release-readiness verification and handoff

## Status

The final integration fix wave and whole-branch code-review gate are complete
through HEAD `d3adeb9`. Task 9 mixed-room/interruption acceptance remains
pending. The original Task 10 documentation-only evidence below is historical;
the appended final-fix section records the subsequent code changes.

Base: `e821b400e1f54c36d3db0a75f7ea2c390dcd35c2`
Commit: `72e0180a8a629600691b86977d85b1683c44121f`

## Focused iOS verification

The project lists one `CipherParty` scheme with Debug, Release, and Staging
configurations. The following commands passed outside the restricted shell
with Xcode's full developer directory and signing disabled for simulator
artifacts:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet \
  -project apps/ios/CipherParty.xcodeproj -scheme CipherParty \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/cipher-party-task10-debug \
  CODE_SIGNING_ALLOWED=NO build
```

Result: exit 0.

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet \
  -project apps/ios/CipherParty.xcodeproj -scheme CipherParty \
  -configuration Staging -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/cipher-party-task10-staging \
  CODE_SIGNING_ALLOWED=NO build
```

Result: exit 0.

Debug and Staging `build-for-testing` also passed with the same destinations
and derived-data paths. Full Debug and Staging test runs passed on simulator
ID `A2F34315-5495-46DD-874E-F8248399991F` (iPhone SE (3rd generation), iOS
18.2) with `CODE_SIGNING_ALLOWED=NO`; both scheme test runs completed with exit
0. The scheme includes the `CipherPartyTests` and `CipherPartyUITests` targets,
so this is the available unit/UI smoke evidence.

The first generic Debug build from the restricted shell failed before product
diagnostics because the sandbox denied `swift-frontend` and the Observation
macro service returned a malformed response. The escalated rerun passed. A
name-only test destination using `OS:latest` failed because that exact
destination was unavailable; pinning the available simulator ID passed.

The XcodeBuildMCP debugger connector was also attempted as required by the
workflow. Its simulator discovery returned `xcrun: error: unable to find
utility "simctl", not a developer tool or in PATH`, so no MCP screenshot or
debugger session is claimed. Shell `xcodebuild` provided the passing simulator
test evidence above. A signed-device pass is still required for camera,
Universal Links, share sheets, lifecycle transitions, Dynamic Type, dark mode,
VoiceOver, and visual inspection.

## Repository verification

Passing commands:

```sh
pnpm run check
node scripts/check-project-docs.mjs
pnpm exec prettier --check apps/ios/README.md docs/PROJECT_SNAPSHOT.md \
  docs/superpowers/plans/2026-09-13-ios-online-client.md
git diff --check
git status --short
```

The successful `pnpm run check` run was performed outside the restricted shell
so Wrangler could write its log and bind its local test port. It reported 24
protocol-fixture tests, formatting, lint, all workspace typechecks, 22
game-core tests, 46 protocol tests, 53 web tests, 41 Worker tests, and the root
test passing. The first restricted-shell attempt failed with Wrangler `EPERM`
while writing `/Users/eugenezhou/Library/Preferences/.wrangler/logs/...` and
binding `127.0.0.1`; that was an environment restriction, not a code failure.

The required shared-stack E2E command was attempted:

```sh
pnpm run test:e2e
```

It did not produce a test pass. Playwright's configured web-server readiness
URL is `http://127.0.0.1:5173/api/health`, while Vite announced/listened at
`http://localhost:5173/` in this environment. `curl
http://localhost:5173/api/health` returned 200 and the configured
`127.0.0.1` endpoint refused the connection. A rerun outside the restricted
shell waited for the same readiness condition and was stopped after no useful
progress; no E2E result is claimed and no test-harness change was made in this
task.

## Scope, privacy, and security review

- The task diff changes only `apps/ios/README.md`, `docs/PROJECT_SNAPSHOT.md`,
  and the iOS plan checkboxes. No product behavior, protocol schema, Worker
  route, or browser code changed in Task 10.
- Source review found no StoreKit/billing, pack generation, AI/image pipeline,
  offline transport, peer-to-peer match, or unlicensed art additions.
- Existing Swift tests and source audit continue to cover role-safe projection
  and cache redaction, token-free error/share/QR surfaces, and absence of
  logging/notification/UserDefaults/iCloud persistence calls. The audit command
  returned no matches:

  ```sh
  rg -n --glob '*.swift' \
    '(print\(|NSLog|os_log|Logger\(|UNNotification|UserDefaults|NSUbiquitous)' \
    apps/ios/CipherParty apps/ios/CipherPartyTests apps/ios/CipherPartyUITests
  ```

- Durable credentials remain Keychain-only; only the required short-lived WSS
  ticket can appear in the connection query and it is not logged. The clue-
  giver key remains absent from unauthorized projections and persistent cache.

## Deployment blockers and handoff

The configured `https://oddlyuseful.studio` host currently serves the unrelated
studio site; the previously recorded read-only `/api/health` request returned
404. Therefore no staging create/join, Universal Link activation, or signed
device mixed-room flow is claimed. Before device smoke, route the Cipher Party
Worker at that host with `CANONICAL_ORIGIN=https://oddlyuseful.studio`, register
the Apple App ID/team, validate dynamic/static AASA, and run the physical-device
camera/share/lifecycle/accessibility pass. If an alternate Worker origin is
used, update the canonical origin, invite/QR origin, associated domain, and
AASA together.

The historical snapshot was revision 16. The current snapshot is revision 18;
the plan marks Task 10 Steps 1–5 complete for implementation and code review,
while Task 9's physical acceptance steps remain open.

## Final whole-branch review fix wave

Base: `72e0180bd10ea95131a92311256529c6e2a8a57e`. All eight Important findings
were addressed through the coordinated fix commits `8ccf5da`, `adc93ec`,
`81641c2`, `de8aeac`, and `ff69185`.

- `RoomEntryService` reads room-scoped Keychain credentials before any join
  request. Saved host/player credentials are returned unchanged, even with an
  empty display name. Only a new seat calls `/join` and writes new credentials.
  Entry exposes Return to saved room, and manual/invite entry follows the same
  path. No new persistence index or credential logging was introduced.
- Root-owned `RoomFlow` serializes open/leave and scene transitions. The root
  SwiftUI scene callback immediately invalidates freshness and removes the
  in-memory key before suspension; a privacy cover hides inactive room content.
  Late background projections cannot restore the key. Foreground reconnect
  waits for a fresh projection. Terminal failures remain visible across scene
  changes instead of becoming a stuck Connecting state.
- Leave is available in the shared room handoff, including lobby, board, and
  failed connection states. It awaits socket/cache/Keychain cleanup and clears
  root session/navigation. Switching rooms cleans up the previous session;
  opening the same room preserves its seat and connection.
- Shared `RoomActionStatusView` presents pending/unknown/retry state in both
  lobby and board. Explicit retry requires fresh state and current permission;
  dismiss uses the session's cancel policy. The pending gate includes command-ID
  preparation. Safe asynchronous server rejections are visible, and stale local
  action errors clear when the result changes.
- Debug permits plaintext WebSockets only on loopback. Environment wiring
  leaves the exception disabled for Staging/Release. Both the actual built
  configuration and rejection of a remote plaintext host are tested.
- Invalid transport frames emit a safe incompatibility event and reconnect for
  fresh state. Semantic projection rejection invalidates freshness, and a valid
  replacement clears the error. No raw frame data is retained in the event.
- Task 9 Steps 1–2 are reopened with their actual staging/device blockers.
  Snapshot revision 18 explicitly says the plan is incomplete. The README's
  simulator UUID is now a discovered destination variable. The stale spec
  review status and two full-diff whitespace findings were also corrected.

### Regression evidence

The initial regression build failed with missing `RoomSeatStoring` before the
new flow implementation. A later focused terminal-lifecycle regression failed
against the first implementation, then passed after terminal-state guards were
added. Tests cover saved-host restoration without HTTP or Keychain overwrite,
new-seat persistence, ordered background/foreground forwarding, stale terminal
generation rejection, generationless initial configuration failure handling,
same-room persistence preservation, replacement cleanup, root leave, background
key redaction, unsafe/incompatible update recovery, safe asynchronous lobby
errors, pending recovery, and Debug transport policy.

The latest Debug and Staging XCTest/XCUITest runs passed on iPhone SE (3rd
generation), iOS 18.2. Each configuration's final result has 125 passed (121
unit tests and 4 UI tests), 0 failed, 0 skipped. This supersedes the earlier
121-total test count recorded during the initial integration-fix wave.
Commands, with configuration and derived-data path changed
for Staging:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet \
  -project apps/ios/CipherParty.xcodeproj -scheme CipherParty \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=A2F34315-5495-46DD-874E-F8248399991F,arch=arm64' \
  -derivedDataPath /private/tmp/cipher-final-fix \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
```

Staging used `-configuration Staging` and
`-derivedDataPath /private/tmp/cipher-final-fix-staging`. The initial generic
simulator `build-for-testing` also passed after implementation.

Repository verification passed: `pnpm run check` (24 fixture tests, formatting,
lint, typechecks, 22 game-core, 46 protocol, 53 web, 41 Worker, and one root
test), `node scripts/check-project-docs.mjs`, focused Prettier checks, and
`git diff --check 128c0f7`. No Worker/protocol/browser runtime changes were made.

### Remaining acceptance evidence

The earlier Playwright readiness blocker was resolved for this run by starting
the local Worker and binding Vite explicitly with
`pnpm --filter @cipher-party/web run dev --host 127.0.0.1`. Then
`pnpm run test:e2e` exited 1 with **No tests found**. This branch has no `e2e/`
directory; those files belong to still-pending browser Task 12. Both temporary
servers were stopped after verification. No E2E pass is claimed.

The configured staging host still requires Worker routing and Apple App ID/team
setup. Actual mixed iOS/browser gameplay, physical network interruption,
signed Universal Links/camera, and final device/accessibility visual checks
remain pending. Component/root-flow tests do not claim those acceptance steps.
Task 10 Step 5 is complete after the final scoped code-review gate. The plan
remains incomplete only because Task 9 Steps 1–2 still require staging,
mixed-client, interruption, and signed-device evidence.

The final whole-branch review package was
`review-128c0f7..d3adeb9.diff`; `/root/ios_final_gate_review` ruled **Accept**
with no Critical or Important findings. Remaining minors are non-blocking ATS
scope, test-fixture hygiene, physical-device file-protection verification, and
camera/UI accessibility refinements.
