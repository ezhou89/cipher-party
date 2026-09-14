import SwiftUI

struct LobbyHostControlsPresentation: Equatable, Sendable {
    let canConfigure: Bool
    let canModerate: Bool
    let actionsAreEnabled: Bool

    var isVisible: Bool {
        canConfigure || canModerate
    }
}

struct LobbyReadiness: Equatable, Sendable {
    static let startRequirementHint =
        "Each team must have at least one clue-giver and one operative to start."

    let configuredTeams: [TeamID]
    let seats: [SeatSummary]
    let redClueGivers: Int
    let redOperatives: Int
    let blueClueGivers: Int
    let blueOperatives: Int

    init(seats: [SeatSummary], configuredTeams: [TeamID] = [.red, .blue]) {
        self.seats = seats
        self.configuredTeams = configuredTeams
        let redSeats = seats.filter { $0.teamId == .red }
        let blueSeats = seats.filter { $0.teamId == .blue }
        redClueGivers = redSeats.filter { $0.role == .clueGiver }.count
        redOperatives = redSeats.filter { $0.role == .operative }.count
        blueClueGivers = blueSeats.filter { $0.role == .clueGiver }.count
        blueOperatives = blueSeats.filter { $0.role == .operative }.count
    }

    var isReady: Bool {
        configuredTeams.allSatisfy { team in
            seatsFor(team: team).contains { $0.role == .clueGiver } &&
                seatsFor(team: team).contains { $0.role == .operative }
        }
    }

    var requirementHint: String? {
        isReady ? nil : Self.startRequirementHint
    }

    private func seatsFor(team: TeamID) -> [SeatSummary] {
        seats.filter { $0.teamId == team }
    }
}

struct LobbyPresentation: Equatable, Sendable {
    static let mixedClientGuidance =
        "Browser and iPhone players appear together in this same server-provided seat list."

    let roomCode: String
    let inviteURLString: String
    let roomPhaseLabel: String
    let lockLabel: String
    let seats: [LobbySeatPresentation]
    let readiness: LobbyReadiness
    let hostControls: LobbyHostControlsPresentation
    let connection: ConnectionBannerPresentation

    var showsHostControls: Bool {
        hostControls.isVisible
    }

    init(
        projection: RoomProjection,
        connectionState: RoomConnectionState,
        isStale: Bool,
        lastUpdated: Date?,
        isCommandPending: Bool = false
    ) {
        roomCode = projection.base.code
        inviteURLString = projection.base.inviteUrl
        roomPhaseLabel = projection.base.roomPhase.displayName
        lockLabel = projection.base.locked ? "Locked" : "Open"
        seats = projection.base.seats.map(LobbySeatPresentation.init)
        readiness = LobbyReadiness(
            seats: projection.base.seats,
            configuredTeams: projection.base.configuredTeams
        )
        hostControls = LobbyHostControlsPresentation(
            canConfigure: projection.base.permissions.configure,
            canModerate: projection.base.permissions.moderate,
            actionsAreEnabled: connectionState == .connected && !isStale && !isCommandPending
        )
        connection = ConnectionBannerPresentation.make(
            state: connectionState,
            isStale: isStale,
            lastUpdated: lastUpdated
        )
    }
}

extension RoomPhase {
    var displayName: String {
        switch self {
        case .lobby: return "Lobby"
        case .playing: return "In progress"
        case .complete: return "Complete"
        }
    }
}

@MainActor
struct LobbyView: View {
    let session: RoomSession

    var body: some View {
        Group {
            if let projection = session.projection {
                lobbyContent(projection: projection)
            } else {
                waitingContent
            }
        }
        .navigationBarBackButtonHidden()
    }

    @ViewBuilder
    private func lobbyContent(projection: RoomProjection) -> some View {
        let presentation = LobbyPresentation(
            projection: projection,
            connectionState: session.connectionState,
            isStale: session.isStale,
            lastUpdated: session.lastUpdated,
            isCommandPending: session.hasPendingCommand
        )

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                ConnectionBanner(
                    state: session.connectionState,
                    isStale: session.isStale,
                    lastUpdated: session.lastUpdated
                )

                roomSummary(presentation: presentation)

                RoomActionStatusView(session: session)

                RoomShareSheet(
                    roomCode: presentation.roomCode,
                    inviteURLString: presentation.inviteURLString
                )

                SeatListView(seats: projection.base.seats)

                if presentation.hostControls.isVisible {
                    LobbyHostControlsView(
                        session: session,
                        seats: projection.base.seats,
                        permissions: projection.base.permissions,
                        actionsAreEnabled: presentation.hostControls.actionsAreEnabled,
                        readiness: presentation.readiness,
                        teamCount: projection.base.teamCount,
                        configuredTeams: projection.base.configuredTeams,
                        roomPhase: projection.base.roomPhase,
                        locked: projection.base.locked
                    )
                }

                nextSteps(projection: projection)
            }
            .padding(16)
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Room \(presentation.roomCode)")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("lobby.screen")
    }

    private var waitingContent: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Waiting for the room…")
                .font(.headline)
            Text("The server will send the private room view when the connection is ready.")
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("lobby.waiting")
    }

    private func roomSummary(presentation: LobbyPresentation) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(presentation.roomPhaseLabel, systemImage: "rectangle.3.group")
                    .font(.headline)
                Spacer()
                Label(presentation.lockLabel, systemImage: presentation.lockLabel == "Locked" ? "lock.fill" : "lock.open")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(presentation.lockLabel == "Locked" ? .orange : .secondary)
            }

            Text("Everyone can use the room code or invite link. Team and role changes are confirmed by the server.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Text(LobbyPresentation.mixedClientGuidance)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("lobby.mixedClientGuidance")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("lobby.summary")
    }

    private func nextSteps(projection: RoomProjection) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What to do next")
                .font(.headline)
            if projection.base.roomPhase == .lobby {
                Text("1. Share the room code or QR invite with friends.")
                Text("2. Ask each player to choose a team and role, or join as a spectator.")
                Text("3. The authorized host can lock the room and start when every team is ready.")
            } else {
                Text("The room is in progress. Keep this screen open for live status and player presence.")
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityIdentifier("lobby.nextSteps")
    }
}

@MainActor
private struct LobbyHostControlsView: View {
    let session: RoomSession
    let seats: [SeatSummary]
    let permissions: ProjectionPermissions
    let actionsAreEnabled: Bool
    let readiness: LobbyReadiness
    let teamCount: TeamCount
    let configuredTeams: [TeamID]
    let roomPhase: RoomPhase
    let locked: Bool

    @State private var actionError: String?

    private var canConfigure: Bool {
        permissions.configure && actionsAreEnabled
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Host controls")
                .font(.title3.bold())
                .accessibilityIdentifier("lobby.hostControls.title")

            if permissions.moderate && !permissions.configure {
                Text("Moderation access is active. Configuration controls require the server to grant configure permission.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Button("Randomize teams", systemImage: "shuffle") {
                dispatch { try await session.randomizeTeams() }
            }
            .disabled(!canConfigure)
            .accessibilityIdentifier("lobby.randomizeTeams")

            Menu("Team count: \(teamCount.rawValue)", systemImage: "person.3") {
                ForEach(TeamCount.allCases, id: \.self) { option in
                    Button("\(option.rawValue) teams") {
                        dispatch { try await session.setTeamCount(option) }
                    }
                }
            }
            .disabled(!canConfigure || roomPhase != .lobby)
            .accessibilityIdentifier("lobby.teamCount")

            Toggle("Lock room", isOn: Binding(
                get: { locked },
                set: { newValue in
                    dispatch { try await session.lockRoom(newValue) }
                }
            ))
            .disabled(!canConfigure)
            .accessibilityIdentifier("lobby.lockRoom")

            VStack(alignment: .leading, spacing: 8) {
                Text("Assign teams and roles")
                    .font(.subheadline.weight(.semibold))

                ForEach(seats, id: \.playerId) { seat in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(seat.displayName)
                                .font(.subheadline.weight(.medium))
                            Text("\(seat.teamId?.displayName ?? "No team") · \(seat.role.displayName)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer(minLength: 0)

                        Menu("Team") {
                            Button("No team") {
                                dispatch { try await session.assignSeat(playerId: seat.playerId, teamId: nil) }
                            }
                            ForEach(configuredTeams, id: \.self) { team in
                                Button("\(team.displayName) team") {
                                    dispatch { try await session.assignSeat(playerId: seat.playerId, teamId: team) }
                                }
                            }
                        }
                        .disabled(!canConfigure)
                        .accessibilityIdentifier("lobby.assignTeam.\(seat.playerId)")

                        Menu("Role") {
                            ForEach(SeatRole.allCases, id: \.self) { role in
                                Button(role.displayName) {
                                    dispatch { try await session.setRole(playerId: seat.playerId, role: role) }
                                }
                            }
                        }
                        .disabled(!canConfigure)
                        .accessibilityIdentifier("lobby.assignRole.\(seat.playerId)")
                    }
                    .padding(.vertical, 4)
                }
            }

            Button("Start board", systemImage: "play.fill") {
                dispatch { try await session.startBoard() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canConfigure || !readiness.isReady || roomPhase != .lobby)
            .accessibilityIdentifier("lobby.startBoard")

            if let requirementHint = readiness.requirementHint {
                Text(requirementHint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("lobby.startRequirementHint")
            }

            if let actionError {
                Text(actionError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityLabel("Host control error: \(actionError)")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lobby.hostControls")
        .onChange(of: session.lastCommandResult) { _, _ in actionError = nil }
    }

    private func dispatch(_ operation: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            actionError = nil
            do {
                try await operation()
            } catch {
                actionError = "The server did not accept that action. Try again after the room updates."
            }
        }
    }
}
