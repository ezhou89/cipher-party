import Foundation

struct RoomSocketEvent: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case connecting
        case open
        case reconnecting(attempt: Int, delay: TimeInterval)
        case message(ServerMessage)
        case incompatibleMessage
        case terminalFailure(RoomSocketFailure)
        case closed(RoomSocketCloseReason)
    }

    /// A nil generation is reserved for lifecycle events emitted before the
    /// first socket attempt and for test transports that do not model socket
    /// generations. URLSession-backed events always carry a generation.
    let kind: Kind
    let generation: UInt64?

    private init(kind: Kind, generation: UInt64?) {
        self.kind = kind
        self.generation = generation
    }

    static var connecting: Self { Self(kind: .connecting, generation: nil) }
    static func connecting(generation: UInt64) -> Self {
        Self(kind: .connecting, generation: generation)
    }

    static var open: Self { Self(kind: .open, generation: nil) }
    static func open(generation: UInt64) -> Self {
        Self(kind: .open, generation: generation)
    }

    static func reconnecting(attempt: Int, delay: TimeInterval) -> Self {
        Self(kind: .reconnecting(attempt: attempt, delay: delay), generation: nil)
    }

    static func reconnecting(attempt: Int, delay: TimeInterval, generation: UInt64) -> Self {
        Self(kind: .reconnecting(attempt: attempt, delay: delay), generation: generation)
    }

    static func message(_ message: ServerMessage) -> Self {
        Self(kind: .message(message), generation: nil)
    }

    static func message(_ message: ServerMessage, generation: UInt64) -> Self {
        Self(kind: .message(message), generation: generation)
    }

    static var incompatibleMessage: Self {
        Self(kind: .incompatibleMessage, generation: nil)
    }

    static func incompatibleMessage(generation: UInt64) -> Self {
        Self(kind: .incompatibleMessage, generation: generation)
    }

    static func terminalFailure(_ failure: RoomSocketFailure) -> Self {
        Self(kind: .terminalFailure(failure), generation: nil)
    }

    static func terminalFailure(_ failure: RoomSocketFailure, generation: UInt64) -> Self {
        Self(kind: .terminalFailure(failure), generation: generation)
    }

    static func closed(_ reason: RoomSocketCloseReason) -> Self {
        Self(kind: .closed(reason), generation: nil)
    }

    static func closed(_ reason: RoomSocketCloseReason, generation: UInt64) -> Self {
        Self(kind: .closed(reason), generation: generation)
    }
}

enum RoomSocketFailure: Error, Equatable, Sendable, CustomStringConvertible {
    case authentication
    case roomUnavailable
    case incompatibleResponse
    case configuration

    var description: String {
        switch self {
        case .authentication:
            return "Room authentication failed."
        case .roomUnavailable:
            return "The room is unavailable."
        case .incompatibleResponse:
            return "The server returned an incompatible response."
        case .configuration:
            return "The room connection is not configured correctly."
        }
    }
}

enum RoomSocketCloseReason: Equatable, Sendable {
    case userInitiated
    case background
    case unavailablePath
}

enum RoomSocketCloseCode: Int, Equatable, Sendable {
    case normalClosure = 1_000
    case goingAway = 1_001
}

enum RoomWebSocketFrame: Equatable, Sendable {
    case string(String)
    case data(Data)
}

enum RoomWebSocketTransportError: Error, Equatable, Sendable {
    case transport
    case closed(code: Int)
}

enum RoomSocketSendError: Error, Equatable, Sendable {
    case notConnected
    case encoding
    case transport
}

protocol RoomTicketProviding: Sendable {
    func requestTicket(credentials: SeatCredentials) async throws -> TicketResponse
}

extension APIClient: RoomTicketProviding {}

protocol RoomSocketClock: Sendable {
    func nowMilliseconds() async -> Int64
    func sleep(for seconds: TimeInterval) async throws
}

struct SystemRoomSocketClock: RoomSocketClock {
    func nowMilliseconds() async -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1_000)
    }

    func sleep(for seconds: TimeInterval) async throws {
        let nanoseconds = UInt64(max(0, seconds) * 1_000_000_000)
        try await Task.sleep(nanoseconds: nanoseconds)
    }
}

protocol RoomWebSocketConnection: Sendable {
    func connect() async throws
    func receive() async throws -> RoomWebSocketFrame
    func send(text: String) async throws
    func close(code: RoomSocketCloseCode) async
}

protocol RoomWebSocketFactory: Sendable {
    func makeConnection(url: URL) async throws -> any RoomWebSocketConnection
}

struct URLSessionRoomWebSocketFactory: RoomWebSocketFactory {
    let configuration: URLSessionConfiguration

    init(configuration: URLSessionConfiguration = .default) {
        self.configuration = configuration
    }

    func makeConnection(url: URL) async throws -> any RoomWebSocketConnection {
        URLSessionRoomWebSocketConnection(url: url, configuration: configuration)
    }
}

actor RoomSocket {
    private enum AttemptError: Error {
        case expiredTicket
        case ticketRejected
        case incompatibleMessage
    }

    private static let retryDelays: [TimeInterval] = [0.5, 1, 2, 5]

    private let credentials: SeatCredentials
    private let webSocketBaseURL: URL
    private let allowsLoopbackWebSocket: Bool
    private let ticketProvider: any RoomTicketProviding
    private let webSocketFactory: any RoomWebSocketFactory
    private let clock: any RoomSocketClock
    private let pathMonitor: any NetworkPathMonitoring
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private let stream: AsyncStream<RoomSocketEvent>
    private let continuation: AsyncStream<RoomSocketEvent>.Continuation

    private var lifecycleTask: Task<Void, Never>?
    private var pathTask: Task<Void, Never>?
    private var connection: (any RoomWebSocketConnection)?
    private var connectionIsOpen = false
    private var generation: UInt64 = 0
    private var pathStatus: NetworkPathStatus
    private var started = false
    private var foreground = true
    private var terminal = false
    private var attemptedConnection = false

    init(
        credentials: SeatCredentials,
        webSocketBaseURL: URL,
        allowsLoopbackWebSocket: Bool = false,
        ticketProvider: any RoomTicketProviding,
        webSocketFactory: any RoomWebSocketFactory = URLSessionRoomWebSocketFactory(),
        clock: any RoomSocketClock = SystemRoomSocketClock(),
        pathMonitor: any NetworkPathMonitoring = NetworkPathMonitor()
    ) {
        self.credentials = credentials
        self.webSocketBaseURL = webSocketBaseURL
        self.allowsLoopbackWebSocket = allowsLoopbackWebSocket
        self.ticketProvider = ticketProvider
        self.webSocketFactory = webSocketFactory
        self.clock = clock
        self.pathMonitor = pathMonitor
        pathStatus = pathMonitor.currentStatus()
        let pair = AsyncStream<RoomSocketEvent>.makeStream()
        stream = pair.stream
        continuation = pair.continuation
    }

    init(
        credentials: SeatCredentials,
        environment: AppEnvironment,
        apiClient: APIClient,
        webSocketFactory: any RoomWebSocketFactory = URLSessionRoomWebSocketFactory(),
        clock: any RoomSocketClock = SystemRoomSocketClock(),
        pathMonitor: any NetworkPathMonitoring = NetworkPathMonitor()
    ) {
        self.init(
            credentials: credentials,
            webSocketBaseURL: environment.webSocketBaseURL,
            allowsLoopbackWebSocket: environment.allowsLoopbackWebSocket,
            ticketProvider: apiClient,
            webSocketFactory: webSocketFactory,
            clock: clock,
            pathMonitor: pathMonitor
        )
    }

    func events() -> AsyncStream<RoomSocketEvent> {
        stream
    }

    func start() {
        guard !started else { return }
        started = true
        foreground = true
        terminal = false
        pathStatus = pathMonitor.currentStatus()
        continuation.yield(.connecting)
        guard isAllowedWebSocketBaseURL(webSocketBaseURL) else {
            terminal = true
            continuation.yield(.terminalFailure(.configuration))
            return
        }
        observePathIfNeeded()
        launchConnectionLoopIfPossible()
    }

    func close() async {
        guard started || lifecycleTask != nil || connection != nil else { return }
        started = false
        terminal = false
        generation &+= 1
        let closeGeneration = generation
        lifecycleTask?.cancel()
        lifecycleTask = nil
        pathTask?.cancel()
        pathTask = nil
        let openConnection = connection
        connection = nil
        connectionIsOpen = false
        await openConnection?.close(code: .normalClosure)
        continuation.yield(.closed(.userInitiated, generation: closeGeneration))
    }

    func didEnterBackground() async -> UInt64 {
        guard started, foreground else { return generation }
        foreground = false
        generation &+= 1
        let backgroundGeneration = generation
        lifecycleTask?.cancel()
        lifecycleTask = nil
        let openConnection = connection
        connection = nil
        connectionIsOpen = false
        await openConnection?.close(code: .goingAway)
        continuation.yield(.closed(.background, generation: backgroundGeneration))
        return backgroundGeneration
    }

    @discardableResult
    func willEnterForeground() -> UInt64 {
        guard started, !foreground, !terminal else { return generation }
        foreground = true
        pathStatus = pathMonitor.currentStatus()
        launchConnectionLoopIfPossible()
        return generation
    }

    func send(_ command: CommandEnvelope) async throws {
        guard let connection else { throw RoomSocketSendError.notConnected }
        let data: Data
        do {
            data = try encoder.encode(command)
        } catch {
            throw RoomSocketSendError.encoding
        }
        do {
            try await connection.send(text: String(decoding: data, as: UTF8.self))
        } catch {
            throw RoomSocketSendError.transport
        }
    }

    private func observePathIfNeeded() {
        guard pathTask == nil else { return }
        let updates = pathMonitor.statusUpdates()
        pathTask = Task { [weak self] in
            for await status in updates {
                guard !Task.isCancelled else { return }
                await self?.pathDidChange(status)
            }
        }
    }

    private func pathDidChange(_ status: NetworkPathStatus) async {
        guard pathStatus != status else { return }
        pathStatus = status

        switch status {
        case .unavailable:
            guard
                started,
                !connectionIsOpen,
                lifecycleTask != nil || connection != nil
            else {
                return
            }
            generation &+= 1
            let unavailableGeneration = generation
            lifecycleTask?.cancel()
            lifecycleTask = nil
            let openConnection = connection
            connection = nil
            connectionIsOpen = false
            await openConnection?.close(code: .goingAway)
            continuation.yield(.closed(.unavailablePath, generation: unavailableGeneration))
        case .usable:
            launchConnectionLoopIfPossible()
        }
    }

    @discardableResult
    private func launchConnectionLoopIfPossible() -> UInt64? {
        guard
            started,
            foreground,
            !terminal,
            pathStatus == .usable,
            lifecycleTask == nil
        else {
            return nil
        }

        generation &+= 1
        let loopGeneration = generation
        if attemptedConnection {
            continuation.yield(.reconnecting(attempt: 0, delay: 0, generation: loopGeneration))
        }
        lifecycleTask = Task { [weak self] in
            await self?.runConnectionLoop(generation: loopGeneration)
        }
        return loopGeneration
    }

    private func runConnectionLoop(generation loopGeneration: UInt64) async {
        var consecutiveFailures = 0

        while shouldContinue(generation: loopGeneration) {
            do {
                attemptedConnection = true
                let ticket = try await ticketProvider.requestTicket(credentials: credentials)
                try ensureCurrent(generation: loopGeneration)

                let now = await clock.nowMilliseconds()
                guard ticket.expiresAt > now else {
                    throw AttemptError.expiredTicket
                }

                let url = try connectionURL(ticket: ticket.ticket)
                let candidate = try await webSocketFactory.makeConnection(url: url)
                guard shouldContinue(generation: loopGeneration) else {
                    await candidate.close(code: .goingAway)
                    return
                }

                connection = candidate
                connectionIsOpen = false
                try await candidate.connect()
                try ensureCurrent(generation: loopGeneration)
                connectionIsOpen = true
                continuation.yield(.open(generation: loopGeneration))
                consecutiveFailures = 0
                try await receiveMessages(from: candidate, generation: loopGeneration)
                throw RoomWebSocketTransportError.transport
            } catch {
                guard shouldContinue(generation: loopGeneration) else {
                    finishLoop(generation: loopGeneration)
                    return
                }

                let failedConnection = connection
                connection = nil
                connectionIsOpen = false
                await failedConnection?.close(code: .goingAway)

                if let failure = terminalFailure(for: error) {
                    terminal = true
                    continuation.yield(.terminalFailure(failure, generation: loopGeneration))
                    finishLoop(generation: loopGeneration)
                    return
                }

                guard pathStatus == .usable else {
                    continuation.yield(.closed(.unavailablePath, generation: loopGeneration))
                    finishLoop(generation: loopGeneration)
                    return
                }

                consecutiveFailures += 1
                let delay = Self.retryDelays[
                    min(consecutiveFailures - 1, Self.retryDelays.count - 1)
                ]
                continuation.yield(
                    .reconnecting(
                        attempt: consecutiveFailures,
                        delay: delay,
                        generation: loopGeneration
                    )
                )
                do {
                    try await clock.sleep(for: delay)
                } catch {
                    finishLoop(generation: loopGeneration)
                    return
                }
            }
        }

        finishLoop(generation: loopGeneration)
    }

    private func receiveMessages(
        from connection: any RoomWebSocketConnection,
        generation loopGeneration: UInt64
    ) async throws {
        while shouldContinue(generation: loopGeneration) {
            let frame = try await connection.receive()
            try ensureCurrent(generation: loopGeneration)
            let data: Data
            switch frame {
            case let .string(string):
                data = Data(string.utf8)
            case let .data(receivedData):
                data = receivedData
            }

            guard let message = try? decoder.decode(ServerMessage.self, from: data) else {
                continuation.yield(.incompatibleMessage(generation: loopGeneration))
                throw AttemptError.incompatibleMessage
            }
            if message.serverErrorCode == .ticketExpired {
                throw AttemptError.ticketRejected
            }
            continuation.yield(.message(message, generation: loopGeneration))
        }
    }

    private func connectionURL(ticket: String) throws -> URL {
        guard
            WorkerContractValue.isToken(ticket),
            let code = try? RoomCode.normalizedAndValidated(credentials.code),
            var components = URLComponents(
                url: webSocketBaseURL,
                resolvingAgainstBaseURL: false
            ),
            let scheme = components.scheme?.lowercased(),
            isAllowedScheme(scheme, host: components.host),
            components.host != nil,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil
        else {
            throw RoomSocketFailure.configuration
        }

        let basePath = components.path.split(separator: "/").map(String.init)
        components.path = ([""] + basePath + ["api", "rooms", code, "connect"])
            .joined(separator: "/")
        components.queryItems = [URLQueryItem(name: "ticket", value: ticket)]
        guard let url = components.url else { throw RoomSocketFailure.configuration }
        return url
    }

    private func isAllowedWebSocketBaseURL(_ url: URL) -> Bool {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            isAllowedScheme(components.scheme?.lowercased(), host: components.host),
            components.host != nil,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil
        else {
            return false
        }
        return true
    }

    private func isAllowedScheme(_ scheme: String?, host: String?) -> Bool {
        if scheme == "wss" { return true }
        guard allowsLoopbackWebSocket, scheme == "ws", let host else { return false }
        return ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host.lowercased())
    }

    private func terminalFailure(for error: Error) -> RoomSocketFailure? {
        if let failure = error as? RoomSocketFailure {
            return failure
        }
        guard let apiError = error as? APIClientError else { return nil }
        switch apiError {
        case .invalidRoomCode:
            return .configuration
        case .invalidResponse:
            return .incompatibleResponse
        case .transport:
            return nil
        case let .server(status, code):
            if code == "unauthorized" || status == 401 || status == 403 {
                return .authentication
            }
            if (400..<500).contains(status), status != 408, status != 429 {
                return .roomUnavailable
            }
            return nil
        }
    }

    private func shouldContinue(generation loopGeneration: UInt64) -> Bool {
        generation == loopGeneration
            && started
            && foreground
            && !terminal
            && !Task.isCancelled
    }

    private func ensureCurrent(generation loopGeneration: UInt64) throws {
        guard shouldContinue(generation: loopGeneration) else {
            throw CancellationError()
        }
    }

    private func finishLoop(generation loopGeneration: UInt64) {
        guard generation == loopGeneration else { return }
        lifecycleTask = nil
    }
}

final class URLSessionRoomWebSocketConnection:
    NSObject,
    RoomWebSocketConnection,
    URLSessionWebSocketDelegate,
    @unchecked Sendable
{
    typealias TaskFactory = @Sendable (URLSession, URL) -> URLSessionWebSocketTask

    private let url: URL
    private let configuration: URLSessionConfiguration
    private let beforeTaskInstallation: @Sendable () async -> Void
    private let taskFactory: TaskFactory
    private let lock = NSLock()
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var connectContinuation: CheckedContinuation<Void, Error>?
    private var opened = false
    private var closed = false

    init(
        url: URL,
        configuration: URLSessionConfiguration,
        beforeTaskInstallation: @escaping @Sendable () async -> Void = {},
        taskFactory: @escaping TaskFactory = { session, url in
            session.webSocketTask(with: url)
        }
    ) {
        self.url = url
        self.configuration = configuration
        self.beforeTaskInstallation = beforeTaskInstallation
        self.taskFactory = taskFactory
    }

    func connect() async throws {
        try await withTaskCancellationHandler {
            await beforeTaskInstallation()
            try Task.checkCancellation()
            try await withCheckedThrowingContinuation { continuation in
                let taskToResume = lock.withLock { () -> URLSessionWebSocketTask? in
                    guard !closed else { return nil }
                    connectContinuation = continuation
                    let session = URLSession(
                        configuration: configuration,
                        delegate: self,
                        delegateQueue: nil
                    )
                    let task = taskFactory(session, url)
                    self.session = session
                    self.task = task
                    return task
                }
                guard let taskToResume else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                taskToResume.resume()
            }
        } onCancel: {
            self.cancelForTaskCancellation()
        }
    }

    func receive() async throws -> RoomWebSocketFrame {
        guard let task = lock.withLock({ task }) else {
            throw RoomWebSocketTransportError.transport
        }
        do {
            switch try await task.receive() {
            case let .string(value):
                return .string(value)
            case let .data(value):
                return .data(value)
            @unknown default:
                throw RoomWebSocketTransportError.transport
            }
        } catch {
            let code = task.closeCode
            if code != .invalid {
                throw RoomWebSocketTransportError.closed(code: code.rawValue)
            }
            throw RoomWebSocketTransportError.transport
        }
    }

    func send(text: String) async throws {
        guard let task = lock.withLock({ task }) else {
            throw RoomWebSocketTransportError.transport
        }
        do {
            try await task.send(.string(text))
        } catch {
            throw RoomWebSocketTransportError.transport
        }
    }

    func close(code: RoomSocketCloseCode) async {
        let state = lock.withLock {
            () -> (
                URLSessionWebSocketTask?,
                URLSession?,
                CheckedContinuation<Void, Error>?
            ) in
            let state = (task, session, connectContinuation)
            task = nil
            session = nil
            opened = false
            closed = true
            connectContinuation = nil
            return state
        }
        state.2?.resume(throwing: CancellationError())
        if let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code.rawValue) {
            state.0?.cancel(with: closeCode, reason: nil)
        } else {
            state.0?.cancel()
        }
        state.1?.invalidateAndCancel()
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        let continuation = lock.withLock { () -> CheckedContinuation<Void, Error>? in
            opened = true
            let continuation = connectContinuation
            connectContinuation = nil
            return continuation
        }
        continuation?.resume()
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        failPendingConnect(with: .closed(code: closeCode.rawValue))
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard error != nil else { return }
        failPendingConnect(with: .transport)
    }

    private func failPendingConnect(with error: RoomWebSocketTransportError) {
        let continuation = lock.withLock { () -> CheckedContinuation<Void, Error>? in
            guard !opened else { return nil }
            let continuation = connectContinuation
            connectContinuation = nil
            return continuation
        }
        continuation?.resume(throwing: error)
    }

    private func cancelForTaskCancellation() {
        let state = lock.withLock {
            () -> (
                URLSessionWebSocketTask?,
                URLSession?,
                CheckedContinuation<Void, Error>?
            ) in
            let state = (task, session, connectContinuation)
            task = nil
            session = nil
            closed = true
            connectContinuation = nil
            return state
        }
        state.2?.resume(throwing: CancellationError())
        state.0?.cancel(with: .goingAway, reason: nil)
        state.1?.invalidateAndCancel()
    }
}
