import SwiftUI

struct BoardCardPresentation: Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let isRevealed: Bool
    let owner: Ownership?
    let keyOwner: Ownership?
    let isNominated: Bool
    let isSelectable: Bool

    var accessibilityLabel: String {
        var parts = ["Card " + label]
        if isRevealed, let owner {
            parts = ["Revealed " + label + ", " + owner.displayName]
        } else if let keyOwner {
            parts.append("key shows " + keyOwner.displayName)
        }
        if isNominated {
            parts.append("nominated")
        }
        return parts.joined(separator: ", ")
    }

    init(
        card: PublicCard,
        keyOwner: Ownership?,
        isNominated: Bool,
        isSelectable: Bool
    ) {
        id = card.id
        label = card.label
        isRevealed = card.revealed
        owner = card.revealed ? card.owner : nil
        self.keyOwner = card.revealed ? nil : keyOwner
        self.isNominated = isNominated
        self.isSelectable = isSelectable
    }
}

struct BoardControlsPresentation: Equatable, Sendable {
    let canSubmitClue: Bool
    let canChallengeClue: Bool
    let canNominate: Bool
    let canConfirmReveal: Bool
    let canEndTurn: Bool
    let canResolveChallenge: Bool
    let canPause: Bool
    let canResume: Bool
    let isReadOnly: Bool

    var hasAnyAction: Bool {
        canSubmitClue || canChallengeClue || canNominate || canConfirmReveal ||
            canEndTurn || canResolveChallenge || canPause || canResume
    }
}

struct BoardPresentation: Equatable, Sendable {
    let projection: RoomProjection
    let role: SeatRole
    let roomCode: String
    let activeTeam: TeamID?
    let phase: PlayPhase?
    let clue: Clue?
    let guessesRemaining: Int
    let nomination: Nomination?
    let winner: TeamID?
    let completionReason: CompletionReason?
    let cards: [BoardCardPresentation]
    let key: [String: Ownership]?
    let publicHistory: [PublicHistoryEntry]
    let controls: BoardControlsPresentation

    var board: PublicBoardProjection? { projection.base.board }
    var clueWord: String? { clue?.word }
    var isChallenged: Bool { phase == .challenged }
    var isPaused: Bool { phase == .paused }
    var isComplete: Bool {
        projection.base.roomPhase == .complete || phase == .boardComplete
    }
    var publicHistoryIsPreserved: Bool { publicHistory == projection.base.publicHistory }

    init(
        projection: RoomProjection,
        connectionState: RoomConnectionState,
        isStale: Bool,
        lastUpdated: Date?,
        isCommandPending: Bool = false
    ) {
        self.projection = projection
        role = projection.viewRole
        roomCode = projection.base.code
        publicHistory = projection.base.publicHistory

        let board = projection.base.board
        activeTeam = board?.activeTeam
        phase = board?.phase
        clue = board?.clue
        guessesRemaining = board?.guessesRemaining ?? 0
        nomination = board?.nomination
        winner = board?.winner
        completionReason = board?.completionReason

        let visibleKey = projection.viewRole == .clueGiver ? projection.key : nil
        key = visibleKey

        let transportIsReadOnly = connectionState != .connected || isStale
        let roomIsPlaying = projection.base.roomPhase == .playing
        let currentPhase = board?.phase
        let isComplete = projection.base.roomPhase == .complete || currentPhase == .boardComplete
        let permissions = projection.base.permissions
        let canSubmitClue = !transportIsReadOnly && roomIsPlaying && !isComplete &&
            currentPhase == .clue && permissions.submitClue
        let canChallengeClue = !transportIsReadOnly && roomIsPlaying && !isComplete &&
            currentPhase == .guess && board?.clue != nil && permissions.challengeClue
        let canNominate = !transportIsReadOnly && roomIsPlaying && !isComplete &&
            currentPhase == .guess && permissions.nominate
        let canConfirmReveal = !transportIsReadOnly && roomIsPlaying && !isComplete &&
            currentPhase == .guess && board?.nomination != nil && permissions.confirmReveal
        let canEndTurn = !transportIsReadOnly && roomIsPlaying && !isComplete &&
            currentPhase == .guess && permissions.endTurn
        let canResolveChallenge = !transportIsReadOnly && roomIsPlaying &&
            currentPhase == .challenged && permissions.resolveChallenge
        let canPause = !transportIsReadOnly && roomIsPlaying && !isComplete &&
            currentPhase != .paused && permissions.pause
        let canResume = !transportIsReadOnly && roomIsPlaying && currentPhase == .paused && permissions.resume
        controls = BoardControlsPresentation(
            canSubmitClue: canSubmitClue,
            canChallengeClue: canChallengeClue,
            canNominate: canNominate,
            canConfirmReveal: canConfirmReveal,
            canEndTurn: canEndTurn,
            canResolveChallenge: canResolveChallenge,
            canPause: canPause,
            canResume: canResume,
            isReadOnly: transportIsReadOnly || currentPhase == .paused || isComplete
        )

        guard let board else {
            cards = []
            return
        }

        let cardsByID = Dictionary(
            board.cards.map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        cards = board.order.compactMap { cardID in
            guard let card = cardsByID[cardID] else { return nil }
            return BoardCardPresentation(
                card: card,
                keyOwner: visibleKey?[cardID],
                isNominated: board.nomination?.cardId == cardID,
                isSelectable: canNominate && !isCommandPending && !card.revealed
            )
        }
    }
}

enum ClueComposerValidation {
    enum Result: Equatable, Sendable {
        case valid(word: String, count: Int)
        case invalid(String)
    }

    static func validate(word: String, count: Int) -> Result {
        let normalized = word
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .precomposedStringWithCanonicalMapping
        guard !normalized.isEmpty else {
            return .invalid("Clue word cannot be empty.")
        }
        guard normalized.count <= 40 else {
            return .invalid("Clue must be at most 40 graphemes.")
        }
        guard normalized.range(of: #"^[\p{L}\p{M}\p{N}'’-]+$"#, options: .regularExpression) != nil else {
            return .invalid("Clue word can only contain letters, numbers, apostrophes, and hyphens.")
        }
        guard (1...9).contains(count) else {
            return .invalid("Clue count must be an integer between 1 and 9.")
        }
        return .valid(word: normalized, count: count)
    }
}

@MainActor
struct BoardView: View {
    let session: RoomSession
    @State private var localActionError: String?

    var body: some View {
        Group {
            if let projection = session.projection {
                boardContent(
                    BoardPresentation(
                        projection: projection,
                        connectionState: session.connectionState,
                        isStale: session.isStale,
                        lastUpdated: session.lastUpdated,
                        isCommandPending: session.pendingCommand != nil
                    )
                )
            } else {
                waitingContent
            }
        }
        .navigationBarBackButtonHidden()
    }

    @ViewBuilder
    private func boardContent(_ presentation: BoardPresentation) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                ConnectionBanner(
                    state: session.connectionState,
                    isStale: session.isStale,
                    lastUpdated: session.lastUpdated
                )

                if let actionError = localActionError ?? boardActionErrorMessage {
                    BoardActionErrorView(message: actionError)
                }

                boardHeader(presentation)

                if presentation.isComplete {
                    BoardCompletionView(
                        winner: presentation.winner,
                        reason: presentation.completionReason
                    )
                } else if presentation.isChallenged {
                    ChallengeBanner(
                        clue: presentation.clue,
                        canResolve: presentation.controls.canResolveChallenge,
                        isCommandPending: session.pendingCommand != nil,
                        onResolve: { decision in
                            dispatch { try await session.resolveChallenge(decision) }
                        }
                    )
                } else if presentation.isPaused {
                    PausedBanner()
                }

                if let board = presentation.board {
                    BoardStatusView(
                        activeTeam: board.activeTeam,
                        phase: board.phase,
                        clue: board.clue,
                        guessesRemaining: board.guessesRemaining
                    )

                    ClueComposerView(
                        activeTeam: board.activeTeam,
                        phase: board.phase,
                        currentClue: board.clue,
                        canSubmitClue: presentation.controls.canSubmitClue,
                        canChallengeClue: presentation.controls.canChallengeClue,
                        isCommandPending: session.pendingCommand != nil,
                        onSubmit: { word, count in
                            dispatch { try await session.submitClue(word: word, count: count) }
                        },
                        onChallenge: {
                            dispatch { try await session.challengeClue() }
                        }
                    )

                    CardGridView(
                        cards: presentation.cards,
                        onNominate: { cardID in
                            dispatch { try await session.nominateCard(cardID) }
                        },
                        onClearNomination: {
                            dispatch { try await session.clearNomination() }
                        }
                    )

                    TurnControlsView(
                        controls: presentation.controls,
                        nomination: board.nomination,
                        nominatedCardLabel: presentation.cards.first {
                            $0.id == board.nomination?.cardId
                        }?.label,
                        isCommandPending: session.pendingCommand != nil,
                        onClearNomination: {
                            dispatch { try await session.clearNomination() }
                        },
                        onConfirmReveal: { cardID in
                            dispatch { try await session.confirmReveal(cardID) }
                        },
                        onEndTurn: {
                            dispatch { try await session.endTurn() }
                        },
                        onPause: {
                            dispatch { try await session.pause() }
                        },
                        onResume: {
                            dispatch { try await session.resume() }
                        }
                    )
                } else {
                    Text("The server has not supplied a board for this room yet.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
                }

                BoardHistoryView(entries: presentation.publicHistory)
            }
            .padding(16)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Room " + presentation.roomCode)
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("board.screen")
    }

    private var waitingContent: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Waiting for the latest board…")
                .font(.headline)
            Text("The server projection is required before board actions are available.")
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("board.waiting")
    }

    private func boardHeader(_ presentation: BoardPresentation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Classic board")
                    .font(.title2.bold())
                Spacer(minLength: 0)
                Text("Revision " + String(presentation.projection.revision))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            Text("Role: " + presentation.role.displayName)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("board.header")
    }

    private var boardActionErrorMessage: String? {
        guard let error = session.lastError else { return nil }
        if case .commandRejected(_, _) = error {
            guard let result = session.lastCommandResult else {
                return BoardActionErrorPresentation.message(for: error)
            }
            return BoardActionErrorPresentation.message(for: result)
        }
        return BoardActionErrorPresentation.message(for: error)
    }

    private func dispatch(_ operation: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            do {
                try await operation()
                localActionError = nil
            } catch let error as RoomSessionIntentError {
                localActionError = error.description
            } catch {
                localActionError = "The room action could not be completed. Wait for the latest update and try again."
            }
        }
    }

}

enum BoardActionErrorPresentation {
    static func message(for result: CommandResult) -> String? {
        switch result {
        case .success:
            return nil
        case let .failure(_, code, _):
            return commandMessage(for: code)
        }
    }

    static func message(for error: RoomSessionError) -> String? {
        switch error {
        case let .commandRejected(code, _):
            return commandMessage(for: code)
        case let .connection(failure):
            return failure.description
        case .connectionLost:
            return "The connection was lost before the server confirmed the action."
        case let .server(code, _):
            switch code {
            case .invalidMessage:
                return "The room could not understand the latest update."
            case .ticketExpired:
                return "The room connection expired. Reconnecting before actions resume."
            case .internalError:
                return "The room encountered a server error. Try again after it reconnects."
            }
        case .unsafeProjection:
            return "The latest room update could not be trusted. Actions are paused."
        case .send:
            return "The room action could not be sent. Actions are paused until it reconnects."
        case .cache, .leaveCleanup:
            return nil
        }
    }

    private static func commandMessage(for code: CommandErrorCode) -> String {
        switch code {
        case .invalidCommand:
            return "The room rejected that action. Check the current board and try again."
        case .unauthorized:
            return "You no longer have permission for that action."
        case .wrongPhase:
            return "The room phase changed. Wait for the latest board."
        case .staleRevision:
            return "The room changed before the action was confirmed. Wait for the latest board."
        case .storageFailed:
            return "The server could not save that action. Try again when connected."
        case .roomLocked:
            return "The room is locked and cannot accept that action."
        case .roomFull:
            return "The room is full and cannot accept that action."
        }
    }
}

private struct BoardActionErrorView: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.footnote.weight(.medium))
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("board.actionError")
    }
}

private struct BoardStatusView: View {
    let activeTeam: TeamID
    let phase: PlayPhase
    let clue: Clue?
    let guessesRemaining: Int

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            statusItem("Turn", activeTeam.displayName)
            statusItem("Phase", phase.displayName)
            if let clue {
                statusItem("Clue", clue.word + " · " + String(clue.count))
            }
            statusItem("Guesses", String(guessesRemaining))
        }
        .font(.subheadline)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("board.status")
    }

    private func statusItem(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.body.weight(.semibold))
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BoardCompletionView: View {
    let winner: TeamID?
    let reason: CompletionReason?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Game complete", systemImage: "checkmark.seal.fill")
                .font(.title3.bold())
            if let winner {
                Text(winner.displayName + " team wins")
                    .font(.headline)
            }
            if let reason {
                Text("Completion reason: " + reason.displayName)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("board.completion")
    }
}

private struct ChallengeBanner: View {
    let clue: Clue?
    let canResolve: Bool
    let isCommandPending: Bool
    let onResolve: (ChallengeDecision) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Clue challenged")
                .font(.headline)
            if let clue {
                Text("\(clue.word) · \(clue.count)")
                    .font(.subheadline)
            }
            if canResolve {
                HStack {
                    Button("Accept challenge") { onResolve(.accept) }
                        .buttonStyle(.borderedProminent)
                        .disabled(isCommandPending)
                        .accessibilityIdentifier("board.acceptChallenge")
                    Button("Reject challenge") { onResolve(.reject) }
                        .buttonStyle(.bordered)
                        .disabled(isCommandPending)
                        .accessibilityIdentifier("board.rejectChallenge")
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.14), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("board.challenged")
    }
}

private struct PausedBanner: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Game paused")
                .font(.headline)
            Text("The server has paused this room. The board remains a read-only reference until play resumes.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.14), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("board.paused")
    }
}

private struct BoardHistoryView: View {
    let entries: [PublicHistoryEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Public history")
                .font(.title3.bold())
            if entries.isEmpty {
                Text("No public actions yet.")
                    .foregroundStyle(.secondary)
            } else {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                        Text(entry.summary)
                            .font(.footnote)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("board.history")
    }
}

private extension PlayPhase {
    var displayName: String {
        switch self {
        case .clue: return "Clue"
        case .guess: return "Guess"
        case .challenged: return "Challenged"
        case .paused: return "Paused"
        case .boardComplete: return "Complete"
        }
    }
}

private extension Ownership {
    var displayName: String {
        switch self {
        case .red: return "Ruby"
        case .blue: return "Cobalt"
        case .neutral: return "Neutral"
        case .hazard: return "Hazard"
        }
    }
}

private extension CompletionReason {
    var displayName: String {
        switch self {
        case .targets: return "all targets found"
        case .hazard: return "hazard revealed"
        }
    }
}

private extension PublicHistoryEntry {
    var summary: String {
        switch self {
        case let .clueSubmitted(revision, _, teamID, word, count):
            return "Revision \(revision): \(teamID.displayName) clue \(word) (\(count))"
        case let .clueChallenged(revision, _, teamID):
            return "Revision \(revision): \(teamID.displayName) clue challenged"
        case let .challengeResolved(revision, _, decision):
            return "Revision \(revision): challenge \(decision == .accept ? "accepted" : "rejected")"
        case let .cardRevealed(revision, _, teamID, cardID, owner):
            return "Revision \(revision): \(teamID.displayName) revealed \(cardID) (\(owner.displayName))"
        case let .turnEnded(revision, _, teamID):
            return "Revision \(revision): \(teamID.displayName) ended the turn"
        case let .roomPaused(revision, _):
            return "Revision \(revision): room paused"
        case let .roomResumed(revision, _):
            return "Revision \(revision): room resumed"
        }
    }
}
