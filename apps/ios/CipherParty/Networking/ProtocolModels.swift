import Foundation

enum ProtocolDecodingError: Error, Equatable, Sendable, CustomStringConvertible {
    case unsupportedDiscriminator(field: String, value: String)
    case unsupportedProtocolVersion(Int)
    case hiddenKeyInUnauthorizedProjection(role: SeatRole)
    case publicHistoryLimitExceeded(actual: Int, maximum: Int)
    case missingRequiredField(String)
    case unexpectedFields([String])
    case invalidValue(field: String, constraint: String)

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
        case let .missingRequiredField(field):
            return "Missing required protocol field: \(field)"
        case let .unexpectedFields(fields):
            return "Unexpected protocol fields: \(fields.joined(separator: ", "))"
        case let .invalidValue(field, constraint):
            return "Invalid protocol value for \(field): expected \(constraint)"
        }
    }
}

private struct ProtocolCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

private extension Decoder {
    func validateProtocolKeys<Key>(
        _: Key.Type,
        allowed: [Key]? = nil,
        required: [Key]? = nil
    ) throws where Key: CodingKey & CaseIterable {
        let container = try container(keyedBy: ProtocolCodingKey.self)
        let allowedKeys = allowed ?? Array(Key.allCases)
        let allowedNames = Set(allowedKeys.map(\.stringValue))
        let actualNames = Set(container.allKeys.map(\.stringValue))
        let unexpected = actualNames.subtracting(allowedNames).sorted()
        guard unexpected.isEmpty else {
            throw ProtocolDecodingError.unexpectedFields(unexpected)
        }

        let requiredNames = Set((required ?? allowedKeys).map(\.stringValue))
        if let missing = requiredNames.subtracting(actualNames).sorted().first {
            throw ProtocolDecodingError.missingRequiredField(missing)
        }
    }

    func requireProtocolKeys<Key>(_ required: [Key]) throws where Key: CodingKey {
        let container = try container(keyedBy: ProtocolCodingKey.self)
        let actualNames = Set(container.allKeys.map(\.stringValue))
        let requiredNames = Set(required.map(\.stringValue))
        if let missing = requiredNames.subtracting(actualNames).sorted().first {
            throw ProtocolDecodingError.missingRequiredField(missing)
        }
    }
}

private extension KeyedDecodingContainer {
    func decodeRequiredNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else {
            throw ProtocolDecodingError.missingRequiredField(key.stringValue)
        }
        if try decodeNil(forKey: key) {
            return nil
        }
        return try decode(type, forKey: key)
    }

    func decodeOptionalNonNull<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else { return nil }
        guard try !decodeNil(forKey: key) else {
            throw ProtocolDecodingError.invalidValue(
                field: key.stringValue,
                constraint: "a non-null value when present"
            )
        }
        return try decode(type, forKey: key)
    }
}

private func requireNonEmpty(_ value: String, field: String) throws -> String {
    guard !value.isEmpty else {
        throw ProtocolDecodingError.invalidValue(field: field, constraint: "a non-empty string")
    }
    return value
}

private func requireNonnegative(_ value: Int, field: String) throws -> Int {
    guard value >= 0 else {
        throw ProtocolDecodingError.invalidValue(field: field, constraint: "a nonnegative integer")
    }
    return value
}

private func requireRange(
    _ value: Int,
    field: String,
    minimum: Int,
    maximum: Int? = nil
) throws -> Int {
    let inRange = value >= minimum && (maximum.map { value <= $0 } ?? true)
    guard inRange else {
        let constraint = maximum.map { "an integer from \(minimum) through \($0)" }
            ?? "an integer of at least \(minimum)"
        throw ProtocolDecodingError.invalidValue(field: field, constraint: constraint)
    }
    return value
}

private func expectedTeams(for teamCount: TeamCount) -> [TeamID] {
    Array(TeamID.allCases.prefix(teamCount.rawValue))
}

private func boardGeometry(for teamCount: TeamCount) -> (rows: Int, columns: Int, cardCount: Int) {
    switch teamCount {
    case .two:
        return (5, 5, 25)
    case .three:
        return (5, 6, 30)
    case .four:
        return (6, 6, 36)
    }
}

private func requireUniqueStrings(_ values: [String], field: String) throws {
    guard Set(values).count == values.count else {
        throw ProtocolDecodingError.invalidValue(field: field, constraint: "unique values")
    }
}

private func requireConfiguredTeams(_ values: [TeamID], teamCount: TeamCount, field: String) throws {
    let expected = expectedTeams(for: teamCount)
    guard values == expected else {
        throw ProtocolDecodingError.invalidValue(
            field: field,
            constraint: "the ordered red/blue/green/yellow prefix matching teamCount"
        )
    }
}

private func validatePublicBoard(
    _ board: PublicBoardProjection,
    projectionTeamCount: TeamCount? = nil,
    projectionTeams: [TeamID]? = nil
) throws {
    if let projectionTeamCount, board.teamCount != projectionTeamCount {
        throw ProtocolDecodingError.invalidValue(
            field: "board.teamCount",
            constraint: "the projection teamCount"
        )
    }

    let geometry = boardGeometry(for: board.teamCount)
    guard board.rows == geometry.rows,
          board.columns == geometry.columns,
          board.order.count == geometry.cardCount,
          board.cards.count == geometry.cardCount
    else {
        throw ProtocolDecodingError.invalidValue(
            field: "board",
            constraint: "the canonical dimensions for teamCount"
        )
    }

    try requireConfiguredTeams(board.configuredTeams, teamCount: board.teamCount, field: "board.configuredTeams")
    if let projectionTeams, board.configuredTeams != projectionTeams {
        throw ProtocolDecodingError.invalidValue(
            field: "board.configuredTeams",
            constraint: "the projection configuredTeams"
        )
    }

    try requireUniqueStrings(board.order, field: "board.order")
    let cardIds = board.cards.map(\.id)
    try requireUniqueStrings(cardIds, field: "board.cards")
    guard Set(cardIds) == Set(board.order) else {
        throw ProtocolDecodingError.invalidValue(
            field: "board.cards",
            constraint: "exactly the cards in board.order"
        )
    }

    guard Set(board.eliminatedTeams).count == board.eliminatedTeams.count,
          board.eliminatedTeams.allSatisfy({ board.configuredTeams.contains($0) })
    else {
        throw ProtocolDecodingError.invalidValue(
            field: "board.eliminatedTeams",
            constraint: "unique configured teams"
        )
    }

    guard board.teamSummaries.map(\.teamId) == board.configuredTeams,
          Set(board.teamSummaries.map(\.teamId)).count == board.teamSummaries.count
    else {
        throw ProtocolDecodingError.invalidValue(
            field: "board.teamSummaries",
            constraint: "one summary for each configured team in order"
        )
    }

    for summary in board.teamSummaries {
        let revealedTargets = board.cards.filter {
            $0.revealed && $0.owner == Ownership(rawValue: summary.teamId.rawValue)
        }.count
        guard summary.revealedTargets == revealedTargets,
              summary.eliminated == board.eliminatedTeams.contains(summary.teamId)
        else {
            throw ProtocolDecodingError.invalidValue(
                field: "board.teamSummaries",
                constraint: "current public card facts"
            )
        }
    }
}

private func normalizedClueWord(_ value: String, field: String) throws -> String {
    let normalized = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .precomposedStringWithCanonicalMapping
    guard !normalized.isEmpty,
          normalized.count <= 40,
          normalized.range(
              of: #"^[\p{L}\p{M}\p{N}'’-]+$"#,
              options: .regularExpression
          ) != nil
    else {
        throw ProtocolDecodingError.invalidValue(
            field: field,
            constraint: "1 through 40 letter, mark, number, apostrophe, or hyphen graphemes"
        )
    }
    return normalized
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
    case green
    case yellow

    static let protocolField = "teamId"
}

enum TeamCount: Int, CaseIterable, Codable, Equatable, Hashable, Sendable {
    case two = 2
    case three = 3
    case four = 4

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(Int.self)
        guard let value = Self(rawValue: rawValue) else {
            throw ProtocolDecodingError.invalidValue(
                field: "teamCount",
                constraint: "2, 3, or 4"
            )
        }
        self = value
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
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
    case green
    case yellow
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

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case playerId
        case displayName
        case teamId
        case role
        case connected
    }

    init(from decoder: Decoder) throws {
        try decoder.validateProtocolKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        playerId = try requireNonEmpty(
            container.decode(String.self, forKey: .playerId),
            field: CodingKeys.playerId.rawValue
        )
        displayName = try requireNonEmpty(
            container.decode(String.self, forKey: .displayName),
            field: CodingKeys.displayName.rawValue
        )
        teamId = try container.decodeRequiredNullable(TeamID.self, forKey: .teamId)
        role = try container.decode(SeatRole.self, forKey: .role)
        connected = try container.decode(Bool.self, forKey: .connected)
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

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case playerId
        case teamId
        case role
        case isHost
    }

    init(from decoder: Decoder) throws {
        try decoder.validateProtocolKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        playerId = try requireNonEmpty(
            container.decode(String.self, forKey: .playerId),
            field: CodingKeys.playerId.rawValue
        )
        teamId = try container.decodeRequiredNullable(TeamID.self, forKey: .teamId)
        role = try container.decode(SeatRole.self, forKey: .role)
        isHost = try container.decode(Bool.self, forKey: .isHost)
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

    private enum CodingKeys: String, CodingKey, CaseIterable {
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

    init(from decoder: Decoder) throws {
        try decoder.validateProtocolKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        configure = try container.decode(Bool.self, forKey: .configure)
        moderate = try container.decode(Bool.self, forKey: .moderate)
        submitClue = try container.decode(Bool.self, forKey: .submitClue)
        challengeClue = try container.decode(Bool.self, forKey: .challengeClue)
        nominate = try container.decode(Bool.self, forKey: .nominate)
        confirmReveal = try container.decode(Bool.self, forKey: .confirmReveal)
        endTurn = try container.decode(Bool.self, forKey: .endTurn)
        resolveChallenge = try container.decode(Bool.self, forKey: .resolveChallenge)
        pause = try container.decode(Bool.self, forKey: .pause)
        resume = try container.decode(Bool.self, forKey: .resume)
    }
}

struct PublicCard: Codable, Equatable, Sendable {
    let id: String
    let label: String
    let revealed: Bool
    let owner: Ownership?

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case id
        case label
        case revealed
        case owner
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try requireNonEmpty(
            container.decode(String.self, forKey: .id),
            field: CodingKeys.id.rawValue
        )
        label = try container.decode(String.self, forKey: .label)
        revealed = try container.decode(Bool.self, forKey: .revealed)

        let allowedKeys: [CodingKeys] = revealed ? CodingKeys.allCases : [.id, .label, .revealed]
        let requiredKeys: [CodingKeys] = revealed
            ? [.id, .label, .revealed, .owner]
            : [.id, .label, .revealed]
        try decoder.validateProtocolKeys(
            CodingKeys.self,
            allowed: allowedKeys,
            required: requiredKeys
        )

        if revealed {
            guard try !container.decodeNil(forKey: .owner) else {
                throw ProtocolDecodingError.invalidValue(
                    field: CodingKeys.owner.rawValue,
                    constraint: "a non-null owner for revealed cards"
                )
            }
            owner = try container.decode(Ownership.self, forKey: .owner)
        } else {
            owner = nil
        }
    }
}

struct Clue: Codable, Equatable, Sendable {
    let word: String
    let count: Int

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case word
        case count
    }

    init(from decoder: Decoder) throws {
        try decoder.validateProtocolKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        word = try requireNonEmpty(
            container.decode(String.self, forKey: .word),
            field: CodingKeys.word.rawValue
        )
        count = try requireRange(
            container.decode(Int.self, forKey: .count),
            field: CodingKeys.count.rawValue,
            minimum: 1
        )
    }
}

struct Nomination: Codable, Equatable, Sendable {
    let playerId: String
    let cardId: String

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case playerId
        case cardId
    }

    init(from decoder: Decoder) throws {
        try decoder.validateProtocolKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        playerId = try requireNonEmpty(
            container.decode(String.self, forKey: .playerId),
            field: CodingKeys.playerId.rawValue
        )
        cardId = try requireNonEmpty(
            container.decode(String.self, forKey: .cardId),
            field: CodingKeys.cardId.rawValue
        )
    }
}

struct PublicTeamSummary: Codable, Equatable, Sendable {
    let teamId: TeamID
    let revealedTargets: Int
    let eliminated: Bool

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case teamId
        case revealedTargets
        case eliminated
    }

    init(from decoder: Decoder) throws {
        try decoder.validateProtocolKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        teamId = try container.decode(TeamID.self, forKey: .teamId)
        revealedTargets = try requireNonnegative(
            container.decode(Int.self, forKey: .revealedTargets),
            field: CodingKeys.revealedTargets.rawValue
        )
        eliminated = try container.decode(Bool.self, forKey: .eliminated)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(teamId, forKey: .teamId)
        try container.encode(revealedTargets, forKey: .revealedTargets)
        try container.encode(eliminated, forKey: .eliminated)
    }
}

struct PublicBoardProjection: Codable, Equatable, Sendable {
    let teamCount: TeamCount
    let rows: Int
    let columns: Int
    let configuredTeams: [TeamID]
    let eliminatedTeams: [TeamID]
    let teamSummaries: [PublicTeamSummary]
    let order: [String]
    let cards: [PublicCard]
    let activeTeam: TeamID
    let phase: PlayPhase
    let clue: Clue?
    let guessesRemaining: Int
    let nomination: Nomination?
    let winner: TeamID?
    let completionReason: CompletionReason?

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case teamCount
        case rows
        case columns
        case configuredTeams
        case eliminatedTeams
        case teamSummaries
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

    init(from decoder: Decoder) throws {
        try decoder.validateProtocolKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedTeamCount = try container.decode(TeamCount.self, forKey: .teamCount)
        let decodedRows = try requireRange(
            container.decode(Int.self, forKey: .rows),
            field: CodingKeys.rows.rawValue,
            minimum: 5,
            maximum: 6
        )
        let decodedColumns = try requireRange(
            container.decode(Int.self, forKey: .columns),
            field: CodingKeys.columns.rawValue,
            minimum: 5,
            maximum: 6
        )
        let decodedConfiguredTeams = try container.decode([TeamID].self, forKey: .configuredTeams)
        let decodedEliminatedTeams = try container.decode([TeamID].self, forKey: .eliminatedTeams)
        let decodedTeamSummaries = try container.decode([PublicTeamSummary].self, forKey: .teamSummaries)
        let decodedOrder = try container.decode([String].self, forKey: .order)
        for cardId in decodedOrder {
            _ = try requireNonEmpty(cardId, field: CodingKeys.order.rawValue)
        }
        let decodedCards = try container.decode([PublicCard].self, forKey: .cards)
        let decodedActiveTeam = try container.decode(TeamID.self, forKey: .activeTeam)
        let decodedPhase = try container.decode(PlayPhase.self, forKey: .phase)
        let decodedClue = try container.decodeRequiredNullable(Clue.self, forKey: .clue)
        let decodedGuessesRemaining = try requireNonnegative(
            container.decode(Int.self, forKey: .guessesRemaining),
            field: CodingKeys.guessesRemaining.rawValue
        )
        let decodedNomination = try container.decodeRequiredNullable(Nomination.self, forKey: .nomination)
        let decodedWinner = try container.decodeRequiredNullable(TeamID.self, forKey: .winner)
        let decodedCompletionReason = try container.decodeRequiredNullable(
            CompletionReason.self,
            forKey: .completionReason
        )

        let decodedBoard = PublicBoardProjection(
            teamCount: decodedTeamCount,
            rows: decodedRows,
            columns: decodedColumns,
            configuredTeams: decodedConfiguredTeams,
            eliminatedTeams: decodedEliminatedTeams,
            teamSummaries: decodedTeamSummaries,
            order: decodedOrder,
            cards: decodedCards,
            activeTeam: decodedActiveTeam,
            phase: decodedPhase,
            clue: decodedClue,
            guessesRemaining: decodedGuessesRemaining,
            nomination: decodedNomination,
            winner: decodedWinner,
            completionReason: decodedCompletionReason
        )
        try validatePublicBoard(decodedBoard)

        teamCount = decodedTeamCount
        rows = decodedRows
        columns = decodedColumns
        configuredTeams = decodedConfiguredTeams
        eliminatedTeams = decodedEliminatedTeams
        teamSummaries = decodedTeamSummaries
        order = decodedOrder
        cards = decodedCards
        activeTeam = decodedActiveTeam
        phase = decodedPhase
        clue = decodedClue
        guessesRemaining = decodedGuessesRemaining
        nomination = decodedNomination
        winner = decodedWinner
        completionReason = decodedCompletionReason
    }

    private init(
        teamCount: TeamCount,
        rows: Int,
        columns: Int,
        configuredTeams: [TeamID],
        eliminatedTeams: [TeamID],
        teamSummaries: [PublicTeamSummary],
        order: [String],
        cards: [PublicCard],
        activeTeam: TeamID,
        phase: PlayPhase,
        clue: Clue?,
        guessesRemaining: Int,
        nomination: Nomination?,
        winner: TeamID?,
        completionReason: CompletionReason?
    ) {
        self.teamCount = teamCount
        self.rows = rows
        self.columns = columns
        self.configuredTeams = configuredTeams
        self.eliminatedTeams = eliminatedTeams
        self.teamSummaries = teamSummaries
        self.order = order
        self.cards = cards
        self.activeTeam = activeTeam
        self.phase = phase
        self.clue = clue
        self.guessesRemaining = guessesRemaining
        self.nomination = nomination
        self.winner = winner
        self.completionReason = completionReason
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(teamCount, forKey: .teamCount)
        try container.encode(rows, forKey: .rows)
        try container.encode(columns, forKey: .columns)
        try container.encode(configuredTeams, forKey: .configuredTeams)
        try container.encode(eliminatedTeams, forKey: .eliminatedTeams)
        try container.encode(teamSummaries, forKey: .teamSummaries)
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
    case cardRevealed(
        revision: Int,
        at: String,
        teamId: TeamID,
        cardId: String,
        owner: Ownership,
        eliminatedTeam: TeamID?
    )
    case turnEnded(revision: Int, at: String, teamId: TeamID)
    case roomPaused(revision: Int, at: String)
    case roomResumed(revision: Int, at: String)

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case revision
        case at
        case type
        case teamId
        case word
        case count
        case decision
        case cardId
        case owner
        case eliminatedTeam
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
        let variantKeys: [CodingKeys]
        let requiredKeys: [CodingKeys]
        switch type {
        case .clueSubmitted:
            variantKeys = [.revision, .at, .type, .teamId, .word, .count]
            requiredKeys = variantKeys
        case .clueChallenged:
            variantKeys = [.revision, .at, .type, .teamId]
            requiredKeys = variantKeys
        case .challengeResolved:
            variantKeys = [.revision, .at, .type, .decision]
            requiredKeys = variantKeys
        case .cardRevealed:
            variantKeys = [.revision, .at, .type, .teamId, .cardId, .owner, .eliminatedTeam]
            requiredKeys = [.revision, .at, .type, .teamId, .cardId, .owner]
        case .turnEnded:
            variantKeys = [.revision, .at, .type, .teamId]
            requiredKeys = variantKeys
        case .roomPaused, .roomResumed:
            variantKeys = [.revision, .at, .type]
            requiredKeys = variantKeys
        }
        try decoder.validateProtocolKeys(
            CodingKeys.self,
            allowed: variantKeys,
            required: requiredKeys
        )
        let revision = try requireNonnegative(
            container.decode(Int.self, forKey: .revision),
            field: CodingKeys.revision.rawValue
        )
        let at = try requireNonEmpty(
            container.decode(String.self, forKey: .at),
            field: CodingKeys.at.rawValue
        )

        switch type {
        case .clueSubmitted:
            let word = try requireNonEmpty(
                container.decode(String.self, forKey: .word),
                field: CodingKeys.word.rawValue
            )
            let count = try requireRange(
                container.decode(Int.self, forKey: .count),
                field: CodingKeys.count.rawValue,
                minimum: 1,
                maximum: 9
            )
            self = try .clueSubmitted(
                revision: revision,
                at: at,
                teamId: container.decode(TeamID.self, forKey: .teamId),
                word: word,
                count: count
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
            let decodedOwner = try container.decode(Ownership.self, forKey: .owner)
            let decodedEliminatedTeam = try container.decodeOptionalNonNull(
                TeamID.self,
                forKey: .eliminatedTeam
            )
            if decodedEliminatedTeam != nil, decodedOwner != .hazard {
                throw ProtocolDecodingError.invalidValue(
                    field: CodingKeys.eliminatedTeam.rawValue,
                    constraint: "only a hazard reveal may eliminate a team"
                )
            }
            self = try .cardRevealed(
                revision: revision,
                at: at,
                teamId: container.decode(TeamID.self, forKey: .teamId),
                cardId: requireNonEmpty(
                    container.decode(String.self, forKey: .cardId),
                    field: CodingKeys.cardId.rawValue
                ),
                owner: decodedOwner,
                eliminatedTeam: decodedEliminatedTeam
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
        case let .cardRevealed(revision, at, teamId, cardId, owner, eliminatedTeam):
            try container.encode(EntryType.cardRevealed, forKey: .type)
            try container.encode(revision, forKey: .revision)
            try container.encode(at, forKey: .at)
            try container.encode(teamId, forKey: .teamId)
            try container.encode(cardId, forKey: .cardId)
            try container.encode(owner, forKey: .owner)
            if let eliminatedTeam {
                try container.encode(eliminatedTeam, forKey: .eliminatedTeam)
            }
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
    let teamCount: TeamCount
    let configuredTeams: [TeamID]
    let viewer: ViewerContext
    let permissions: ProjectionPermissions
    let seats: [SeatSummary]
    let publicHistory: [PublicHistoryEntry]
    let board: PublicBoardProjection?

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion
        case revision
        case code
        case inviteUrl
        case roomPhase
        case locked
        case teamCount
        case configuredTeams
        case viewer
        case permissions
        case seats
        case publicHistory
        case board
    }

    init(from decoder: Decoder) throws {
        try decoder.requireProtocolKeys(Array(CodingKeys.allCases))
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .protocolVersion)
        guard version == 2 else {
            throw ProtocolDecodingError.unsupportedProtocolVersion(version)
        }

        let history = try container.decode([PublicHistoryEntry].self, forKey: .publicHistory)
        guard history.count <= Self.maximumPublicHistoryEntries else {
            throw ProtocolDecodingError.publicHistoryLimitExceeded(
                actual: history.count,
                maximum: Self.maximumPublicHistoryEntries
            )
        }

        let decodedRevision = try requireNonnegative(
            container.decode(Int.self, forKey: .revision),
            field: CodingKeys.revision.rawValue
        )
        let decodedCode = try requireNonEmpty(
            container.decode(String.self, forKey: .code),
            field: CodingKeys.code.rawValue
        )
        let decodedInviteUrl = try requireNonEmpty(
            container.decode(String.self, forKey: .inviteUrl),
            field: CodingKeys.inviteUrl.rawValue
        )
        let decodedRoomPhase = try container.decode(RoomPhase.self, forKey: .roomPhase)
        let decodedLocked = try container.decode(Bool.self, forKey: .locked)
        let decodedTeamCount = try container.decode(TeamCount.self, forKey: .teamCount)
        let decodedConfiguredTeams = try container.decode([TeamID].self, forKey: .configuredTeams)
        try requireConfiguredTeams(
            decodedConfiguredTeams,
            teamCount: decodedTeamCount,
            field: CodingKeys.configuredTeams.rawValue
        )
        let decodedViewer = try container.decode(ViewerContext.self, forKey: .viewer)
        let decodedPermissions = try container.decode(ProjectionPermissions.self, forKey: .permissions)
        let decodedSeats = try container.decode([SeatSummary].self, forKey: .seats)
        let decodedBoard = try container.decodeRequiredNullable(PublicBoardProjection.self, forKey: .board)
        if let decodedBoard {
            try validatePublicBoard(
                decodedBoard,
                projectionTeamCount: decodedTeamCount,
                projectionTeams: decodedConfiguredTeams
            )
        }

        protocolVersion = version
        revision = decodedRevision
        code = decodedCode
        inviteUrl = decodedInviteUrl
        roomPhase = decodedRoomPhase
        locked = decodedLocked
        teamCount = decodedTeamCount
        configuredTeams = decodedConfiguredTeams
        viewer = decodedViewer
        permissions = decodedPermissions
        seats = decodedSeats
        publicHistory = history
        board = decodedBoard
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(revision, forKey: .revision)
        try container.encode(code, forKey: .code)
        try container.encode(inviteUrl, forKey: .inviteUrl)
        try container.encode(roomPhase, forKey: .roomPhase)
        try container.encode(locked, forKey: .locked)
        try container.encode(teamCount, forKey: .teamCount)
        try container.encode(configuredTeams, forKey: .configuredTeams)
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

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion
        case revision
        case code
        case inviteUrl
        case roomPhase
        case locked
        case teamCount
        case configuredTeams
        case viewer
        case permissions
        case seats
        case publicHistory
        case board
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

        let baseKeys: [CodingKeys] = [
            .protocolVersion,
            .revision,
            .code,
            .inviteUrl,
            .roomPhase,
            .locked,
            .teamCount,
            .configuredTeams,
            .viewer,
            .permissions,
            .seats,
            .publicHistory,
            .board,
            .viewRole
        ]
        let allowedKeys = baseKeys + [.key]
        let requiredKeys = role == .clueGiver ? allowedKeys : baseKeys
        try decoder.validateProtocolKeys(
            CodingKeys.self,
            allowed: allowedKeys,
            required: requiredKeys
        )

        let base = try ProjectionBase(from: decoder)
        switch role {
        case .operative:
            try Self.rejectHiddenKey(in: container, role: role)
            self = .operative(base)
        case .clueGiver:
            let key = try container.decode([String: Ownership].self, forKey: .key)
            let boardCardIds = Set(base.board?.order ?? [])
            guard key.count == boardCardIds.count,
                  Set(key.keys) == boardCardIds
            else {
                throw ProtocolDecodingError.invalidValue(
                    field: CodingKeys.key.rawValue,
                    constraint: "exactly the current board card IDs"
                )
            }
            self = try .clueGiver(
                base: base,
                key: key
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
        case setTeamCount = "set_team_count"
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
    case setTeamCount(teamCount: TeamCount)
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

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case type
        case playerId
        case teamId
        case teamCount
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
        case .setTeamCount: return .setTeamCount
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
        let type = try container.decode(CommandType.self, forKey: .type)
        let variantKeys: [CodingKeys]
        switch type {
        case .randomizeTeams,
             .startBoard,
             .challengeClue,
             .clearNomination,
             .endTurn,
             .pauseRoom,
             .resumeRoom:
            variantKeys = [.type]
        case .setTeamCount:
            variantKeys = [.type, .teamCount]
        case .assignSeat:
            variantKeys = [.type, .playerId, .teamId]
        case .setRole:
            variantKeys = [.type, .playerId, .role]
        case .lockRoom:
            variantKeys = [.type, .locked]
        case .submitClue:
            variantKeys = [.type, .word, .count]
        case .resolveChallenge:
            variantKeys = [.type, .decision]
        case .nominateCard, .confirmReveal:
            variantKeys = [.type, .cardId]
        }
        try decoder.validateProtocolKeys(
            CodingKeys.self,
            allowed: variantKeys,
            required: variantKeys
        )

        switch type {
        case .randomizeTeams:
            self = .randomizeTeams
        case .setTeamCount:
            self = try .setTeamCount(
                teamCount: container.decode(TeamCount.self, forKey: .teamCount)
            )
        case .assignSeat:
            self = try .assignSeat(
                playerId: requireNonEmpty(
                    container.decode(String.self, forKey: .playerId),
                    field: CodingKeys.playerId.rawValue
                ),
                teamId: container.decodeRequiredNullable(TeamID.self, forKey: .teamId)
            )
        case .setRole:
            self = try .setRole(
                playerId: requireNonEmpty(
                    container.decode(String.self, forKey: .playerId),
                    field: CodingKeys.playerId.rawValue
                ),
                role: container.decode(SeatRole.self, forKey: .role)
            )
        case .lockRoom:
            self = try .lockRoom(locked: container.decode(Bool.self, forKey: .locked))
        case .startBoard:
            self = .startBoard
        case .submitClue:
            self = try .submitClue(
                word: normalizedClueWord(
                    container.decode(String.self, forKey: .word),
                    field: CodingKeys.word.rawValue
                ),
                count: requireRange(
                    container.decode(Int.self, forKey: .count),
                    field: CodingKeys.count.rawValue,
                    minimum: 1,
                    maximum: 9
                )
            )
        case .challengeClue:
            self = .challengeClue
        case .resolveChallenge:
            self = try .resolveChallenge(
                decision: container.decode(ChallengeDecision.self, forKey: .decision)
            )
        case .nominateCard:
            self = try .nominateCard(
                cardId: requireNonEmpty(
                    container.decode(String.self, forKey: .cardId),
                    field: CodingKeys.cardId.rawValue
                )
            )
        case .clearNomination:
            self = .clearNomination
        case .confirmReveal:
            self = try .confirmReveal(
                cardId: requireNonEmpty(
                    container.decode(String.self, forKey: .cardId),
                    field: CodingKeys.cardId.rawValue
                )
            )
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
        case let .setTeamCount(teamCount):
            try container.encode(teamCount, forKey: .teamCount)
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
        protocolVersion = 2
        self.commandId = commandId
        self.expectedRevision = expectedRevision
        self.command = command
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion
        case commandId
        case expectedRevision
        case command
    }

    init(from decoder: Decoder) throws {
        try decoder.validateProtocolKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .protocolVersion)
        guard version == 2 else {
            throw ProtocolDecodingError.unsupportedProtocolVersion(version)
        }
        protocolVersion = version
        commandId = try container.decode(UUID.self, forKey: .commandId)
        expectedRevision = try requireNonnegative(
            container.decode(Int.self, forKey: .expectedRevision),
            field: CodingKeys.expectedRevision.rawValue
        )
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

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case ok
        case revision
        case code
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let succeeded = try container.decode(Bool.self, forKey: .ok)
        let variantKeys: [CodingKeys] = succeeded
            ? [.ok, .revision]
            : [.ok, .revision, .code, .message]
        try decoder.validateProtocolKeys(
            CodingKeys.self,
            allowed: variantKeys,
            required: variantKeys
        )
        let revision = try requireNonnegative(
            container.decode(Int.self, forKey: .revision),
            field: CodingKeys.revision.rawValue
        )
        if succeeded {
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

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case type
        case projection
        case commandId
        case result
        case code
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(MessageType.self, forKey: .type)
        let variantKeys: [CodingKeys]
        switch type {
        case .projection:
            variantKeys = [.type, .projection]
        case .commandResult:
            variantKeys = [.type, .commandId, .result]
        case .error:
            variantKeys = [.type, .code, .message]
        }
        try decoder.validateProtocolKeys(
            CodingKeys.self,
            allowed: variantKeys,
            required: variantKeys
        )

        switch type {
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
