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
    func didEnterBackground() async
    func willEnterForeground()
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
    @ObservationIgnored private var activeSubmission: RoomCommandSubmission?
    @ObservationIgnored private var nextSubmissionToken: UInt64 = 0
    @ObservationIgnored private var sessionGeneration: UInt64 = 0
    private var projectionIsFresh = false
    @ObservationIgnored private var leaving = false

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
        markConnectionUncertain()
        await socket.didEnterBackground()
    }

    func willEnterForeground() async {
        if connectionState != .idle {
            connectionState = .connecting
            projectionIsFresh = false
            lastError = nil
        }
        await socket.willEnterForeground()
    }

    func leave() async {
        leaving = true
        sessionGeneration &+= 1
        activeSubmission = nil
        eventTask?.cancel()
        eventTask = nil
        await socket.close()

        var cleanupFailed = false
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

        connectionState = .idle
        projection = nil
        lastUpdated = nil
        pendingCommand = nil
        lastCommandResult = nil
        projectionIsFresh = false
        lastError = cleanupFailed ? .leaveCleanup : nil
        leaving = false
    }

    func randomizeTeams() async throws {
        try await send(.randomizeTeams, requiring: .configure)
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
        switch event {
        case .connecting:
            connectionState = .connecting
            projectionIsFresh = false
        case .open:
            connectionState = .connected
            projectionIsFresh = false
        case let .reconnecting(attempt, delay):
            connectionState = .reconnecting(attempt: attempt, delay: delay)
            markConnectionUncertain()
        case let .message(message):
            await receive(message)
        case let .terminalFailure(failure):
            connectionState = .failed(failure)
            markConnectionUncertain()
            lastError = .connection(failure)
        case let .closed(reason):
            connectionState = reason == .userInitiated ? .idle : .disconnected(reason)
            markConnectionUncertain()
        }
    }

    private func receive(_ message: ServerMessage) async {
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
        let roomProjection: RoomProjection
        do {
            roomProjection = try RoomProjection(serverProjection: serverProjection)
        } catch {
            lastError = .unsafeProjection
            return
        }
        guard serverProjection.base.code == code else {
            lastError = .unsafeProjection
            return
        }

        projection = roomProjection
        let updatedAt = clock.now()
        lastUpdated = updatedAt
        projectionIsFresh = true
        switch lastError {
        case .connection, .connectionLost:
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

    private func permission(for command: ClassicCommand) -> RoomCommandPermission {
        switch command {
        case .randomizeTeams, .assignSeat, .setRole, .lockRoom, .startBoard:
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
