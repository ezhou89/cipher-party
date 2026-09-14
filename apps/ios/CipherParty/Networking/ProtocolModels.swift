import Foundation

enum ProtocolDecodingError: Error, Equatable, Sendable, CustomStringConvertible {
    case unsupportedDiscriminator(field: String, value: String)
    case unsupportedProtocolVersion(Int)
    case hiddenKeyInUnauthorizedProjection(role: SeatRole)
    case publicHistoryLimitExceeded(actual: Int, maximum: Int)

    var description: String {
        switch self {
        case let .unsupportedDiscriminator(field, value):
            return "Unsupported protocol value for \(field): \(value)"
        case let .unsupportedProtocolVersion(version):
            return "Unsupported protocol version: \(version)"
        case let .hiddenKeyInUnauthorizedProjection(role):
            return "Hidden key is not allowed for \(role.rawValue) projections"
        case let .publicHistoryLimitExceeded(actual, maximum):
            return "Public history contains \(actual) entries; maximum is \(maximum)"
        }
    }
}

protocol StrictProtocolString: RawRepresentable, Codable, Sendable
where RawValue == String {
    static var protocolField: String { get }
}

extension StrictProtocolString {
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        guard let value = Self(rawValue: rawValue) else {
            throw ProtocolDecodingError.unsupportedDiscriminator(
                field: Self.protocolField,
                value: rawValue
            )
        }
        self = value
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

enum TeamID: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
    case red
    case blue

    static let protocolField = "teamId"
}

enum SeatRole: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
    case unassigned
    case clueGiver = "clue-giver"
    case operative
    case spectator

    static let protocolField = "role"
}

enum RoomPhase: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
    case lobby
    case playing
    case complete

    static let protocolField = "roomPhase"
}

enum PlayPhase: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
    case clue
    case guess
    case challenged
    case paused
    case boardComplete = "board_complete"

    static let protocolField = "phase"
}

enum Ownership: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
    case red
    case blue
    case neutral
    case hazard

    static let protocolField = "owner"
}

enum CompletionReason: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
    case targets
    case hazard

    static let protocolField = "completionReason"
}

enum ChallengeDecision: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
    case accept
    case reject

    static let protocolField = "decision"
}

struct SeatSummary: Codable, Equatable, Sendable {
    let playerId: String
    let displayName: String
    let teamId: TeamID?
    let role: SeatRole
    let connected: Bool

    private enum CodingKeys: String, CodingKey {
        case playerId
        case displayName
        case teamId
        case role
        case connected
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(playerId, forKey: .playerId)
        try container.encode(displayName, forKey: .displayName)
        if let teamId {
            try container.encode(teamId, forKey: .teamId)
        } else {
            try container.encodeNil(forKey: .teamId)
        }
        try container.encode(role, forKey: .role)
        try container.encode(connected, forKey: .connected)
    }
}

struct ViewerContext: Codable, Equatable, Sendable {
    let playerId: String
    let teamId: TeamID?
    let role: SeatRole
    let isHost: Bool

    private enum CodingKeys: String, CodingKey {
        case playerId
        case teamId
        case role
        case isHost
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(playerId, forKey: .playerId)
        if let teamId {
            try container.encode(teamId, forKey: .teamId)
        } else {
            try container.encodeNil(forKey: .teamId)
        }
        try container.encode(role, forKey: .role)
        try container.encode(isHost, forKey: .isHost)
    }
}

struct ProjectionPermissions: Codable, Equatable, Sendable {
    let configure: Bool
    let moderate: Bool
    let submitClue: Bool
    let challengeClue: Bool
    let nominate: Bool
    let confirmReveal: Bool
    let endTurn: Bool
    let resolveChallenge: Bool
    let pause: Bool
    let resume: Bool
}

struct PublicCard: Codable, Equatable, Sendable {
    let id: String
    let label: String
    let revealed: Bool
    let owner: Ownership?
}

struct Clue: Codable, Equatable, Sendable {
    let word: String
    let count: Int
}

struct Nomination: Codable, Equatable, Sendable {
    let playerId: String
    let cardId: String
}

struct PublicBoardProjection: Codable, Equatable, Sendable {
    let order: [String]
    let cards: [PublicCard]
    let activeTeam: TeamID
    let phase: PlayPhase
    let clue: Clue?
    let guessesRemaining: Int
    let nomination: Nomination?
    let winner: TeamID?
    let completionReason: CompletionReason?

    private enum CodingKeys: String, CodingKey {
        case order
        case cards
        case activeTeam
        case phase
        case clue
        case guessesRemaining
        case nomination
        case winner
        case completionReason
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(order, forKey: .order)
        try container.encode(cards, forKey: .cards)
        try container.encode(activeTeam, forKey: .activeTeam)
        try container.encode(phase, forKey: .phase)
        if let clue {
            try container.encode(clue, forKey: .clue)
        } else {
            try container.encodeNil(forKey: .clue)
        }
        try container.encode(guessesRemaining, forKey: .guessesRemaining)
        if let nomination {
            try container.encode(nomination, forKey: .nomination)
        } else {
            try container.encodeNil(forKey: .nomination)
        }
        if let winner {
            try container.encode(winner, forKey: .winner)
        } else {
            try container.encodeNil(forKey: .winner)
        }
        if let completionReason {
            try container.encode(completionReason, forKey: .completionReason)
        } else {
            try container.encodeNil(forKey: .completionReason)
        }
    }
}

enum PublicHistoryEntry: Codable, Equatable, Sendable {
    enum EntryType: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
        case clueSubmitted = "clue_submitted"
        case clueChallenged = "clue_challenged"
        case challengeResolved = "challenge_resolved"
        case cardRevealed = "card_revealed"
        case turnEnded = "turn_ended"
        case roomPaused = "room_paused"
        case roomResumed = "room_resumed"

        static let protocolField = "type"
    }

    case clueSubmitted(revision: Int, at: String, teamId: TeamID, word: String, count: Int)
    case clueChallenged(revision: Int, at: String, teamId: TeamID)
    case challengeResolved(revision: Int, at: String, decision: ChallengeDecision)
    case cardRevealed(revision: Int, at: String, teamId: TeamID, cardId: String, owner: Ownership)
    case turnEnded(revision: Int, at: String, teamId: TeamID)
    case roomPaused(revision: Int, at: String)
    case roomResumed(revision: Int, at: String)

    private enum CodingKeys: String, CodingKey {
        case revision
        case at
        case type
        case teamId
        case word
        case count
        case decision
        case cardId
        case owner
    }

    var type: EntryType {
        switch self {
        case .clueSubmitted: return .clueSubmitted
        case .clueChallenged: return .clueChallenged
        case .challengeResolved: return .challengeResolved
        case .cardRevealed: return .cardRevealed
        case .turnEnded: return .turnEnded
        case .roomPaused: return .roomPaused
        case .roomResumed: return .roomResumed
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(EntryType.self, forKey: .type)
        let revision = try container.decode(Int.self, forKey: .revision)
        let at = try container.decode(String.self, forKey: .at)

        switch type {
        case .clueSubmitted:
            self = try .clueSubmitted(
                revision: revision,
                at: at,
                teamId: container.decode(TeamID.self, forKey: .teamId),
                word: container.decode(String.self, forKey: .word),
                count: container.decode(Int.self, forKey: .count)
            )
        case .clueChallenged:
            self = try .clueChallenged(
                revision: revision,
                at: at,
                teamId: container.decode(TeamID.self, forKey: .teamId)
            )
        case .challengeResolved:
            self = try .challengeResolved(
                revision: revision,
                at: at,
                decision: container.decode(ChallengeDecision.self, forKey: .decision)
            )
        case .cardRevealed:
            self = try .cardRevealed(
                revision: revision,
                at: at,
                teamId: container.decode(TeamID.self, forKey: .teamId),
                cardId: container.decode(String.self, forKey: .cardId),
                owner: container.decode(Ownership.self, forKey: .owner)
            )
        case .turnEnded:
            self = try .turnEnded(
                revision: revision,
                at: at,
                teamId: container.decode(TeamID.self, forKey: .teamId)
            )
        case .roomPaused:
            self = .roomPaused(revision: revision, at: at)
        case .roomResumed:
            self = .roomResumed(revision: revision, at: at)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case let .clueSubmitted(revision, at, teamId, word, count):
            try container.encode(EntryType.clueSubmitted, forKey: .type)
            try container.encode(revision, forKey: .revision)
            try container.encode(at, forKey: .at)
            try container.encode(teamId, forKey: .teamId)
            try container.encode(word, forKey: .word)
            try container.encode(count, forKey: .count)
        case let .clueChallenged(revision, at, teamId):
            try container.encode(EntryType.clueChallenged, forKey: .type)
            try container.encode(revision, forKey: .revision)
            try container.encode(at, forKey: .at)
            try container.encode(teamId, forKey: .teamId)
        case let .challengeResolved(revision, at, decision):
            try container.encode(EntryType.challengeResolved, forKey: .type)
            try container.encode(revision, forKey: .revision)
            try container.encode(at, forKey: .at)
            try container.encode(decision, forKey: .decision)
        case let .cardRevealed(revision, at, teamId, cardId, owner):
            try container.encode(EntryType.cardRevealed, forKey: .type)
            try container.encode(revision, forKey: .revision)
            try container.encode(at, forKey: .at)
            try container.encode(teamId, forKey: .teamId)
            try container.encode(cardId, forKey: .cardId)
            try container.encode(owner, forKey: .owner)
        case let .turnEnded(revision, at, teamId):
            try container.encode(EntryType.turnEnded, forKey: .type)
            try container.encode(revision, forKey: .revision)
            try container.encode(at, forKey: .at)
            try container.encode(teamId, forKey: .teamId)
        case let .roomPaused(revision, at):
            try container.encode(EntryType.roomPaused, forKey: .type)
            try container.encode(revision, forKey: .revision)
            try container.encode(at, forKey: .at)
        case let .roomResumed(revision, at):
            try container.encode(EntryType.roomResumed, forKey: .type)
            try container.encode(revision, forKey: .revision)
            try container.encode(at, forKey: .at)
        }
    }
}

struct ProjectionBase: Codable, Equatable, Sendable {
    static let maximumPublicHistoryEntries = 100

    let protocolVersion: Int
    let revision: Int
    let code: String
    let inviteUrl: String
    let roomPhase: RoomPhase
    let locked: Bool
    let viewer: ViewerContext
    let permissions: ProjectionPermissions
    let seats: [SeatSummary]
    let publicHistory: [PublicHistoryEntry]
    let board: PublicBoardProjection?

    private enum CodingKeys: String, CodingKey {
        case protocolVersion
        case revision
        case code
        case inviteUrl
        case roomPhase
        case locked
        case viewer
        case permissions
        case seats
        case publicHistory
        case board
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .protocolVersion)
        guard version == 1 else {
            throw ProtocolDecodingError.unsupportedProtocolVersion(version)
        }

        let history = try container.decode([PublicHistoryEntry].self, forKey: .publicHistory)
        guard history.count <= Self.maximumPublicHistoryEntries else {
            throw ProtocolDecodingError.publicHistoryLimitExceeded(
                actual: history.count,
                maximum: Self.maximumPublicHistoryEntries
            )
        }

        protocolVersion = version
        revision = try container.decode(Int.self, forKey: .revision)
        code = try container.decode(String.self, forKey: .code)
        inviteUrl = try container.decode(String.self, forKey: .inviteUrl)
        roomPhase = try container.decode(RoomPhase.self, forKey: .roomPhase)
        locked = try container.decode(Bool.self, forKey: .locked)
        viewer = try container.decode(ViewerContext.self, forKey: .viewer)
        permissions = try container.decode(ProjectionPermissions.self, forKey: .permissions)
        seats = try container.decode([SeatSummary].self, forKey: .seats)
        publicHistory = history
        board = try container.decodeIfPresent(PublicBoardProjection.self, forKey: .board)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(revision, forKey: .revision)
        try container.encode(code, forKey: .code)
        try container.encode(inviteUrl, forKey: .inviteUrl)
        try container.encode(roomPhase, forKey: .roomPhase)
        try container.encode(locked, forKey: .locked)
        try container.encode(viewer, forKey: .viewer)
        try container.encode(permissions, forKey: .permissions)
        try container.encode(seats, forKey: .seats)
        try container.encode(publicHistory, forKey: .publicHistory)
        if let board {
            try container.encode(board, forKey: .board)
        } else {
            try container.encodeNil(forKey: .board)
        }
    }
}

enum ClientProjection: Codable, Equatable, Sendable {
    case operative(ProjectionBase)
    case clueGiver(base: ProjectionBase, key: [String: Ownership])
    case spectator(ProjectionBase)
    case unassigned(ProjectionBase)

    private enum CodingKeys: String, CodingKey {
        case viewRole
        case key
    }

    var base: ProjectionBase {
        switch self {
        case let .operative(base), let .spectator(base), let .unassigned(base):
            return base
        case let .clueGiver(base, _):
            return base
        }
    }

    var viewRole: SeatRole {
        switch self {
        case .operative:
            return .operative
        case .clueGiver:
            return .clueGiver
        case .spectator:
            return .spectator
        case .unassigned:
            return .unassigned
        }
    }

    var key: [String: Ownership]? {
        guard case let .clueGiver(_, key) = self else { return nil }
        return key
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rawRole = try container.decode(String.self, forKey: .viewRole)
        guard let role = SeatRole(rawValue: rawRole) else {
            throw ProtocolDecodingError.unsupportedDiscriminator(
                field: "viewRole",
                value: rawRole
            )
        }

        let base = try ProjectionBase(from: decoder)
        switch role {
        case .operative:
            try Self.rejectHiddenKey(in: container, role: role)
            self = .operative(base)
        case .clueGiver:
            self = try .clueGiver(
                base: base,
                key: container.decode([String: Ownership].self, forKey: .key)
            )
        case .spectator:
            try Self.rejectHiddenKey(in: container, role: role)
            self = .spectator(base)
        case .unassigned:
            try Self.rejectHiddenKey(in: container, role: role)
            self = .unassigned(base)
        }
    }

    func encode(to encoder: Encoder) throws {
        try base.encode(to: encoder)
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(viewRole.rawValue, forKey: .viewRole)
        if let key {
            try container.encode(key, forKey: .key)
        }
    }

    private static func rejectHiddenKey(
        in container: KeyedDecodingContainer<CodingKeys>,
        role: SeatRole
    ) throws {
        if container.contains(.key) {
            throw ProtocolDecodingError.hiddenKeyInUnauthorizedProjection(role: role)
        }
    }
}

enum ClassicCommand: Codable, Equatable, Sendable {
    enum CommandType: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
        case randomizeTeams = "randomize_teams"
        case assignSeat = "assign_seat"
        case setRole = "set_role"
        case lockRoom = "lock_room"
        case startBoard = "start_board"
        case submitClue = "submit_clue"
        case challengeClue = "challenge_clue"
        case resolveChallenge = "resolve_challenge"
        case nominateCard = "nominate_card"
        case clearNomination = "clear_nomination"
        case confirmReveal = "confirm_reveal"
        case endTurn = "end_turn"
        case pauseRoom = "pause_room"
        case resumeRoom = "resume_room"

        static let protocolField = "type"
    }

    case randomizeTeams
    case assignSeat(playerId: String, teamId: TeamID?)
    case setRole(playerId: String, role: SeatRole)
    case lockRoom(locked: Bool)
    case startBoard
    case submitClue(word: String, count: Int)
    case challengeClue
    case resolveChallenge(decision: ChallengeDecision)
    case nominateCard(cardId: String)
    case clearNomination
    case confirmReveal(cardId: String)
    case endTurn
    case pauseRoom
    case resumeRoom

    private enum CodingKeys: String, CodingKey {
        case type
        case playerId
        case teamId
        case role
        case locked
        case word
        case count
        case decision
        case cardId
    }

    var type: CommandType {
        switch self {
        case .randomizeTeams: return .randomizeTeams
        case .assignSeat: return .assignSeat
        case .setRole: return .setRole
        case .lockRoom: return .lockRoom
        case .startBoard: return .startBoard
        case .submitClue: return .submitClue
        case .challengeClue: return .challengeClue
        case .resolveChallenge: return .resolveChallenge
        case .nominateCard: return .nominateCard
        case .clearNomination: return .clearNomination
        case .confirmReveal: return .confirmReveal
        case .endTurn: return .endTurn
        case .pauseRoom: return .pauseRoom
        case .resumeRoom: return .resumeRoom
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(CommandType.self, forKey: .type) {
        case .randomizeTeams:
            self = .randomizeTeams
        case .assignSeat:
            self = try .assignSeat(
                playerId: container.decode(String.self, forKey: .playerId),
                teamId: container.decodeIfPresent(TeamID.self, forKey: .teamId)
            )
        case .setRole:
            self = try .setRole(
                playerId: container.decode(String.self, forKey: .playerId),
                role: container.decode(SeatRole.self, forKey: .role)
            )
        case .lockRoom:
            self = try .lockRoom(locked: container.decode(Bool.self, forKey: .locked))
        case .startBoard:
            self = .startBoard
        case .submitClue:
            self = try .submitClue(
                word: container.decode(String.self, forKey: .word),
                count: container.decode(Int.self, forKey: .count)
            )
        case .challengeClue:
            self = .challengeClue
        case .resolveChallenge:
            self = try .resolveChallenge(
                decision: container.decode(ChallengeDecision.self, forKey: .decision)
            )
        case .nominateCard:
            self = try .nominateCard(cardId: container.decode(String.self, forKey: .cardId))
        case .clearNomination:
            self = .clearNomination
        case .confirmReveal:
            self = try .confirmReveal(cardId: container.decode(String.self, forKey: .cardId))
        case .endTurn:
            self = .endTurn
        case .pauseRoom:
            self = .pauseRoom
        case .resumeRoom:
            self = .resumeRoom
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)

        switch self {
        case let .assignSeat(playerId, teamId):
            try container.encode(playerId, forKey: .playerId)
            try container.encodeIfPresent(teamId, forKey: .teamId)
            if teamId == nil {
                try container.encodeNil(forKey: .teamId)
            }
        case let .setRole(playerId, role):
            try container.encode(playerId, forKey: .playerId)
            try container.encode(role, forKey: .role)
        case let .lockRoom(locked):
            try container.encode(locked, forKey: .locked)
        case let .submitClue(word, count):
            try container.encode(word, forKey: .word)
            try container.encode(count, forKey: .count)
        case let .resolveChallenge(decision):
            try container.encode(decision, forKey: .decision)
        case let .nominateCard(cardId), let .confirmReveal(cardId):
            try container.encode(cardId, forKey: .cardId)
        case .randomizeTeams,
             .startBoard,
             .challengeClue,
             .clearNomination,
             .endTurn,
             .pauseRoom,
             .resumeRoom:
            break
        }
    }
}

struct CommandEnvelope: Codable, Equatable, Sendable {
    let protocolVersion: Int
    let commandId: UUID
    let expectedRevision: Int
    let command: ClassicCommand

    init(
        commandId: UUID,
        expectedRevision: Int,
        command: ClassicCommand
    ) {
        protocolVersion = 1
        self.commandId = commandId
        self.expectedRevision = expectedRevision
        self.command = command
    }

    private enum CodingKeys: String, CodingKey {
        case protocolVersion
        case commandId
        case expectedRevision
        case command
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .protocolVersion)
        guard version == 1 else {
            throw ProtocolDecodingError.unsupportedProtocolVersion(version)
        }
        protocolVersion = version
        commandId = try container.decode(UUID.self, forKey: .commandId)
        expectedRevision = try container.decode(Int.self, forKey: .expectedRevision)
        command = try container.decode(ClassicCommand.self, forKey: .command)
    }
}

enum CommandErrorCode: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
    case invalidCommand = "invalid_command"
    case unauthorized
    case wrongPhase = "wrong_phase"
    case staleRevision = "stale_revision"
    case storageFailed = "storage_failed"
    case roomLocked = "room_locked"
    case roomFull = "room_full"

    static let protocolField = "code"
}

enum CommandResult: Codable, Equatable, Sendable {
    case success(revision: Int)
    case failure(revision: Int, code: CommandErrorCode, message: String)

    private enum CodingKeys: String, CodingKey {
        case ok
        case revision
        case code
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let revision = try container.decode(Int.self, forKey: .revision)
        if try container.decode(Bool.self, forKey: .ok) {
            self = .success(revision: revision)
        } else {
            self = try .failure(
                revision: revision,
                code: container.decode(CommandErrorCode.self, forKey: .code),
                message: container.decode(String.self, forKey: .message)
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .success(revision):
            try container.encode(true, forKey: .ok)
            try container.encode(revision, forKey: .revision)
        case let .failure(revision, code, message):
            try container.encode(false, forKey: .ok)
            try container.encode(revision, forKey: .revision)
            try container.encode(code, forKey: .code)
            try container.encode(message, forKey: .message)
        }
    }
}

enum ServerErrorCode: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
    case invalidMessage = "invalid_message"
    case ticketExpired = "ticket_expired"
    case internalError = "internal_error"

    static let protocolField = "code"
}

enum ServerMessage: Codable, Equatable, Sendable {
    private enum MessageType: String, CaseIterable, Equatable, Hashable, Sendable, StrictProtocolString {
        case projection
        case commandResult = "command_result"
        case error

        static let protocolField = "type"
    }

    case projection(ClientProjection)
    case commandResult(commandId: UUID, result: CommandResult)
    case error(code: ServerErrorCode, message: String)

    private enum CodingKeys: String, CodingKey {
        case type
        case projection
        case commandId
        case result
        case code
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(MessageType.self, forKey: .type) {
        case .projection:
            self = try .projection(container.decode(ClientProjection.self, forKey: .projection))
        case .commandResult:
            self = try .commandResult(
                commandId: container.decode(UUID.self, forKey: .commandId),
                result: container.decode(CommandResult.self, forKey: .result)
            )
        case .error:
            self = try .error(
                code: container.decode(ServerErrorCode.self, forKey: .code),
                message: container.decode(String.self, forKey: .message)
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .projection(projection):
            try container.encode(MessageType.projection, forKey: .type)
            try container.encode(projection, forKey: .projection)
        case let .commandResult(commandId, result):
            try container.encode(MessageType.commandResult, forKey: .type)
            try container.encode(commandId, forKey: .commandId)
            try container.encode(result, forKey: .result)
        case let .error(code, message):
            try container.encode(MessageType.error, forKey: .type)
            try container.encode(code, forKey: .code)
            try container.encode(message, forKey: .message)
        }
    }

    var commandErrorCode: CommandErrorCode? {
        guard case let .commandResult(_, .failure(_, code, _)) = self else { return nil }
        return code
    }

    var commandRevision: Int? {
        guard case let .commandResult(_, result) = self else { return nil }
        switch result {
        case let .success(revision), let .failure(revision, _, _):
            return revision
        }
    }

    var commandSucceeded: Bool {
        guard case .commandResult(_, .success) = self else { return false }
        return true
    }

    var serverErrorCode: ServerErrorCode? {
        guard case let .error(code, _) = self else { return nil }
        return code
    }
}
