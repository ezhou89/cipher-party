import Foundation
import XCTest
@testable import CipherParty

@MainActor
final class RoomSessionTests: XCTestCase {
    func testRootFlowSerializesLifecycleAndLeavesBeforeReplacingRoom() async throws {
        let first = makeHarness()
        let second = makeHarness()
        let credentials = SeatCredentials(code: "ABC234", playerId: "host", seatToken: "seat", hostToken: "host")
        let flow = RoomFlow { $0.code == "ABC234" ? first.session : second.session }
        await flow.open(credentials)
        await first.socket.emit(.open)
        await first.socket.emit(.message(.projection(try projection(named: "projection-operative"))))
        try await waitUntil { first.session.projection != nil }
        flow.sceneChanged(isActive: false)
        XCTAssertTrue(first.session.isStale)
        flow.sceneChanged(isActive: true)
        await flow.waitForTransitions()
        let backgrounds = await first.socket.backgroundCount()
        let foregrounds = await first.socket.foregroundCount()
        let lifecycle = await first.socket.lifecycleEvents()
        XCTAssertEqual(backgrounds, 1)
        XCTAssertEqual(foregrounds, 1)
        XCTAssertEqual(lifecycle, ["background", "foreground"])
        XCTAssertTrue(first.session.isStale)
        await flow.open(credentials)
        let sameRoomCloses = await first.socket.closeCount()
        XCTAssertEqual(sameRoomCloses, 0)
        await flow.open(SeatCredentials(code: "K7M2X9", playerId: "guest", seatToken: "seat", hostToken: nil))
        let closes = await first.socket.closeCount()
        let deleted = await first.store.deletedCodes()
        XCTAssertEqual(closes, 1)
        XCTAssertEqual(deleted, ["ABC234"])
        XCTAssertTrue(flow.session === second.session)
        await flow.leave()
        let secondCloses = await second.socket.closeCount()
        XCTAssertEqual(secondCloses, 1)
        XCTAssertNil(flow.session)
        XCTAssertNil(flow.roomCode)
    }

    func testUnsafeProjectionInvalidatesFreshStateUntilValidReplacement() async throws {
        let harness = makeHarness()
        try await connect(harness, projection: projection(named: "projection-operative"))
        await harness.socket.emit(.message(.projection(try projection(named: "projection-operative", revision: 9, unrevealedOwner: .hazard))))
        try await waitUntil { harness.session.lastError == .unsafeProjection }
        XCTAssertTrue(harness.session.isStale)
        await XCTAssertThrowsErrorAsync(try await harness.session.endTurn()) {
            XCTAssertEqual($0 as? RoomSessionIntentError, .notConnected)
        }
        await harness.socket.emit(.message(.projection(try projection(named: "projection-operative", revision: 10))))
        try await waitUntil { harness.session.projection?.revision == 10 }
        XCTAssertFalse(harness.session.isStale)
        XCTAssertNil(harness.session.lastError)
    }

    func testIncompatibleTransportEventMakesExistingProjectionReadOnly() async throws {
        let harness = makeHarness()
        try await connect(harness, projection: projection(named: "projection-clue-giver"))
        await harness.socket.emit(.incompatibleMessage)
        try await waitUntil { harness.session.lastError == .connection(.incompatibleResponse) }
        XCTAssertTrue(harness.session.isStale)
        await harness.socket.emit(.open)
        await harness.socket.emit(.message(.projection(try projection(named: "projection-clue-giver", revision: 12))))
        try await waitUntil { harness.session.projection?.revision == 12 }
        XCTAssertFalse(harness.session.isStale)
        XCTAssertNil(harness.session.lastError)
    }

    func testRootBackgroundRedactsKeyAndIgnoresLateProjectionUntilForeground() async throws {
        let harness = makeHarness()
        let flow = RoomFlow { _ in harness.session }
        await flow.open(SeatCredentials(code: "ABC234", playerId: "host", seatToken: "seat", hostToken: "host"))
        await harness.socket.emit(.open)
        await harness.socket.emit(.message(.projection(try projection(named: "projection-clue-giver"))))
        try await waitUntil { harness.session.projection?.key != nil }
        flow.sceneChanged(isActive: false)
        XCTAssertNil(harness.session.projection?.key)
        XCTAssertTrue(harness.session.isStale)
        await flow.waitForTransitions()
        await harness.socket.emit(.message(.projection(try projection(named: "projection-clue-giver", revision: 12))))
        await harness.socket.emit(.closed(.background))
        try await waitUntil { harness.session.connectionState == .disconnected(.background) }
        XCTAssertNil(harness.session.projection?.key)
        XCTAssertNotEqual(harness.session.projection?.revision, 12)
        flow.sceneChanged(isActive: true)
        await flow.waitForTransitions()
        await harness.socket.emit(.open)
        await harness.socket.emit(.message(.projection(try projection(named: "projection-clue-giver", revision: 13))))
        try await waitUntil { harness.session.projection?.revision == 13 }
        XCTAssertFalse(harness.session.isStale)
        XCTAssertNotNil(harness.session.projection?.key)
        await flow.leave()
    }

    func testQueuedPreBackgroundProjectionIsIgnoredUntilPostForegroundProjection() async throws {
        let harness = makeHarness()
        let flow = RoomFlow { _ in harness.session }
        await flow.open(SeatCredentials(code: "ABC234", playerId: "host", seatToken: "seat", hostToken: "host"))
        await harness.socket.emit(.open(generation: 1))
        await harness.socket.emit(.message(.projection(try projection(named: "projection-clue-giver", revision: 8)), generation: 1))
        try await waitUntil { harness.session.projection?.revision == 8 && !harness.session.isStale }

        await harness.socket.holdEvents()
        await harness.socket.emit(.message(.projection(try projection(named: "projection-clue-giver", revision: 12)), generation: 1))
        flow.sceneChanged(isActive: false)
        flow.sceneChanged(isActive: true)
        await flow.waitForTransitions()
        await harness.socket.releaseEvents()
        for _ in 0..<40 { await Task.yield() }

        XCTAssertEqual(harness.session.projection?.revision, 8)
        XCTAssertTrue(harness.session.isStale)

        await harness.socket.emit(.open(generation: 2))
        await harness.socket.emit(.message(.projection(try projection(named: "projection-clue-giver", revision: 13)), generation: 2))
        try await waitUntil { harness.session.projection?.revision == 13 && !harness.session.isStale }
    }

    func testFailedPriorRoomCleanupRemainsVisibleAndCanRetryWhileNewRoomIsActive() async throws {
        let first = makeHarness(cacheDeleteFailures: 1)
        let second = makeHarness()
        let flow = RoomFlow { $0.code == "ABC234" ? first.session : second.session }

        await flow.open(SeatCredentials(code: "ABC234", playerId: "host", seatToken: "seat", hostToken: "host"))
        await flow.open(SeatCredentials(code: "K7M2X9", playerId: "guest", seatToken: "seat", hostToken: nil))

        XCTAssertTrue(flow.session === second.session)
        XCTAssertTrue(flow.cleanupFailed)
        XCTAssertEqual(flow.pendingCleanupRoomCodes, ["ABC234"])

        await flow.retryCleanup()

        XCTAssertFalse(flow.cleanupFailed)
        XCTAssertEqual(flow.pendingCleanupRoomCodes, [])
        XCTAssertTrue(flow.session === second.session)
        let deletedCodes = await first.cache.deletedCodes()
        XCTAssertEqual(deletedCodes, ["ABC234"])
    }

    func testTerminalFailureSurvivesSceneChangesAndStillAllowsRootLeave() async throws {
        let harness = makeHarness()
        let flow = RoomFlow { _ in harness.session }
        await flow.open(SeatCredentials(code: "ABC234", playerId: "host", seatToken: "seat", hostToken: "host"))
        await harness.socket.emit(.terminalFailure(.authentication, generation: 2))
        try await waitUntil { harness.session.connectionState == .failed(.authentication) }
        flow.sceneChanged(isActive: false)
        flow.sceneChanged(isActive: true)
        await flow.waitForTransitions()
        XCTAssertEqual(harness.session.connectionState, .failed(.authentication))
        await flow.leave()
        XCTAssertNil(flow.session)
    }

    func testSharedActionStatusShowsSafeAsyncRejectionThenClearsForNextCommand() async throws {
        let harness = makeHarness(commandIDs: [Self.commandA, Self.commandB])
        try await connect(harness, projection: projection(named: "projection-lobby-unassigned", allPermissions: true))
        try await harness.session.lockRoom(true)
        await harness.socket.emit(.message(.commandResult(commandId: Self.commandA, result: .failure(revision: harness.session.projection!.revision, code: .storageFailed, message: "private raw payload"))))
        try await waitUntil { harness.session.lastCommandResult != nil }
        let rejected = RoomActionPresentation(session: harness.session)
        XCTAssertNotNil(rejected.error)
        XCTAssertFalse(rejected.error!.contains("private raw payload"))
        try await harness.session.lockRoom(true)
        XCTAssertNil(RoomActionPresentation(session: harness.session).error)
    }

    func testRecoveryPresentationEnablesExplicitRetryOnlyAfterFreshProjection() async throws {
        let harness = makeHarness(commandIDs: [Self.commandA, Self.commandB])
        try await connect(harness, projection: projection(named: "projection-operative"))
        try await harness.session.nominateCard("moon")
        var presentation = RoomActionPresentation(session: harness.session)
        XCTAssertFalse(presentation.canRetry)
        XCTAssertFalse(presentation.canCancel)
        await harness.socket.emit(.reconnecting(attempt: 1, delay: 0.5))
        try await waitUntil { harness.session.pendingCommand?.delivery == .unknownDelivery }
        presentation = RoomActionPresentation(session: harness.session)
        XCTAssertFalse(presentation.canRetry)
        XCTAssertTrue(presentation.canCancel)
        await harness.socket.emit(.open)
        await harness.socket.emit(.message(.projection(try projection(named: "projection-operative", revision: 9))))
        try await waitUntil { harness.session.pendingCommand?.delivery == .retryAvailable }
        presentation = RoomActionPresentation(session: harness.session)
        XCTAssertTrue(presentation.canRetry)
        try await harness.session.retryPendingCommand()
        let commands = await harness.socket.sentCommands()
        XCTAssertEqual(commands.count, 2)
        XCTAssertEqual(commands.last?.expectedRevision, 9)
        XCTAssertNotEqual(commands.first?.commandId, commands.last?.commandId)
    }

    func testServerProjectionReplacesStateAndConnectionTransitionsControlFreshness() async throws {
        let harness = makeHarness()
        await harness.session.connect()

        await harness.socket.emit(.connecting)
        try await waitUntil { harness.session.connectionState == .connecting }

        await harness.socket.emit(.open)
        try await waitUntil { harness.session.connectionState == .connected }

        let operative = try projection(named: "projection-operative")
        await harness.socket.emit(.message(.projection(operative)))
        try await waitUntil { harness.session.projection?.revision == 8 }
        XCTAssertEqual(harness.session.projection?.viewRole, .operative)
        XCTAssertEqual(harness.session.lastUpdated, Self.now)
        XCTAssertFalse(harness.session.isStale)

        await harness.socket.emit(.reconnecting(attempt: 1, delay: 0.5))
        try await waitUntil {
            harness.session.connectionState == .reconnecting(attempt: 1, delay: 0.5)
        }
        XCTAssertTrue(harness.session.isStale)

        await harness.socket.emit(.open)
        let challenged = try projection(named: "projection-challenged")
        await harness.socket.emit(.message(.projection(challenged)))
        try await waitUntil { harness.session.projection?.revision == 11 }
        XCTAssertEqual(harness.session.projection?.serverProjection, challenged)
        XCTAssertFalse(harness.session.isStale)
        let savedRevisions = await harness.cache.savedProjections().map(\.projection.revision)
        XCTAssertEqual(savedRevisions, [8, 11])
    }

    func testCachedClueGiverProjectionLoadsRedactedAndStaysStaleUntilFreshProjection() async throws {
        let liveProjection = try RoomProjection(serverProjection: projection(named: "projection-clue-giver"))
        let cached = CachedRoomProjection(
            projection: liveProjection.redacted(),
            lastUpdated: Self.oldDate
        )
        let harness = makeHarness(cached: cached)

        await harness.session.connect()
        try await waitUntil { harness.session.projection != nil }
        XCTAssertEqual(harness.session.projection?.viewRole, .clueGiver)
        XCTAssertNil(harness.session.projection?.key)
        XCTAssertEqual(harness.session.lastUpdated, Self.oldDate)
        XCTAssertTrue(harness.session.isStale)

        await harness.socket.emit(.open)
        try await waitUntil { harness.session.connectionState == .connected }
        XCTAssertTrue(harness.session.isStale)

        await harness.socket.emit(.message(.projection(try projection(named: "projection-clue-giver"))))
        try await waitUntil { harness.session.projection?.key != nil }
        XCTAssertFalse(harness.session.isStale)
    }

    func testPermissionsAndOneInFlightCommandGateTypedIntents() async throws {
        let harness = makeHarness(commandIDs: [Self.commandA])
        try await connect(harness, projection: projection(named: "projection-operative"))

        await XCTAssertThrowsErrorAsync(try await harness.session.submitClue(word: "Moon", count: 2)) {
            XCTAssertEqual($0 as? RoomSessionIntentError, .permissionDenied(.submitClue))
        }

        try await harness.session.nominateCard("moon")
        let sent = await harness.socket.sentCommands()
        XCTAssertEqual(sent, [
            CommandEnvelope(
                commandId: Self.commandA,
                expectedRevision: 8,
                command: .nominateCard(cardId: "moon")
            )
        ])
        XCTAssertEqual(harness.session.pendingCommand?.delivery, .awaitingResult)

        await XCTAssertThrowsErrorAsync(try await harness.session.endTurn()) {
            XCTAssertEqual($0 as? RoomSessionIntentError, .commandInFlight)
        }
        let sentCount = await harness.socket.sentCommands().count
        XCTAssertEqual(sentCount, 1)
    }

    func testConcurrentIntentCannotPassGateWhileFirstCommandIDIsSuspended() async throws {
        let generator = SuspendedCommandIDGenerator(
            ids: [Self.commandA, Self.commandB],
            suspendingRequest: 1
        )
        let harness = makeHarness(commandIDGenerator: generator)
        try await connect(harness, projection: projection(named: "projection-operative"))

        let firstIntent = Task { @MainActor in
            try await harness.session.nominateCard("moon")
        }
        try await waitUntil { generator.isSuspended }

        let secondIntent = Task { @MainActor in
            try await harness.session.endTurn()
        }
        await Task.yield()
        generator.resume()

        let firstError = await capturedError(from: firstIntent)
        let secondError = await capturedError(from: secondIntent)
        XCTAssertNil(firstError)
        XCTAssertEqual(
            secondError as? RoomSessionIntentError,
            .commandInFlight
        )
        let sent = await harness.socket.sentCommands()
        XCTAssertEqual(sent.map(\.commandId), [Self.commandA])
    }

    func testPermissionIsRevalidatedAfterCommandIDPreparation() async throws {
        let generator = SuspendedCommandIDGenerator(
            ids: [Self.commandA],
            suspendingRequest: 1
        )
        let harness = makeHarness(commandIDGenerator: generator)
        try await connect(harness, projection: projection(named: "projection-operative"))

        let intent = Task { @MainActor in
            try await harness.session.nominateCard("moon")
        }
        try await waitUntil { generator.isSuspended }
        await harness.socket.emit(
            .message(.projection(try projection(named: "projection-spectator", revision: 9)))
        )
        try await waitUntil { harness.session.projection?.revision == 9 }

        generator.resume()

        let intentError = await capturedError(from: intent)
        XCTAssertEqual(
            intentError as? RoomSessionIntentError,
            .permissionDenied(.nominate)
        )
        let sent = await harness.socket.sentCommands()
        XCTAssertTrue(sent.isEmpty)
        XCTAssertNil(harness.session.pendingCommand)
    }

    func testEveryTypedIntentMapsToItsProtocolCommand() async throws {
        let ids = (1...14).map { index in
            UUID(uuidString: String(format: "40000000-0000-4000-8000-%012d", index))!
        }
        let harness = makeHarness(commandIDs: ids)
        try await connect(
            harness,
            projection: projection(named: "projection-challenged", allPermissions: true)
        )
        let expected: [ClassicCommand] = [
            .randomizeTeams,
            .assignSeat(playerId: "player-2", teamId: .blue),
            .setRole(playerId: "player-2", role: .operative),
            .lockRoom(locked: true),
            .startBoard,
            .submitClue(word: "Moon", count: 2),
            .challengeClue,
            .resolveChallenge(decision: .accept),
            .nominateCard(cardId: "moon"),
            .clearNomination,
            .confirmReveal(cardId: "moon"),
            .endTurn,
            .pauseRoom,
            .resumeRoom
        ]
        let intents: [@MainActor () async throws -> Void] = [
            { try await harness.session.randomizeTeams() },
            { try await harness.session.assignSeat(playerId: "player-2", teamId: .blue) },
            { try await harness.session.setRole(playerId: "player-2", role: .operative) },
            { try await harness.session.lockRoom(true) },
            { try await harness.session.startBoard() },
            { try await harness.session.submitClue(word: "Moon", count: 2) },
            { try await harness.session.challengeClue() },
            { try await harness.session.resolveChallenge(.accept) },
            { try await harness.session.nominateCard("moon") },
            { try await harness.session.clearNomination() },
            { try await harness.session.confirmReveal("moon") },
            { try await harness.session.endTurn() },
            { try await harness.session.pause() },
            { try await harness.session.resume() }
        ]

        for (index, intent) in intents.enumerated() {
            try await intent()
            let sent = await harness.socket.sentCommands()
            let commandId = try XCTUnwrap(sent.last?.commandId)
            await harness.socket.emit(
                .message(
                    .commandResult(
                        commandId: commandId,
                        result: .failure(revision: 11, code: .wrongPhase, message: "Rejected")
                    )
                )
            )
            try await waitUntil { harness.session.pendingCommand == nil }
            XCTAssertEqual(sent.last?.command, expected[index])
        }
    }

    func testLeaveClosesSocketDeletesRoomDataAndClearsMemory() async throws {
        let cached = CachedRoomProjection(
            projection: try RoomProjection(
                serverProjection: projection(named: "projection-operative")
            ),
            lastUpdated: Self.oldDate
        )
        let harness = makeHarness(cached: cached, commandIDs: [Self.commandA])
        try await connect(harness, projection: projection(named: "projection-operative"))
        try await harness.session.nominateCard("moon")

        await harness.session.leave()

        let closeCount = await harness.socket.closeCount()
        let cacheDeletions = await harness.cache.deletedCodes()
        let storeDeletions = await harness.store.deletedCodes()
        XCTAssertEqual(closeCount, 1)
        XCTAssertEqual(cacheDeletions, ["ABC234"])
        XCTAssertEqual(storeDeletions, ["ABC234"])
        XCTAssertEqual(harness.session.connectionState, .idle)
        XCTAssertNil(harness.session.projection)
        XCTAssertNil(harness.session.lastUpdated)
        XCTAssertNil(harness.session.pendingCommand)
        XCTAssertNil(harness.session.lastCommandResult)
        XCTAssertNil(harness.session.lastError)
        XCTAssertFalse(harness.session.isStale)
    }

    func testSuccessfulResultWaitsForItsProjectionBeforeClearingPending() async throws {
        let harness = makeHarness(commandIDs: [Self.commandA])
        try await connect(harness, projection: projection(named: "projection-operative"))
        try await harness.session.nominateCard("moon")

        let result = CommandResult.success(revision: 9)
        await harness.socket.emit(.message(.commandResult(commandId: Self.commandA, result: result)))
        try await waitUntil { harness.session.lastCommandResult == result }
        XCTAssertEqual(harness.session.pendingCommand?.delivery, .awaitingProjection(revision: 9))

        await harness.socket.emit(.message(.projection(try projection(named: "projection-operative", revision: 9))))
        try await waitUntil { harness.session.pendingCommand == nil }
        XCTAssertEqual(harness.session.projection?.revision, 9)
    }

    func testProjectionBeforeResultStillWaitsForMatchingResultThenReconciles() async throws {
        let harness = makeHarness(commandIDs: [Self.commandA])
        try await connect(harness, projection: projection(named: "projection-operative"))
        try await harness.session.nominateCard("moon")

        await harness.socket.emit(.message(.projection(try projection(named: "projection-operative", revision: 9))))
        try await waitUntil { harness.session.projection?.revision == 9 }
        XCTAssertEqual(harness.session.pendingCommand?.delivery, .awaitingResult)

        await harness.socket.emit(
            .message(.commandResult(commandId: Self.commandA, result: .success(revision: 9)))
        )
        try await waitUntil { harness.session.pendingCommand == nil }
    }

    func testStaleRevisionWaitsForFreshProjectionThenRequiresExplicitRetryWithNewID() async throws {
        let harness = makeHarness(commandIDs: [Self.commandA, Self.commandB])
        try await connect(harness, projection: projection(named: "projection-operative"))
        try await harness.session.nominateCard("moon")

        let stale = CommandResult.failure(
            revision: 10,
            code: .staleRevision,
            message: "Projection revision is stale"
        )
        await harness.socket.emit(.message(.commandResult(commandId: Self.commandA, result: stale)))
        try await waitUntil { harness.session.lastCommandResult == stale }
        XCTAssertEqual(harness.session.pendingCommand?.delivery, .awaitingProjection(revision: 10))
        let countBeforeProjection = await harness.socket.sentCommands().count
        XCTAssertEqual(countBeforeProjection, 1)

        await harness.socket.emit(.message(.projection(try projection(named: "projection-operative", revision: 10))))
        try await waitUntil { harness.session.pendingCommand?.delivery == .retryAvailable }
        let countBeforeRetry = await harness.socket.sentCommands().count
        XCTAssertEqual(countBeforeRetry, 1, "A stale command must not replay itself")

        try await harness.session.retryPendingCommand()
        let sent = await harness.socket.sentCommands()
        XCTAssertEqual(sent.count, 2)
        XCTAssertEqual(sent[1].commandId, Self.commandB)
        XCTAssertEqual(sent[1].expectedRevision, 10)
        XCTAssertEqual(sent[1].command, .nominateCard(cardId: "moon"))
        XCTAssertEqual(harness.session.pendingCommand?.delivery, .awaitingResult)
    }

    func testCancelDuringRetryPreparationPreventsTheRetryFromSending() async throws {
        let generator = SuspendedCommandIDGenerator(
            ids: [Self.commandA, Self.commandB],
            suspendingRequest: 2
        )
        let harness = makeHarness(commandIDGenerator: generator)
        try await connect(harness, projection: projection(named: "projection-operative"))
        try await harness.session.nominateCard("moon")
        try await prepareRetry(harness)

        let retry = Task { @MainActor in
            try await harness.session.retryPendingCommand()
        }
        try await waitUntil { generator.isSuspended }
        harness.session.cancelPendingCommand()
        generator.resume()

        let retryError = await capturedError(from: retry)
        XCTAssertEqual(
            retryError as? RoomSessionIntentError,
            .retryUnavailable
        )
        let sent = await harness.socket.sentCommands()
        XCTAssertEqual(sent.map(\.commandId), [Self.commandA])
        XCTAssertNil(harness.session.pendingCommand)
    }

    func testLateResultDuringRetryPreparationPreventsTheRetryFromSending() async throws {
        let generator = SuspendedCommandIDGenerator(
            ids: [Self.commandA, Self.commandB],
            suspendingRequest: 2
        )
        let harness = makeHarness(commandIDGenerator: generator)
        try await connect(harness, projection: projection(named: "projection-operative"))
        try await harness.session.nominateCard("moon")
        try await prepareRetry(harness)

        let retry = Task { @MainActor in
            try await harness.session.retryPendingCommand()
        }
        try await waitUntil { generator.isSuspended }
        await harness.socket.emit(
            .message(.commandResult(commandId: Self.commandA, result: .success(revision: 9)))
        )
        try await waitUntil { harness.session.pendingCommand == nil }
        generator.resume()

        let retryError = await capturedError(from: retry)
        XCTAssertEqual(
            retryError as? RoomSessionIntentError,
            .retryUnavailable
        )
        let sent = await harness.socket.sentCommands()
        XCTAssertEqual(sent.map(\.commandId), [Self.commandA])
        XCTAssertNil(harness.session.pendingCommand)
    }

    func testLeaveDuringCommandPreparationPreventsSendAndPendingStateRestoration() async throws {
        let generator = SuspendedCommandIDGenerator(
            ids: [Self.commandA],
            suspendingRequest: 1
        )
        let harness = makeHarness(commandIDGenerator: generator)
        try await connect(harness, projection: projection(named: "projection-operative"))

        let intent = Task { @MainActor in
            try await harness.session.nominateCard("moon")
        }
        try await waitUntil { generator.isSuspended }
        await harness.session.leave()
        generator.resume()

        let intentError = await capturedError(from: intent)
        XCTAssertEqual(
            intentError as? RoomSessionIntentError,
            .notConnected
        )
        let sent = await harness.socket.sentCommands()
        XCTAssertTrue(sent.isEmpty)
        XCTAssertEqual(harness.session.connectionState, .idle)
        XCTAssertNil(harness.session.pendingCommand)
        XCTAssertNil(harness.session.lastError)
    }

    func testDefinitiveCommandErrorsClearWhenCurrentRevisionProvesRejection() async throws {
        for (index, code) in [CommandErrorCode.unauthorized, .wrongPhase].enumerated() {
            let commandID = index == 0 ? Self.commandA : Self.commandB
            let harness = makeHarness(commandIDs: [commandID])
            try await connect(harness, projection: projection(named: "projection-operative"))
            try await harness.session.nominateCard("moon")

            let result = CommandResult.failure(revision: 8, code: code, message: "Rejected")
            await harness.socket.emit(.message(.commandResult(commandId: commandID, result: result)))
            try await waitUntil { harness.session.pendingCommand == nil }

            XCTAssertEqual(harness.session.lastCommandResult, result)
            XCTAssertEqual(harness.session.lastError, .commandRejected(code: code, message: "Rejected"))
        }
    }

    func testSocketLossAfterSendBecomesUnknownAndFreshProjectionOnlyOffersRetryOrCancel() async throws {
        let harness = makeHarness(commandIDs: [Self.commandA])
        try await connect(harness, projection: projection(named: "projection-operative"))
        try await harness.session.nominateCard("moon")

        await harness.socket.emit(.reconnecting(attempt: 1, delay: 0.5))
        try await waitUntil { harness.session.pendingCommand?.delivery == .unknownDelivery }
        XCTAssertTrue(harness.session.isStale)

        await harness.socket.emit(.open)
        await harness.socket.emit(.message(.projection(try projection(named: "projection-operative", revision: 9))))
        try await waitUntil { harness.session.pendingCommand?.delivery == .retryAvailable }
        let sentCount = await harness.socket.sentCommands().count
        XCTAssertEqual(sentCount, 1)

        harness.session.cancelPendingCommand()
        XCTAssertNil(harness.session.pendingCommand)
    }

    func testUnknownCommandResultCannotReconcileCurrentPendingCommand() async throws {
        let harness = makeHarness(commandIDs: [Self.commandA])
        try await connect(harness, projection: projection(named: "projection-operative"))
        try await harness.session.nominateCard("moon")

        await harness.socket.emit(
            .message(.commandResult(commandId: Self.commandB, result: .success(revision: 9)))
        )
        await Task.yield()

        XCTAssertEqual(harness.session.pendingCommand?.commandId, Self.commandA)
        XCTAssertNil(harness.session.lastCommandResult)
    }

    func testLifecycleHooksForwardAndTerminalConnectionFailureIsUserVisible() async throws {
        let harness = makeHarness()
        await harness.session.connect()

        await harness.session.didEnterBackground()
        await harness.session.willEnterForeground()
        let backgroundCount = await harness.socket.backgroundCount()
        let foregroundCount = await harness.socket.foregroundCount()
        XCTAssertEqual(backgroundCount, 1)
        XCTAssertEqual(foregroundCount, 1)

        await harness.socket.emit(.terminalFailure(.authentication))
        try await waitUntil { harness.session.connectionState == .failed(.authentication) }
        XCTAssertEqual(harness.session.lastError, .connection(.authentication))
    }

    func testOperativeAndSpectatorProjectionsWithUnrevealedOwnershipAreRejected() async throws {
        for fixture in ["projection-operative", "projection-spectator"] {
            let harness = makeHarness()
            try await connect(harness, projection: projection(named: fixture))
            let forged = try projection(
                named: fixture,
                revision: 9,
                unrevealedOwner: .hazard
            )

            await harness.socket.emit(.message(.projection(forged)))
            try await waitUntil { harness.session.lastError != nil }

            XCTAssertEqual(harness.session.projection?.revision, 8)
            XCTAssertEqual(harness.session.lastError, .unsafeProjection)
            let savedCount = await harness.cache.savedProjections().count
            XCTAssertEqual(savedCount, 1)
        }
    }

    private func connect(_ harness: Harness, projection: ClientProjection) async throws {
        await harness.session.connect()
        await harness.socket.emit(.open)
        await harness.socket.emit(.message(.projection(projection)))
        try await waitUntil {
            harness.session.connectionState == .connected
                && harness.session.projection?.revision == projection.base.revision
                && !harness.session.isStale
        }
    }

    private func prepareRetry(_ harness: Harness) async throws {
        await harness.socket.emit(.reconnecting(attempt: 1, delay: 0.5))
        try await waitUntil { harness.session.pendingCommand?.delivery == .unknownDelivery }
        await harness.socket.emit(.open)
        await harness.socket.emit(
            .message(.projection(try projection(named: "projection-operative", revision: 9)))
        )
        try await waitUntil { harness.session.pendingCommand?.delivery == .retryAvailable }
    }

    private func capturedError(from task: Task<Void, Error>) async -> Error? {
        do {
            try await task.value
            return nil
        } catch {
            return error
        }
    }

    private func makeHarness(
        cached: CachedRoomProjection? = nil,
        commandIDs: [UUID] = [],
        commandIDGenerator: (any RoomCommandIDGenerating)? = nil,
        cacheDeleteFailures: Int = 0,
        credentialDeleteFailures: Int = 0
    ) -> Harness {
        let socket = FakeRoomSessionSocket()
        let cache = FakeProjectionCache(cached: cached, deleteFailures: cacheDeleteFailures)
        let store = FakeRoomCredentialStore(deleteFailures: credentialDeleteFailures)
        let session = RoomSession(
            code: "ABC234",
            socket: socket,
            credentialStore: store,
            cache: cache,
            clock: FixedRoomSessionClock(date: Self.now),
            commandIDGenerator: commandIDGenerator ?? SequenceCommandIDGenerator(ids: commandIDs)
        )
        return Harness(session: session, socket: socket, cache: cache, store: store)
    }

    private func projection(
        named name: String,
        revision: Int? = nil,
        unrevealedOwner: Ownership? = nil,
        allPermissions: Bool = false
    ) throws -> ClientProjection {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        let data = try Data(contentsOf: url)
        guard revision != nil || unrevealedOwner != nil || allPermissions else {
            return try JSONDecoder().decode(ClientProjection.self, from: data)
        }
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        if let revision {
            object["revision"] = revision
        }
        if let unrevealedOwner {
            var board = try XCTUnwrap(object["board"] as? [String: Any])
            var cards = try XCTUnwrap(board["cards"] as? [[String: Any]])
            let index = try XCTUnwrap(cards.firstIndex { ($0["revealed"] as? Bool) == false })
            cards[index]["owner"] = unrevealedOwner.rawValue
            board["cards"] = cards
            object["board"] = board
        }
        if allPermissions {
            var permissions = try XCTUnwrap(object["permissions"] as? [String: Any])
            for key in permissions.keys {
                permissions[key] = true
            }
            object["permissions"] = permissions
        }
        return try JSONDecoder().decode(
            ClientProjection.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
    }

    private func waitUntil(
        timeout: TimeInterval = 2,
        _ predicate: @escaping @MainActor () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !predicate() {
            guard Date() < deadline else {
                return XCTFail("Timed out waiting for session state")
            }
            await Task.yield()
        }
    }

    private static let commandA = UUID(uuidString: "30000000-0000-4000-8000-000000000001")!
    private static let commandB = UUID(uuidString: "30000000-0000-4000-8000-000000000002")!
    private static let now = Date(timeIntervalSince1970: 2_000)
    private static let oldDate = Date(timeIntervalSince1970: 1_000)
}

private struct Harness {
    let session: RoomSession
    let socket: FakeRoomSessionSocket
    let cache: FakeProjectionCache
    let store: FakeRoomCredentialStore
}

private actor FakeRoomSessionSocket: RoomSessionSocket {
    private let stream: AsyncStream<RoomSocketEvent>
    private let continuation: AsyncStream<RoomSocketEvent>.Continuation
    private var sent: [CommandEnvelope] = []
    private var closes = 0
    private var backgrounds = 0
    private var foregrounds = 0
    private var lifecycle: [String] = []
    private var generation: UInt64 = 0
    private var holdsEvents = false
    private var heldEvents: [RoomSocketEvent] = []

    init() {
        let pair = AsyncStream<RoomSocketEvent>.makeStream()
        stream = pair.stream
        continuation = pair.continuation
    }

    func events() -> AsyncStream<RoomSocketEvent> { stream }
    func start() {}
    func close() { closes += 1 }
    func didEnterBackground() -> UInt64 {
        backgrounds += 1
        generation &+= 1
        lifecycle.append("background")
        return generation
    }

    func willEnterForeground() -> UInt64 {
        foregrounds += 1
        generation &+= 1
        lifecycle.append("foreground")
        return generation
    }
    func lifecycleEvents() -> [String] { lifecycle }
    func send(_ command: CommandEnvelope) { sent.append(command) }
    func holdEvents() { holdsEvents = true }

    func releaseEvents() {
        holdsEvents = false
        heldEvents.forEach { continuation.yield($0) }
        heldEvents.removeAll()
    }

    func emit(_ event: RoomSocketEvent) {
        if holdsEvents {
            heldEvents.append(event)
        } else {
            continuation.yield(event)
        }
    }
    func sentCommands() -> [CommandEnvelope] { sent }
    func closeCount() -> Int { closes }
    func backgroundCount() -> Int { backgrounds }
    func foregroundCount() -> Int { foregrounds }
}

private actor FakeProjectionCache: ProjectionCaching {
    private let cached: CachedRoomProjection?
    private var remainingDeleteFailures: Int
    private var saved: [CachedRoomProjection] = []
    private var deletions: [String] = []

    init(cached: CachedRoomProjection?, deleteFailures: Int = 0) {
        self.cached = cached
        remainingDeleteFailures = deleteFailures
    }

    func load(code: String) -> CachedRoomProjection? { cached }

    func save(_ projection: ClientProjection, lastUpdated: Date) throws {
        saved.append(
            CachedRoomProjection(
                projection: try RoomProjection(serverProjection: projection).redacted(),
                lastUpdated: lastUpdated
            )
        )
    }

    func delete(code: String) throws {
        if remainingDeleteFailures > 0 {
            remainingDeleteFailures -= 1
            throw TestCleanupError.failed
        }
        deletions.append(code)
    }
    func savedProjections() -> [CachedRoomProjection] { saved }
    func deletedCodes() -> [String] { deletions }
}

private actor FakeRoomCredentialStore: RoomCredentialDeleting {
    private var remainingDeleteFailures: Int
    private var deletions: [String] = []

    init(deleteFailures: Int = 0) {
        remainingDeleteFailures = deleteFailures
    }

    func delete(code: String) throws {
        if remainingDeleteFailures > 0 {
            remainingDeleteFailures -= 1
            throw TestCleanupError.failed
        }
        deletions.append(code)
    }
    func deletedCodes() -> [String] { deletions }
}

private enum TestCleanupError: Error {
    case failed
}

private struct FixedRoomSessionClock: RoomSessionClock {
    let date: Date
    func now() -> Date { date }
}

private actor SequenceCommandIDGenerator: RoomCommandIDGenerating {
    private var ids: [UUID]

    init(ids: [UUID]) {
        self.ids = ids
    }

    func next() -> UUID {
        precondition(!ids.isEmpty, "Test requested more command IDs than provided")
        return ids.removeFirst()
    }
}

private final class CommandIDSuspensionGate: @unchecked Sendable {
    private let condition = NSCondition()
    private var suspended = false
    private var resumed = false

    var isSuspended: Bool {
        condition.withLock { suspended }
    }

    func suspend() {
        condition.lock()
        suspended = true
        condition.broadcast()
        while !resumed {
            condition.wait()
        }
        condition.unlock()
    }

    func resume() {
        condition.withLock {
            resumed = true
            condition.broadcast()
        }
    }
}

private actor SuspendedCommandIDGenerator: RoomCommandIDGenerating {
    private var ids: [UUID]
    private let suspendingRequest: Int
    private var requestCount = 0
    nonisolated private let gate = CommandIDSuspensionGate()

    init(ids: [UUID], suspendingRequest: Int) {
        self.ids = ids
        self.suspendingRequest = suspendingRequest
    }

    nonisolated var isSuspended: Bool { gate.isSuspended }

    nonisolated func resume() { gate.resume() }

    func next() -> UUID {
        precondition(!ids.isEmpty, "Test requested more command IDs than provided")
        requestCount += 1
        let id = ids.removeFirst()
        if requestCount == suspendingRequest {
            gate.suspend()
        }
        return id
    }
}

@MainActor
private func XCTAssertThrowsErrorAsync<T: Sendable>(
    _ expression: @autoclosure () async throws -> T,
    _ errorHandler: (Error) -> Void = { _ in }
) async {
    do {
        _ = try await expression()
        XCTFail("Expected expression to throw")
    } catch {
        errorHandler(error)
    }
}
