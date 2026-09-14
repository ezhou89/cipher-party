# Task 2 Report: Shared Protocol Fixtures and Native Swift Models

## Status

DONE_WITH_CONCERNS

Task 2 is implemented. The canonical JSON fixtures pass the TypeScript protocol schemas, their iOS bundle copies are byte-identical, the Swift protocol models compile, and all focused Swift model tests pass. The repository-wide `pnpm run check` could not finish because unrelated Vitest worker processes on the host repeatedly failed to start or reset their IPC connections; all Task 2-focused checks pass.

## Files changed

- `apps/ios/CipherParty/Networking/ProtocolModels.swift`
  - Adds strict Codable models for protocol v1 projections, commands, server messages, permissions, board/cards, public history, command results, and server errors.
  - Uses explicit discriminator decoding for projection roles, commands, public history entries, command results, and server messages.
  - Rejects unsupported protocol versions, roles, phases, message types, and other discriminators with safe recoverable `ProtocolDecodingError` values that do not include raw frames.
  - Enforces the 100-entry public-history boundary and rejects hidden keys in unauthorized projection roles.
  - Preserves schema-required JSON `null` fields when encoding.
- `apps/ios/CipherPartyTests/ProtocolModelTests.swift`
  - Adds focused fixture decoding, discriminator, round-trip, privacy, Unicode, null-field, protocol-version, and history-limit coverage.
- `apps/ios/CipherPartyTests/Fixtures/*.json`
  - Adds iOS-bundled byte-identical copies of the nine canonical fixtures.
- `apps/ios/CipherParty.xcodeproj/project.pbxproj`
  - Adds `ProtocolModels.swift`, its tests, and the nine fixture resources to the existing app/test targets.
- `packages/protocol/fixtures/ios/*.json`
  - Adds seven projection fixtures plus command-envelope and server-message collections.
- `packages/protocol/src/ios-fixtures.test.ts`
  - Validates all fixtures through the existing TypeScript schemas, verifies privacy invariants and boundary cases, and compares protocol/iOS copies byte-for-byte.
- `scripts/validate-ios-protocol-fixtures.mjs`
  - Adds a focused fixture-validation entry point.
- `package.json`
  - Adds `check:ios-protocol-fixtures` and includes it in the root `check` pipeline.

No `RoomSession`, API, socket, browser runtime, Worker runtime, or UI source files were changed.

## Fixture coverage

The canonical fixture set contains:

- Lobby/unassigned, operative, clue-giver, spectator, challenged, paused, and complete projections.
- All 14 current classic commands.
- Projection, command-result, and server-error messages.
- Successful command results and all current command error codes: `stale_revision`, `unauthorized`, `invalid_phase`, `validation_failed`, `already_resolved`, `not_found`, and `conflict`.
- All current server error codes: `invalid_message`, `ticket_expired`, and `room_full`.
- All seven public-history variants.
- NFC-composed non-ASCII strings, optional card ownership, required nullable fields, protocol v1, and the 100-entry public-history maximum.

Only the clue-giver projection contains the hidden board key. The unassigned, operative, and spectator fixtures do not contain it, and Swift decoding rejects an injected key in those roles.

## TDD evidence

### TypeScript fixture cycle

RED:

```text
pnpm --filter @cipher-party/protocol exec vitest run src/ios-fixtures.test.ts
```

Result before adding fixtures: 23 expected failures because all canonical fixture files and iOS copies were absent. The test diagnostics identified each missing projection, command, message, privacy, parity, and boundary fixture expectation.

GREEN:

```text
pnpm --filter @cipher-party/protocol exec vitest run src/ios-fixtures.test.ts
```

Result after adding fixtures:

```text
Test Files  1 passed (1)
Tests       23 passed (23)
```

### Swift model cycle

Initial RED compilation boundary:

```text
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/cipher-party-ios-task2-red-escalated \
  -only-testing:CipherPartyTests/ProtocolModelTests \
  build-for-testing
```

Result before implementing the model:

```text
error: Build input file cannot be found: '.../Networking/ProtocolModels.swift'
** TEST BUILD FAILED **
```

The first implementation compilation then exposed an access-control error: Codable witness methods in a private protocol extension could not satisfy the model conformances. Moving that discriminator helper from private to module scope resolved the compiler error without broadening app API visibility.

History-discriminator RED:

```text
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/cipher-party-ios-task2-red-history \
  -only-testing:CipherPartyTests/ProtocolModelTests \
  build-for-testing
```

Result before adding the explicit history discriminator accessor: exit 65 with `PublicHistoryEntry has no member type`. The accessor and fixture coverage for every history case were then added.

Required-null RED:

```text
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=A2F34315-5495-46DD-874E-F8248399991F,arch=arm64' \
  -derivedDataPath /tmp/cipher-party-ios-task2-tests \
  -parallel-testing-enabled NO \
  -only-testing:CipherPartyTests/ProtocolModelTests/testProjectionEncodingRetainsRequiredNullFields \
  test
```

Result before custom encoders: exit 65 with `testProjectionEncodingRetainsRequiredNullFields` failing because synthesized encoding omitted schema-required nullable properties. Explicit encoders now preserve those fields as JSON `null`.

A subsequent single-test GREEN attempt stalled while xcodebuild waited for simulator test workers to materialize/launch. It was interrupted after approximately 90 seconds with Ctrl-C and exit 75, in accordance with the instruction not to wait indefinitely. The simulator was reset and booted, then the full focused class was run with an explicit arm64 destination; it passed as recorded below.

## Verification evidence

### Canonical fixture validator

```text
node scripts/validate-ios-protocol-fixtures.mjs
```

```text
Test Files  1 passed (1)
Tests       23 passed (23)
Process exited 0
```

### Full protocol package

```text
pnpm --filter @cipher-party/protocol test
```

```text
Test Files  4 passed (4)
Tests       45 passed (45)
Process exited 0
```

### Focused Swift model tests

```text
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=A2F34315-5495-46DD-874E-F8248399991F,arch=arm64' \
  -derivedDataPath /tmp/cipher-party-ios-task2-tests \
  -parallel-testing-enabled NO \
  -only-testing:CipherPartyTests/ProtocolModelTests \
  test
```

```text
Executed 11 tests, with 0 failures (0 unexpected)
** TEST SUCCEEDED **
```

A final repetition of the same command after all non-Swift edits encountered a host simulator-service failure before build/test execution: `CoreSimulatorService connection became invalid`, `simdiskimaged crashed or is not responding`, and `Failed to initialize simulator device set`. The command then stopped making progress while resolving the unavailable destination, so it was terminated after approximately 31 seconds (`kill 65185`, exit 143, `** BUILD INTERRUPTED **`) rather than waiting indefinitely. No Swift, fixture, or Xcode project source changed after the successful 11/11 run above.

### Formatting, lint, type checking, and repository check

Scoped fixture/model support files were formatted with:

```text
pnpm exec prettier --write packages/protocol/src/ios-fixtures.test.ts \
  packages/protocol/fixtures/ios/*.json \
  apps/ios/CipherPartyTests/Fixtures/*.json \
  scripts/validate-ios-protocol-fixtures.mjs
```

The new script and TypeScript test pass focused ESLint. The root check's formatting, lint, all workspace typecheck phases, game-core tests (22/22), protocol tests (45/45), and iOS fixture tests (23/23) also passed before unrelated test-worker failures.

The first sandboxed `pnpm run check` attempt was blocked when Wrangler could not write its user log and could not listen on `127.0.0.1` (`EPERM`). An escalated rerun advanced through all static checks and focused suites, then Worker Cloudflare test pools failed with IPC `ECONNRESET`/startup timeouts and the web package reported 11 timeout failures. An isolated escalated retry:

```text
pnpm --filter @cipher-party/web test
```

started no actual tests because all six Vitest fork workers timed out waiting to respond. A read-only process inventory showed dozens of unrelated, long-lived `npm exec xcodebuildmcp@latest mcp` processes and another active xcodebuild, consistent with host process/resource contention. Those processes were not modified or terminated because they are outside Task 2 scope.

Final repository hygiene:

```text
git diff --check
```

Result: exit 0, no whitespace errors.

## Self-review

- Confirmed every current TypeScript command, server-message discriminator, projection role, history variant, error code, phase, team, and ownership discriminator has a Swift counterpart and fixture coverage.
- Confirmed protocol decoding is strict and unsupported values return safe typed errors without raw payload or secret interpolation.
- Confirmed the key is modeled only on clue-giver projections and unauthorized key injection is rejected.
- Confirmed optional/nullable schema fields round-trip with the JSON shape expected by the TypeScript schemas.
- Confirmed the public-history maximum is enforced at 100 in both TypeScript schema tests and Swift decoding.
- Confirmed protocol fixture copies are byte-identical across the package and iOS bundle.
- Confirmed Xcode project changes are limited to compiling the new model/test and bundling their fixture resources.
- Confirmed no runtime logging was introduced and no ticket secrets or raw frames are logged.
- Confirmed no Task 1 behavior or unrelated browser/Worker code was changed.

## Concerns

- Repository-wide runtime tests remain affected by host Vitest worker-pool startup resets/timeouts. This does not reproduce as a Task 2 fixture, protocol, lint, typecheck, Swift compile, or Swift test failure, and no affected web/Worker source was changed.
- Simulator infrastructure was unstable: one single-test worker launch stalled, a recovered full focused arm64 run passed all 11 tests, and a final repeat could not connect to CoreSimulatorService and was interrupted. Future CI should use a healthy, booted explicit simulator destination for predictable execution.

## Review follow-up: strict Swift/Zod decoding parity

### Findings addressed

- Required nullable properties now distinguish omission from explicit JSON `null`. Swift rejects an omitted projection `board`, seat/viewer `teamId`, board `clue`, `nomination`, `winner`, or `completionReason`, and `assign_seat.teamId`; explicit `null` remains valid where the Zod schema uses `.nullable()`.
- The optional `PublicCard.owner` retains Zod `.optional()` semantics: omission is valid, but explicit `null` is rejected.
- Every Swift object corresponding to a Zod `.strict()` schema now rejects unknown keys. Discriminated union variants also reject keys that belong to a different known variant, such as `playerId` on `randomize_teams`, `decision` on `clue_submitted`, or `code` on a successful command result.
- Swift now enforces the remaining modeled Zod bounds: nonnegative revisions and guess counts; nonempty IDs, room code, invite URL, display names, timestamps, clue/history words; board clue minimum count; history and submitted-clue counts from 1 through 9; and command clue character/grapheme rules.
- Submitted clue words now mirror the TypeScript transform by trimming and NFC-normalizing before validation.
- The canonical `assign_seat` fixture now uses `"teamId": null`, so the required-nullable command case is covered by both TypeScript fixture validation and Swift fixture round-tripping.

### Review TDD evidence

Swift RED, before production changes:

```text
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=A2F34315-5495-46DD-874E-F8248399991F,arch=arm64' \
  -derivedDataPath /tmp/cipher-party-ios-task2-review \
  -parallel-testing-enabled NO \
  -only-testing:CipherPartyTests/ProtocolModelTests/testRejectsOmittedRequiredNullableFieldsAndAcceptsExplicitNull \
  -only-testing:CipherPartyTests/ProtocolModelTests/testRejectsUnknownFieldsAtEveryStrictSchemaBoundary \
  -only-testing:CipherPartyTests/ProtocolModelTests/testRejectsValuesOutsideTheZodNumericAndStringContract \
  test
```

```text
Executed 3 tests, with 39 failures (0 unexpected)
** TEST FAILED **
```

The failures were the intended behavior gap: omitted nullable keys, unknown keys, and invalid bounds all decoded successfully.

Swift GREEN, after strict decoding and value validation:

```text
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=A2F34315-5495-46DD-874E-F8248399991F,arch=arm64' \
  -derivedDataPath /tmp/cipher-party-ios-task2-review \
  -parallel-testing-enabled NO \
  -only-testing:CipherPartyTests/ProtocolModelTests/testRejectsOmittedRequiredNullableFieldsAndAcceptsExplicitNull \
  -only-testing:CipherPartyTests/ProtocolModelTests/testRejectsUnknownFieldsAtEveryStrictSchemaBoundary \
  -only-testing:CipherPartyTests/ProtocolModelTests/testRejectsValuesOutsideTheZodNumericAndStringContract \
  test
```

```text
Process exited 0
```

Fixture RED, before changing the canonical nullable command fixture:

```text
pnpm --filter @cipher-party/protocol exec vitest run src/ios-fixtures.test.ts
```

```text
Test Files  1 failed (1)
Tests       1 failed | 23 passed (24)
```

The new assertion correctly failed because the only `assign_seat` fixture still used `"teamId": "red"`.

Fixture GREEN, after changing both byte-identical fixture copies to explicit `null`:

```text
pnpm --filter @cipher-party/protocol exec vitest run src/ios-fixtures.test.ts
```

```text
Test Files  1 passed (1)
Tests       24 passed (24)
```

### Review verification evidence

Compile-only Swift verification:

```text
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/cipher-party-ios-task2-review-build \
  -only-testing:CipherPartyTests/ProtocolModelTests \
  build-for-testing
```

```text
Process exited 0
```

The command emitted only pre-existing Swift 6 actor-isolation warnings from `CipherPartyUITests/EntryFlowUITests.swift`, which was not changed in Task 2.

Full focused Swift test class:

```text
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/CipherParty.xcodeproj \
  -scheme CipherParty \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=A2F34315-5495-46DD-874E-F8248399991F,arch=arm64' \
  -derivedDataPath /tmp/cipher-party-ios-task2-review \
  -parallel-testing-enabled NO \
  -only-testing:CipherPartyTests/ProtocolModelTests \
  test
```

```text
Executed 14 tests, with 0 failures (0 unexpected)
** TEST SUCCEEDED **
```

Canonical fixture validator:

```text
node scripts/validate-ios-protocol-fixtures.mjs
```

```text
Test Files  1 passed (1)
Tests       24 passed (24)
Process exited 0
```

Full protocol package:

```text
pnpm --filter @cipher-party/protocol test
```

```text
Test Files  4 passed (4)
Tests       46 passed (46)
Process exited 0
```

Static checks:

```text
pnpm run lint
pnpm run typecheck
```

```text
eslint .: Process exited 0
All four workspace typecheck scripts: Done
```

An exploratory `xcrun swift-format lint --strict` invocation exited 1 because the repository has no `.swift-format` configuration and Xcode's default rules require two-space indentation plus style rewrites that conflict with the existing iOS source convention. It reported style warnings rather than compiler diagnostics; no repository acceptance script invokes this unconfigured formatter. The Xcode compile and test commands above are clean apart from the pre-existing UI-test actor warnings.

### Review self-review

- Rechecked every `.strict()` object in `projections.ts`, `commands.ts`, and `transport.ts` against a corresponding dynamic-key validation point in Swift.
- Rechecked required-versus-nullable-versus-optional behavior for every optional Swift property.
- Rechecked each numeric and nonempty-string Zod constraint against Swift validation, including discriminated history and command variants.
- Confirmed validation errors name fields and constraints but never include raw frames or rejected secret values.
- Confirmed the iOS and protocol command fixtures remain byte-identical and both schema/test suites decode the nullable assignment.
- Confirmed the review changes remain within protocol model, protocol fixture, test, and report scope.

### Review concerns

- No new functional concerns. The earlier repository-wide Vitest host-resource concern remains historical; review-focused lint, typecheck, TypeScript tests, fixture parity, Swift compilation, and all 14 Swift model tests pass.
