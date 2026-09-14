import Foundation
import Observation

enum RoomConnectionState: Equatable, Sendable {
    case idle
    case connecting
    case connected
    case reconnecting(attempt: Int, delay: TimeInterval)
    case disconnected(RoomSocketCloseReason)
    case failed(RoomSocketFailure)
}

enum RoomCommandPermission: Equatable, Sendable {
    case configure
    case moderate
    case submitClue
    case challengeClue
    case nominate
    case confirmReveal
    case endTurn
    case resolveChallenge
    case pause
    case resume
}

enum PendingCommandDelivery: Equatable, Sendable {
    case awaitingResult
    case awaitingProjection(revision: Int)
    case unknownDelivery
    case retryAvailable
}

struct PendingRoomCommand: Equatable, Sendable {
    let envelope: CommandEnvelope
    var delivery: PendingCommandDelivery
    var result: CommandResult?

    var commandId: UUID { envelope.commandId }
    var command: ClassicCommand { envelope.command }
    var expectedRevision: Int { envelope.expectedRevision }
}

enum RoomSessionIntentError: Error, Equatable, Sendable, CustomStringConvertible {
    case noCurrentProjection
    case notConnected
    case permissionDenied(RoomCommandPermission)
    case commandInFlight
    case retryUnavailable
    case sendFailed

    var description: String {
        switch self {
        case .noCurrentProjection:
            return "No current room projection is available."
        case .notConnected:
            return "The room is not connected with a current projection."
        case .permissionDenied:
            return "This action is not allowed by the current room projection."
        case .commandInFlight:
            return "Another room action is still being reconciled."
        case .retryUnavailable:
            return "This room action is not ready to retry."
        case .sendFailed:
            return "The room action could not be sent."
        }
    }
}

enum RoomSessionError: Error, Equatable, Sendable {
    case connection(RoomSocketFailure)
    case connectionLost
    case commandRejected(code: CommandErrorCode, message: String)
    case server(code: ServerErrorCode, message: String)
    case unsafeProjection
    case cache
    case leaveCleanup
    case send
}

protocol RoomSessionSocket: Actor {
    func events() -> AsyncStream<RoomSocketEvent>
    func start()
    func close() async
    func didEnterBackground() async -> UInt64
    func willEnterForeground() -> UInt64
    func send(_ command: CommandEnvelope) async throws
}

extension RoomSocket: RoomSessionSocket {}

protocol RoomCredentialDeleting: Actor {
    func delete(code: String) throws
}

extension SeatCredentialStore: RoomCredentialDeleting {}

protocol RoomSessionClock: Sendable {
    func now() -> Date
}

struct SystemRoomSessionClock: RoomSessionClock {
    func now() -> Date { Date() }
}

protocol RoomCommandIDGenerating: Actor {
    func next() -> UUID
}

actor UUIDRoomCommandIDGenerator: RoomCommandIDGenerating {
    func next() -> UUID { UUID() }
}

private struct RoomCommandSubmission: Sendable {
    let token: UInt64
    let sessionGeneration: UInt64
    let command: ClassicCommand
    let permission: RoomCommandPermission
    let retryingCommandID: UUID?
}

@MainActor
@Observable
final class RoomSession {
    private(set) var connectionState: RoomConnectionState = .idle
    private(set) var projection: RoomProjection?
    private(set) var lastUpdated: Date?
    private(set) var pendingCommand: PendingRoomCommand?
    private(set) var lastCommandResult: CommandResult?
    private(set) var lastError: RoomSessionError?

    var isStale: Bool {
        projection != nil && !projectionIsFresh
    }

    @ObservationIgnored private let code: String
    @ObservationIgnored private let socket: any RoomSessionSocket
    @ObservationIgnored private let credentialStore: any RoomCredentialDeleting
    @ObservationIgnored private let cache: any ProjectionCaching
    @ObservationIgnored private let clock: any RoomSessionClock
    @ObservationIgnored private let commandIDGenerator: any RoomCommandIDGenerating
    @ObservationIgnored private var eventTask: Task<Void, Never>?
    private var activeSubmission: RoomCommandSubmission?
    @ObservationIgnored private var nextSubmissionToken: UInt64 = 0
    @ObservationIgnored private var sessionGeneration: UInt64 = 0
    @ObservationIgnored private var minimumSocketGeneration: UInt64 = 0
    @ObservationIgnored private var activeSocketGeneration: UInt64?
    @ObservationIgnored private var backgroundSocketGeneration: UInt64?
    @ObservationIgnored private var socketIsOpen = false
    @ObservationIgnored private var requiresForegroundOpen = false
    @ObservationIgnored private var hasObservedSocketLifecycle = false
    @ObservationIgnored private var initialConfigurationFailureEligible = true
    @ObservationIgnored private var terminalFailure: RoomSocketFailure?
    private var projectionIsFresh = false
    @ObservationIgnored private var leaving = false
    @ObservationIgnored private var isInBackground = false

    var hasPendingCommand: Bool { pendingCommand != nil || activeSubmission != nil }

    var canRetryPendingCommand: Bool {
        guard let pendingCommand, pendingCommand.delivery == .retryAvailable,
              activeSubmission == nil, connectionState == .connected, projectionIsFresh,
              let projection else { return false }
        return isAllowed(permission(for: pendingCommand.command), by: projection.base.permissions)
    }

    init(
        code: String,
        socket: any RoomSessionSocket,
        credentialStore: any RoomCredentialDeleting,
        cache: any ProjectionCaching = ProjectionCache(),
        clock: any RoomSessionClock = SystemRoomSessionClock(),
        commandIDGenerator: any RoomCommandIDGenerating = UUIDRoomCommandIDGenerator()
    ) {
        self.code = (try? RoomCode.normalizedAndValidated(code)) ?? code
        self.socket = socket
        self.credentialStore = credentialStore
        self.cache = cache
        self.clock = clock
        self.commandIDGenerator = commandIDGenerator
    }

    deinit {
        eventTask?.cancel()
    }

    func connect() async {
        guard eventTask == nil else { return }
        connectionState = .connecting
        projectionIsFresh = false
        do {
            if let cached = try await cache.load(code: code) {
                projection = cached.projection
                lastUpdated = cached.lastUpdated
            }
        } catch {
            lastError = .cache
        }

        let events = await socket.events()
        eventTask = Task { [weak self] in
            for await event in events {
                guard !Task.isCancelled else { return }
                await self?.receive(event)
            }
        }
        await socket.start()
    }

    func didEnterBackground() async {
        prepareForBackground()
        if case .failed = connectionState { return }
        let socketGeneration = await socket.didEnterBackground()
        minimumSocketGeneration = max(minimumSocketGeneration, socketGeneration)
    }

    // Called synchronously by the scene owner before any queued lifecycle work.
    func prepareForBackground() {
        sessionGeneration &+= 1
        isInBackground = true
        socketIsOpen = false
        requiresForegroundOpen = true
        hasObservedSocketLifecycle = true
        backgroundSocketGeneration = activeSocketGeneration
        if let activeSocketGeneration {
            minimumSocketGeneration = max(minimumSocketGeneration, activeSocketGeneration &+ 1)
        }
        markConnectionUncertain()
        projection = projection?.redacted()
    }

    func willEnterForeground() async {
        if case .failed = connectionState {
            isInBackground = false
            return
        }
        if connectionState != .idle {
            connectionState = .connecting
            projectionIsFresh = false
            lastError = nil
        }
        socketIsOpen = false
        let socketGeneration = await socket.willEnterForeground()
        // Keep the barrier closed while asking the transport to start. Any
        // queued events from before background are still delivered in order,
        // but cannot become current until this new generation opens.
        minimumSocketGeneration = max(minimumSocketGeneration, socketGeneration)
        activeSocketGeneration = nil
        isInBackground = false
    }

    /// Closes this session and optionally leaves code-scoped persistence for a
    /// newer session that has already rejoined the same room code.
    func leave(preservingPersistentState: Bool = false) async {
        leaving = true
        sessionGeneration &+= 1
        activeSubmission = nil
        eventTask?.cancel()
        eventTask = nil
        await socket.close()

        var cleanupFailed = false
        if !preservingPersistentState {
            do {
                try await cache.delete(code: code)
            } catch {
                cleanupFailed = true
            }
            do {
                try await credentialStore.delete(code: code)
            } catch {
                cleanupFailed = true
            }
        }

        connectionState = .idle
        projection = nil
        lastUpdated = nil
        pendingCommand = nil
        lastCommandResult = nil
        projectionIsFresh = false
        terminalFailure = nil
        lastError = cleanupFailed ? .leaveCleanup : nil
        leaving = false
    }

    func randomizeTeams() async throws {
        try await send(.randomizeTeams, requiring: .configure)
    }

    func setTeamCount(_ teamCount: TeamCount) async throws {
        try await send(.setTeamCount(teamCount: teamCount), requiring: .configure)
    }

    func assignSeat(playerId: String, teamId: TeamID?) async throws {
        try await send(.assignSeat(playerId: playerId, teamId: teamId), requiring: .configure)
    }

    func setRole(playerId: String, role: SeatRole) async throws {
        try await send(.setRole(playerId: playerId, role: role), requiring: .configure)
    }

    func lockRoom(_ locked: Bool) async throws {
        try await send(.lockRoom(locked: locked), requiring: .configure)
    }

    func startBoard() async throws {
        try await send(.startBoard, requiring: .configure)
    }

    func submitClue(word: String, count: Int) async throws {
        try await send(.submitClue(word: word, count: count), requiring: .submitClue)
    }

    func challengeClue() async throws {
        try await send(.challengeClue, requiring: .challengeClue)
    }

    func resolveChallenge(_ decision: ChallengeDecision) async throws {
        try await send(.resolveChallenge(decision: decision), requiring: .resolveChallenge)
    }

    func nominateCard(_ cardId: String) async throws {
        try await send(.nominateCard(cardId: cardId), requiring: .nominate)
    }

    func clearNomination() async throws {
        try await send(.clearNomination, requiring: .nominate)
    }

    func confirmReveal(_ cardId: String) async throws {
        try await send(.confirmReveal(cardId: cardId), requiring: .confirmReveal)
    }

    func endTurn() async throws {
        try await send(.endTurn, requiring: .endTurn)
    }

    func pause() async throws {
        try await send(.pauseRoom, requiring: .pause)
    }

    func resume() async throws {
        try await send(.resumeRoom, requiring: .resume)
    }

    func retryPendingCommand() async throws {
        guard let pendingCommand, pendingCommand.delivery == .retryAvailable else {
            throw RoomSessionIntentError.retryUnavailable
        }
        try await send(
            pendingCommand.command,
            requiring: permission(for: pendingCommand.command),
            retryingCommandID: pendingCommand.commandId
        )
    }

    func cancelPendingCommand() {
        guard let pendingCommand else { return }
        switch pendingCommand.delivery {
        case .unknownDelivery, .retryAvailable:
            clearPendingCommand()
        case .awaitingResult, .awaitingProjection:
            break
        }
    }

    private func send(
        _ command: ClassicCommand,
        requiring permission: RoomCommandPermission,
        retryingCommandID: UUID? = nil
    ) async throws {
        let submission = try reserveSubmission(
            command,
            requiring: permission,
            retryingCommandID: retryingCommandID
        )
        let commandID = await commandIDGenerator.next()

        let currentProjection: RoomProjection
        do {
            currentProjection = try validate(submission)
        } catch {
            if activeSubmission?.token == submission.token {
                activeSubmission = nil
            }
            throw error
        }
        activeSubmission = nil

        let envelope = CommandEnvelope(
            commandId: commandID,
            expectedRevision: currentProjection.revision,
            command: submission.command
        )
        pendingCommand = PendingRoomCommand(
            envelope: envelope,
            delivery: .awaitingResult,
            result: nil
        )
        lastCommandResult = nil
        lastError = nil

        do {
            try await socket.send(envelope)
        } catch let error as RoomSocketSendError {
            guard submission.sessionGeneration == sessionGeneration, !leaving else {
                throw RoomSessionIntentError.notConnected
            }
            guard pendingCommand?.commandId == commandID else {
                throw RoomSessionIntentError.sendFailed
            }
            switch error {
            case .transport:
                pendingCommand?.delivery = .unknownDelivery
                projectionIsFresh = false
                connectionState = .disconnected(.unavailablePath)
            case .notConnected, .encoding:
                clearPendingCommand()
            }
            lastError = .send
            throw RoomSessionIntentError.sendFailed
        } catch {
            guard submission.sessionGeneration == sessionGeneration, !leaving else {
                throw RoomSessionIntentError.notConnected
            }
            guard pendingCommand?.commandId == commandID else {
                throw RoomSessionIntentError.sendFailed
            }
            pendingCommand?.delivery = .unknownDelivery
            projectionIsFresh = false
            lastError = .send
            throw RoomSessionIntentError.sendFailed
        }
    }

    private func reserveSubmission(
        _ command: ClassicCommand,
        requiring permission: RoomCommandPermission,
        retryingCommandID: UUID?
    ) throws -> RoomCommandSubmission {
        guard activeSubmission == nil else {
            throw RoomSessionIntentError.commandInFlight
        }
        guard let projection else {
            throw RoomSessionIntentError.noCurrentProjection
        }
        guard connectionState == .connected, projectionIsFresh else {
            throw RoomSessionIntentError.notConnected
        }
        if let retryingCommandID {
            guard
                pendingCommand?.commandId == retryingCommandID,
                pendingCommand?.delivery == .retryAvailable
            else {
                throw RoomSessionIntentError.retryUnavailable
            }
        } else if pendingCommand != nil {
            throw RoomSessionIntentError.commandInFlight
        }
        guard isAllowed(permission, by: projection.base.permissions) else {
            throw RoomSessionIntentError.permissionDenied(permission)
        }

        nextSubmissionToken &+= 1
        let submission = RoomCommandSubmission(
            token: nextSubmissionToken,
            sessionGeneration: sessionGeneration,
            command: command,
            permission: permission,
            retryingCommandID: retryingCommandID
        )
        activeSubmission = submission
        return submission
    }

    private func validate(_ submission: RoomCommandSubmission) throws -> RoomProjection {
        guard submission.sessionGeneration == sessionGeneration, !leaving else {
            throw RoomSessionIntentError.notConnected
        }
        guard activeSubmission?.token == submission.token else {
            if submission.retryingCommandID != nil {
                throw RoomSessionIntentError.retryUnavailable
            }
            throw RoomSessionIntentError.commandInFlight
        }
        guard let projection else {
            throw RoomSessionIntentError.noCurrentProjection
        }
        guard connectionState == .connected, projectionIsFresh else {
            throw RoomSessionIntentError.notConnected
        }
        if let retryingCommandID = submission.retryingCommandID {
            guard
                pendingCommand?.commandId == retryingCommandID,
                pendingCommand?.delivery == .retryAvailable
            else {
                throw RoomSessionIntentError.retryUnavailable
            }
        } else if pendingCommand != nil {
            throw RoomSessionIntentError.commandInFlight
        }
        guard isAllowed(submission.permission, by: projection.base.permissions) else {
            throw RoomSessionIntentError.permissionDenied(submission.permission)
        }
        return projection
    }

    private func receive(_ event: RoomSocketEvent) async {
        guard !leaving else { return }
        guard terminalFailure == nil else { return }
        guard accepts(event) else { return }
        hasObservedSocketLifecycle = true
        switch event.kind {
        case .connecting:
            connectionState = .connecting
            projectionIsFresh = false
        case .open:
            initialConfigurationFailureEligible = false
            socketIsOpen = true
            requiresForegroundOpen = false
            backgroundSocketGeneration = nil
            if let eventGeneration = event.generation {
                // An accepted open establishes a new lower bound for tagged
                // events. This prevents a delayed terminal event from an
                // older socket from failing the newly opened session.
                minimumSocketGeneration = max(minimumSocketGeneration, eventGeneration)
                activeSocketGeneration = eventGeneration
            } else {
                // A generationless open comes only from legacy/test
                // transports. Treat it as a new untagged socket while
                // retaining a floor above any previously tagged socket.
                if let activeSocketGeneration {
                    minimumSocketGeneration = max(
                        minimumSocketGeneration,
                        activeSocketGeneration &+ 1
                    )
                }
                activeSocketGeneration = nil
            }
            connectionState = .connected
            projectionIsFresh = false
        case let .reconnecting(attempt, delay):
            socketIsOpen = false
            connectionState = .reconnecting(attempt: attempt, delay: delay)
            markConnectionUncertain()
        case let .message(message):
            await receive(message, socketGeneration: event.generation)
        case .incompatibleMessage:
            socketIsOpen = false
            markConnectionUncertain()
            lastError = .connection(.incompatibleResponse)
        case let .terminalFailure(failure):
            initialConfigurationFailureEligible = false
            terminalFailure = failure
            socketIsOpen = false
            connectionState = .failed(failure)
            markConnectionUncertain()
            lastError = .connection(failure)
        case let .closed(reason):
            guard terminalFailure == nil else { return }
            socketIsOpen = false
            connectionState = reason == .userInitiated ? .idle : .disconnected(reason)
            markConnectionUncertain()
        }
    }

    private func receive(_ message: ServerMessage, socketGeneration: UInt64?) async {
        guard socketIsOpen, !requiresForegroundOpen else { return }
        if let socketGeneration,
           activeSocketGeneration != socketGeneration {
            return
        }
        switch message {
        case let .projection(serverProjection):
            await receive(serverProjection)
        case let .commandResult(commandId, result):
            receive(commandId: commandId, result: result)
        case let .error(code, message):
            lastError = .server(code: code, message: message)
        }
    }

    private func receive(_ serverProjection: ClientProjection) async {
        guard !isInBackground else { return }
        let roomProjection: RoomProjection
        do {
            roomProjection = try RoomProjection(serverProjection: serverProjection)
        } catch {
            markConnectionUncertain()
            lastError = .unsafeProjection
            return
        }
        guard serverProjection.base.code == code else {
            markConnectionUncertain()
            lastError = .unsafeProjection
            return
        }

        projection = roomProjection
        let updatedAt = clock.now()
        lastUpdated = updatedAt
        projectionIsFresh = true
        switch lastError {
        case .connection, .connectionLost, .unsafeProjection:
            lastError = nil
        default:
            break
        }
        do {
            try await cache.save(serverProjection, lastUpdated: updatedAt)
            if lastError == .cache {
                lastError = nil
            }
        } catch {
            lastError = .cache
        }
        reconcilePendingAgainstProjection()
    }

    private func receive(commandId: UUID, result: CommandResult) {
        guard var pending = pendingCommand, pending.commandId == commandId else { return }
        pending.result = result
        lastCommandResult = result
        if case let .failure(_, code, message) = result {
            lastError = .commandRejected(code: code, message: message)
        }
        pendingCommand = pending
        reconcilePendingAgainstProjection()
    }

    private func reconcilePendingAgainstProjection() {
        guard var pending = pendingCommand, let projection else { return }
        guard let result = pending.result else {
            if pending.delivery == .unknownDelivery && projectionIsFresh {
                pending.delivery = .retryAvailable
                pendingCommand = pending
            }
            return
        }

        let resultRevision: Int
        let isStaleFailure: Bool
        switch result {
        case let .success(revision):
            resultRevision = revision
            isStaleFailure = false
        case let .failure(revision, code, _):
            resultRevision = revision
            isStaleFailure = code == .staleRevision
        }

        guard projection.revision >= resultRevision, projectionIsFresh else {
            pending.delivery = .awaitingProjection(revision: resultRevision)
            pendingCommand = pending
            return
        }
        if isStaleFailure {
            pending.delivery = .retryAvailable
            pendingCommand = pending
        } else {
            clearPendingCommand()
        }
    }

    private func clearPendingCommand() {
        guard let pendingCommand else { return }
        if activeSubmission?.retryingCommandID == pendingCommand.commandId {
            activeSubmission = nil
        }
        self.pendingCommand = nil
    }

    private func markConnectionUncertain() {
        projectionIsFresh = false
        guard var pending = pendingCommand, pending.result == nil else { return }
        pending.delivery = .unknownDelivery
        pendingCommand = pending
        if lastError == nil {
            lastError = .connectionLost
        }
    }

    private func accepts(_ event: RoomSocketEvent) -> Bool {
        // A terminal failure can be queued by the active transport just as
        // the scene enters the background. Preserve it when it belongs to
        // the active/pre-background socket, but never let an older socket
        // fail a newer open. The initial configuration failure is the one
        // intentional generationless terminal event from RoomSocket.start.
        if case let .terminalFailure(failure) = event.kind {
            return acceptsTerminalFailure(failure, generation: event.generation)
        }

        if isInBackground {
            // A transport close is still useful while the scene is covered:
            // it records the connection transition without allowing a queued
            // socket open or message to restore usable state. Terminal
            // failures are handled above so they cannot be lost.
            guard case .closed = event.kind else { return false }
        }

        if let eventGeneration = event.generation {
            guard eventGeneration >= minimumSocketGeneration else { return false }
            switch event.kind {
            case .open:
                return true
            case .message:
                return socketIsOpen && activeSocketGeneration == eventGeneration
            case .connecting, .reconnecting, .incompatibleMessage, .terminalFailure, .closed:
                // Connection lifecycle events can be emitted before an open
                // event (for example, a terminal ticket failure). A newer
                // generation may replace the active one, but an older
                // generation must never change current state.
                guard let activeSocketGeneration else { return true }
                return eventGeneration >= activeSocketGeneration
            }
        }

        // Legacy/test transports do not expose a generation. They still pass
        // through the same foreground barrier by requiring an explicit open
        // event before messages can update projection state.
        switch event.kind {
        case .connecting:
            return true
        case .open:
            return !requiresForegroundOpen
        case .terminalFailure, .closed, .reconnecting, .incompatibleMessage:
            return true
        case .message:
            return socketIsOpen && !requiresForegroundOpen
        }
    }

    private func acceptsTerminalFailure(
        _ failure: RoomSocketFailure,
        generation eventGeneration: UInt64?
    ) -> Bool {
        guard let eventGeneration else {
            if failure == .configuration {
                return initialConfigurationFailureEligible
            }
            return !hasObservedSocketLifecycle && !isInBackground && !requiresForegroundOpen
        }

        if let backgroundSocketGeneration,
           eventGeneration == backgroundSocketGeneration {
            return true
        }

        // The active open is always a valid terminal source. Future tagged
        // generations can also report a terminal failure before they emit an
        // open event, but any generation below either floor is stale.
        let activeFloor = activeSocketGeneration ?? 0
        return eventGeneration >= max(minimumSocketGeneration, activeFloor)
    }

    private func permission(for command: ClassicCommand) -> RoomCommandPermission {
        switch command {
        case .randomizeTeams, .setTeamCount, .assignSeat, .setRole, .lockRoom, .startBoard:
            return .configure
        case .submitClue:
            return .submitClue
        case .challengeClue:
            return .challengeClue
        case .resolveChallenge:
            return .resolveChallenge
        case .nominateCard, .clearNomination:
            return .nominate
        case .confirmReveal:
            return .confirmReveal
        case .endTurn:
            return .endTurn
        case .pauseRoom:
            return .pause
        case .resumeRoom:
            return .resume
        }
    }

    private func isAllowed(
        _ permission: RoomCommandPermission,
        by permissions: ProjectionPermissions
    ) -> Bool {
        switch permission {
        case .configure: return permissions.configure
        case .moderate: return permissions.moderate
        case .submitClue: return permissions.submitClue
        case .challengeClue: return permissions.challengeClue
        case .nominate: return permissions.nominate
        case .confirmReveal: return permissions.confirmReveal
        case .endTurn: return permissions.endTurn
        case .resolveChallenge: return permissions.resolveChallenge
        case .pause: return permissions.pause
        case .resume: return permissions.resume
        }
    }
}
