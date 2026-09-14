import SwiftUI

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
    @State private var roomSession: RoomSession?
    @State private var activeRoomCode: String?
    @State private var linkError: String?

    init(environment: AppEnvironment) {
        self.environment = environment
        let apiClient = APIClient(baseURL: environment.apiBaseURL)
        self.apiClient = apiClient
        credentialStore = SeatCredentialStore(service: environment.keychainServiceName)
        inviteRouter = InviteRouter(customScheme: environment.urlScheme)
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let roomSession, let activeRoomCode {
                    RoomSessionHandoffView(code: activeRoomCode, session: roomSession)
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
            path = [.join(code: code, scanImmediately: false)]
        } catch {
            linkError = "That invite link is not valid. Enter the room code manually."
        }
    }

    private func openRoom(_ credentials: SeatCredentials) {
        let socket = RoomSocket(
            credentials: credentials,
            environment: environment,
            apiClient: apiClient
        )
        let session = RoomSession(
            code: credentials.code,
            socket: socket,
            credentialStore: credentialStore
        )
        activeRoomCode = credentials.code
        roomSession = session
        path.removeAll()
        Task { await session.connect() }
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
        .navigationBarBackButtonHidden()
    }
}

private func normalizedDisplayName(_ input: String) -> String? {
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
