import SwiftUI
import Observation

enum RoomEntryError: Error, LocalizedError {
    case invalidDisplayName
    var errorDescription: String? { "Enter a name of 24 characters or fewer for a new seat." }
}

struct RoomEntryService: Sendable {
    let apiClient: APIClient
    let credentialStore: any RoomSeatStoring

    func resumeOrJoin(code: String, displayName: String, asSpectator: Bool) async throws -> SeatCredentials {
        let code = try RoomCode.normalizedAndValidated(code)
        if let saved = try await credentialStore.get(code: code) {
            return saved
        }
        guard let name = normalizedDisplayName(displayName) else {
            throw RoomEntryError.invalidDisplayName
        }
        let response = try await apiClient.joinRoom(code: code, displayName: name, asSpectator: asSpectator)
        let credentials = SeatCredentials(code: response.code, playerId: response.playerId, seatToken: response.seatToken, hostToken: nil)
        try await credentialStore.put(credentials)
        return credentials
    }
}

/// One owner serializes session replacement, cleanup, and scene transitions.
@MainActor @Observable
final class RoomFlow {
    private(set) var session: RoomSession?
    private(set) var roomCode: String?
    private(set) var cleanupFailed = false
    private(set) var transitions = 0
    var isTransitioning: Bool { transitions > 0 }
    @ObservationIgnored private let makeSession: (SeatCredentials) -> RoomSession
    @ObservationIgnored private var transitionTask: Task<Void, Never>?
    @ObservationIgnored private var sceneIsActive = true

    init(makeSession: @escaping (SeatCredentials) -> RoomSession) {
        self.makeSession = makeSession
    }

    func open(_ credentials: SeatCredentials) async {
        transitions += 1
        defer { transitions -= 1 }
        await enqueue { [self] in
            guard roomCode != credentials.code || session == nil else { return }
            await cleanUpCurrentSession()
            let newSession = makeSession(credentials)
            roomCode = credentials.code
            session = newSession
            await newSession.connect()
            if !sceneIsActive { await newSession.didEnterBackground() }
        }.value
    }

    func leave() async {
        session?.prepareForBackground()
        transitions += 1
        defer { transitions -= 1 }
        await enqueue { [self] in await cleanUpCurrentSession() }.value
    }

    func sceneChanged(isActive: Bool) {
        guard sceneIsActive != isActive else { return }
        sceneIsActive = isActive
        if !isActive { session?.prepareForBackground() }
        enqueue { [self] in
            if isActive {
                await session?.willEnterForeground()
            } else {
                await session?.didEnterBackground()
            }
        }
    }

    func waitForTransitions() async { await transitionTask?.value }

    private func cleanUpCurrentSession() async {
        let previous = session
        await previous?.leave()
        cleanupFailed = previous?.lastError == .leaveCleanup
        session = nil
        roomCode = nil
    }

    @discardableResult
    private func enqueue(_ operation: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = transitionTask
        let next = Task { @MainActor in
            await previous?.value
            await operation()
        }
        transitionTask = next
        return next
    }
}

private enum EntryRoute: Hashable {
    case create
    case join(code: String?, scanImmediately: Bool)
}

struct EntryView: View {
    let environment: AppEnvironment

    private let apiClient: APIClient
    private let credentialStore: SeatCredentialStore
    private let inviteRouter: InviteRouter

    @State private var path: [EntryRoute] = []
    @State private var flow: RoomFlow
    @Environment(\.scenePhase) private var scenePhase
    @State private var linkError: String?

    init(environment: AppEnvironment) {
        self.environment = environment
        let apiClient = APIClient(baseURL: environment.apiBaseURL)
        self.apiClient = apiClient
        let credentialStore = SeatCredentialStore(service: environment.keychainServiceName)
        self.credentialStore = credentialStore
        inviteRouter = InviteRouter(customScheme: environment.urlScheme)
        _flow = State(initialValue: RoomFlow { credentials in
            RoomSession(
                code: credentials.code,
                socket: RoomSocket(credentials: credentials, environment: environment, apiClient: apiClient),
                credentialStore: credentialStore
            )
        })
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let roomSession = flow.session, let activeRoomCode = flow.roomCode {
                    RoomSessionHandoffView(code: activeRoomCode, session: roomSession)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button("Leave room", role: .destructive) {
                                    Task {
                                        await flow.leave()
                                        path.removeAll()
                                    }
                                }
                                .accessibilityIdentifier("room.leave")
                            }
                        }
                } else {
                    entryChoices
                }
            }
            .navigationDestination(for: EntryRoute.self) { route in
                switch route {
                case .create:
                    CreateRoomView(
                        apiClient: apiClient,
                        credentialStore: credentialStore,
                        onReady: openRoom
                    )
                case let .join(code, scanImmediately):
                    JoinRoomView(
                        initialCode: code ?? "",
                        scanImmediately: scanImmediately,
                        inviteRouter: inviteRouter,
                        apiClient: apiClient,
                        credentialStore: credentialStore,
                        onJoined: openRoom
                    )
                }
            }
        }
        .disabled(flow.isTransitioning)
        .onChange(of: scenePhase, initial: true) { _, phase in
            flow.sceneChanged(isActive: phase == .active)
        }
        .overlay {
            if scenePhase != .active, flow.session != nil {
                Color(uiColor: .systemBackground).ignoresSafeArea()
                    .overlay { Text("Cipher Party").font(.title.bold()) }
                    .accessibilityIdentifier("room.privacyCover")
            }
        }
        .onOpenURL(perform: handleIncomingURL)
        .alert("Invite unavailable", isPresented: linkErrorIsPresented) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(linkError ?? "Use the six-character room code instead.")
        }
    }

    private var entryChoices: some View {
        VStack(spacing: 24) {
            Spacer()

            Text("Cipher Party")
                .font(.largeTitle.bold())
                .accessibilityIdentifier("entry.title")

            Text("Create or join a private game with friends.")
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                NavigationLink("Return to saved room", value: EntryRoute.join(code: nil, scanImmediately: false))
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("entry.resumeRoom")

                NavigationLink("Create room", value: EntryRoute.create)
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("entry.createRoom")

                NavigationLink(
                    "Join with code",
                    value: EntryRoute.join(code: nil, scanImmediately: false)
                )
                .buttonStyle(.bordered)
                .accessibilityIdentifier("entry.joinWithCode")

                NavigationLink(
                    "Scan invite",
                    value: EntryRoute.join(code: nil, scanImmediately: true)
                )
                .buttonStyle(.bordered)
                .accessibilityIdentifier("entry.scanInvite")
            }
            .frame(maxWidth: 320)

            if flow.cleanupFailed {
                Text("Some saved room data could not be removed. Return to that room and leave again to retry cleanup.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(24)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("entry.screen")
    }

    private var linkErrorIsPresented: Binding<Bool> {
        Binding(
            get: { linkError != nil },
            set: { if !$0 { linkError = nil } }
        )
    }

    private func handleIncomingURL(_ url: URL) {
        do {
            let code = try inviteRouter.roomCode(from: url)
            if flow.roomCode == code { path.removeAll(); return }
            path = [.join(code: code, scanImmediately: false)]
        } catch {
            linkError = "That invite link is not valid. Enter the room code manually."
        }
    }

    private func openRoom(_ credentials: SeatCredentials) {
        Task {
            await flow.open(credentials)
            path.removeAll()
        }
    }
}

private struct CreateRoomView: View {
    let apiClient: APIClient
    let credentialStore: SeatCredentialStore
    let onReady: (SeatCredentials) -> Void

    @State private var displayName = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section("Your seat") {
                TextField("Your name", text: $displayName)
                    .textContentType(.name)
                    .autocorrectionDisabled()
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .accessibilityLabel("Error: \(errorMessage)")
            }

            Button(isSubmitting ? "Creating…" : "Create room") {
                Task { await createRoom() }
            }
            .disabled(isSubmitting)
        }
        .navigationTitle("Create room")
    }

    @MainActor
    private func createRoom() async {
        guard let name = normalizedDisplayName(displayName) else {
            errorMessage = "Enter a name of 24 characters or fewer."
            return
        }

        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let response = try await apiClient.createRoom(displayName: name)
            let credentials = SeatCredentials(
                code: response.code,
                playerId: response.playerId,
                seatToken: response.seatToken,
                hostToken: response.hostToken
            )
            try await credentialStore.put(credentials)
            onReady(credentials)
        } catch {
            errorMessage = userFacingEntryError(error)
        }
    }
}

private struct RoomSessionHandoffView: View {
    let code: String
    let session: RoomSession

    var body: some View {
        Group {
            if let projection = session.projection {
                if projection.base.roomPhase == .playing || projection.base.roomPhase == .complete {
                    BoardView(session: session)
                } else {
                    LobbyView(session: session)
                }
            } else {
                VStack(spacing: 16) {
                    ProgressView()
                    Text("Opening room \(code)")
                        .font(.headline)

                    switch session.connectionState {
                    case .failed:
                        Text("The room could not connect. Check your network and try again.")
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    case .disconnected:
                        Text("Connection paused. Your saved seat is safe on this device.")
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    default:
                        Text("Connecting securely…")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(24)
            }
        }
        .navigationBarBackButtonHidden()
    }
}

func normalizedDisplayName(_ input: String) -> String? {
    let normalized = input
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .precomposedStringWithCanonicalMapping
    guard
        !normalized.isEmpty,
        normalized.count <= 24,
        normalized.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
    else {
        return nil
    }
    return normalized
}

private func userFacingEntryError(_ error: Error) -> String {
    if let apiError = error as? APIClientError {
        return apiError.localizedDescription
    }
    return "The room could not be opened. Try again."
}
