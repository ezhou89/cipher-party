import Foundation
import XCTest
@testable import CipherParty

final class RoomSocketTests: XCTestCase {
    private let credentials = SeatCredentials(
        code: "ABC123",
        playerId: "123e4567-e89b-12d3-a456-426614174000",
        seatToken: String(repeating: "s", count: 43),
        hostToken: String(repeating: "h", count: 43)
    )

    func testOpenReceivesDecodedMessagesAndUserCloseStopsWithoutRetry() async throws {
        let expected = ServerMessage.commandResult(
            commandId: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!,
            result: .success(revision: 3)
        )
        let connection = FakeRoomWebSocketConnection(
            receiveSteps: [.string(try encodedString(expected)), .wait]
        )
        let harness = makeHarness(connections: [connection])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.contains(.message(expected)) }
        await harness.socket.close()
        try await waitUntil { await recorder.contains(.closed(.userInitiated)) }

        let events = await recorder.snapshot()
        let closeCodes = await connection.closeCodes()
        let sleeps = await harness.clock.recordedSleeps()
        let ticketRequests = await harness.tickets.requestCount()
        let urls = await harness.factory.requestedURLs()
        XCTAssertEqual(Array(events.prefix(3)).map(\.kind), [.connecting, .open, .message(expected)])
        XCTAssertEqual(closeCodes, [.normalClosure])
        XCTAssertEqual(sleeps, [])
        XCTAssertEqual(ticketRequests, 1)

        let url = try XCTUnwrap(urls.first)
        XCTAssertEqual(url.path, "/api/rooms/ABC123/connect")
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems, [
            URLQueryItem(name: "ticket", value: Self.ticketA)
        ])
        XCTAssertFalse(url.absoluteString.contains(credentials.seatToken))
        XCTAssertFalse(url.absoluteString.contains(credentials.hostToken!))
    }

    func testSendUsesATextFrameContainingTheExactCommandEnvelope() async throws {
        let connection = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(connections: [connection])
        let recorder = await recordEvents(from: harness.socket)
        let envelope = CommandEnvelope(
            commandId: UUID(uuidString: "00000000-0000-4000-8000-000000000003")!,
            expectedRevision: 9,
            command: .lockRoom(locked: true)
        )

        await harness.socket.start()
        try await waitUntil { await recorder.contains(.open) }
        try await harness.socket.send(envelope)

        let textFrames = await connection.sentTextFrames()
        let text = try XCTUnwrap(textFrames.first)
        XCTAssertEqual(textFrames.count, 1)
        XCTAssertEqual(
            try JSONDecoder().decode(CommandEnvelope.self, from: Data(text.utf8)),
            envelope
        )
        await harness.socket.close()
    }

    func testCloseBeforeURLSessionTaskInstallationPreventsLateSocketStart() async {
        let gate = AsyncGate()
        let installations = LockedCounter()
        let connection = URLSessionRoomWebSocketConnection(
            url: URL(string: "wss://example.com/api/rooms/ABC123/connect")!,
            configuration: .ephemeral,
            beforeTaskInstallation: {
                await gate.suspend()
            },
            taskFactory: { session, url in
                installations.increment()
                return session.webSocketTask(with: url)
            }
        )

        let connectTask = Task {
            try await connection.connect()
        }
        await gate.waitUntilSuspended()
        await connection.close(code: .goingAway)
        await gate.release()

        switch await connectTask.result {
        case .success:
            XCTFail("A closed transport must not finish connecting")
        case let .failure(error):
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertEqual(installations.value(), 0)
    }

    func testPlaintextWebSocketBaseURLIsRejectedBeforeTicketOrSocketUse() async throws {
        let connection = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(
            connections: [connection],
            webSocketBaseURL: URL(string: "ws://example.com")!
        )
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.contains(.terminalFailure(.configuration)) }

        let ticketRequests = await harness.tickets.requestCount()
        let urls = await harness.factory.requestedURLs()
        XCTAssertEqual(ticketRequests, 0)
        XCTAssertEqual(urls, [])
    }

    func testMalformedFrameProducesSafeFailureAndFreshConnection() async throws {
        let expected = ServerMessage.commandResult(
            commandId: UUID(uuidString: "00000000-0000-4000-8000-000000000002")!,
            result: .failure(revision: 7, code: .wrongPhase, message: "Wait for guessing")
        )
        let connection = FakeRoomWebSocketConnection(
            receiveSteps: [
                .string(#"{"type":"future","secret":"raw-frame-secret"}"#),
                .wait
            ]
        )
        let recovered = FakeRoomWebSocketConnection(receiveSteps: [.string(try encodedString(expected)), .wait])
        let harness = makeHarness(connections: [connection, recovered])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.contains(.message(expected)) }

        let events = await recorder.snapshot()
        let receives = await connection.receiveCount()
        XCTAssertTrue(events.contains { $0.kind == .incompatibleMessage })
        XCTAssertEqual(receives, 1)
        XCTAssertFalse(String(describing: events).contains("raw-frame-secret"))
        await harness.socket.close()
    }

    func testActualDebugConfigurationCanOpenLoopbackSocketOnly() async throws {
        let environment = try AppEnvironment.production(bundle: Bundle.main)
        if environment.deployment == .debug {
            XCTAssertEqual(environment.apiBaseURL.absoluteString, "http://127.0.0.1:8787")
            XCTAssertTrue(environment.allowsLoopbackWebSocket)
        } else {
            XCTAssertFalse(environment.allowsLoopbackWebSocket)
        }
        let connection = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(connections: [connection], webSocketBaseURL: URL(string: "ws://127.0.0.1:8787")!, allowsLoopbackWebSocket: true)
        let recorder = await recordEvents(from: harness.socket)
        await harness.socket.start()
        try await waitUntil { await recorder.contains(.open) }
        let urls = await harness.factory.requestedURLs()
        XCTAssertEqual(urls.first?.scheme, "ws")
        await harness.socket.close()
    }

    func testDebugExceptionNeverAllowsRemotePlaintextSocket() async throws {
        let connection = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(connections: [connection], webSocketBaseURL: URL(string: "ws://example.com")!, allowsLoopbackWebSocket: true)
        let recorder = await recordEvents(from: harness.socket)
        await harness.socket.start()
        try await waitUntil { await recorder.contains(.terminalFailure(.configuration)) }
        let ticketRequests = await harness.tickets.requestCount()
        XCTAssertEqual(ticketRequests, 0)
        await harness.socket.close()
    }

    func testExpiredTicketIsNeverOpenedAndNextAttemptUsesAFreshTicket() async throws {
        let tickets = FakeTicketProvider(steps: [
            .success(TicketResponse(ticket: Self.ticketA, expiresAt: 1_000)),
            .success(TicketResponse(ticket: Self.ticketB, expiresAt: 61_000))
        ])
        let connection = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(
            tickets: tickets,
            connections: [connection],
            nowMilliseconds: 1_000
        )
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.contains(.open) }

        let ticketRequests = await tickets.requestCount()
        let sleeps = await harness.clock.recordedSleeps()
        let urls = await harness.factory.requestedURLs()
        XCTAssertEqual(ticketRequests, 2)
        XCTAssertEqual(sleeps, [0.5])
        XCTAssertEqual(urls.count, 1)
        XCTAssertTrue(try XCTUnwrap(urls.first?.query).contains(Self.ticketB))
        XCTAssertFalse(try XCTUnwrap(urls.first?.query).contains(Self.ticketA))
        await harness.socket.close()
    }

    func testRepeatedConnectionFailuresUseBoundedBackoffAndFreshTickets() async throws {
        let failed = (0..<5).map { _ in
            FakeRoomWebSocketConnection(connectError: .transport, receiveSteps: [])
        }
        let open = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let tickets = FakeTicketProvider(steps: (0..<6).map { index in
            .success(TicketResponse(ticket: Self.ticket(index), expiresAt: 61_000))
        })
        let harness = makeHarness(tickets: tickets, connections: failed + [open])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.contains(.open) }

        let sleeps = await harness.clock.recordedSleeps()
        let ticketRequests = await tickets.requestCount()
        let urls = await harness.factory.requestedURLs()
        XCTAssertEqual(sleeps, [0.5, 1, 2, 5, 5])
        XCTAssertEqual(ticketRequests, 6)
        XCTAssertEqual(urls.count, 6)
        XCTAssertEqual(Set(urls.compactMap(\.query)).count, 6)
        await harness.socket.close()
    }

    func testUnauthorizedTicketFailureIsTerminalAndDoesNotRetry() async throws {
        let tickets = FakeTicketProvider(steps: [
            .failure(.server(status: 401, code: "unauthorized"))
        ])
        let harness = makeHarness(tickets: tickets, connections: [])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.contains(.terminalFailure(.authentication)) }

        let ticketRequests = await tickets.requestCount()
        let sleeps = await harness.clock.recordedSleeps()
        let urls = await harness.factory.requestedURLs()
        XCTAssertEqual(ticketRequests, 1)
        XCTAssertEqual(sleeps, [])
        XCTAssertEqual(urls, [])
    }

    func testUnavailableRoomTicketFailureIsTerminalAndDoesNotRetry() async throws {
        let tickets = FakeTicketProvider(steps: [
            .failure(.server(status: 404, code: "room_unavailable"))
        ])
        let harness = makeHarness(tickets: tickets, connections: [])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.contains(.terminalFailure(.roomUnavailable)) }

        let ticketRequests = await tickets.requestCount()
        let sleeps = await harness.clock.recordedSleeps()
        XCTAssertEqual(ticketRequests, 1)
        XCTAssertEqual(sleeps, [])
    }

    func testServerTicketExpirySchedulesExactlyOneRetryAndFreshReceiveLoop() async throws {
        let expired = FakeRoomWebSocketConnection(
            receiveSteps: [
                .string(#"{"type":"error","code":"ticket_expired","message":"Ticket expired"}"#),
                .failure(.closed(code: 1006))
            ]
        )
        let replacement = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(connections: [expired, replacement])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await harness.factory.requestedURLs().count == 2 }
        try await waitUntil { await recorder.openCount() == 2 }

        let sleeps = await harness.clock.recordedSleeps()
        let ticketRequests = await harness.tickets.requestCount()
        let expiredMaximum = await expired.maximumConcurrentReceives()
        let replacementMaximum = await replacement.maximumConcurrentReceives()
        XCTAssertEqual(sleeps, [0.5])
        XCTAssertEqual(ticketRequests, 2)
        XCTAssertEqual(expiredMaximum, 1)
        XCTAssertEqual(replacementMaximum, 1)
        await harness.socket.close()
    }

    func testBackgroundCancelsReceiveAndForegroundReconnectsWithFreshTicket() async throws {
        let first = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let second = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(connections: [first, second])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.openCount() == 1 }
        await harness.socket.didEnterBackground()
        try await waitUntil { await recorder.contains(.closed(.background)) }
        for _ in 0..<20 { await Task.yield() }

        let backgroundTicketRequests = await harness.tickets.requestCount()
        let firstCloseCodes = await first.closeCodes()
        XCTAssertEqual(backgroundTicketRequests, 1)
        XCTAssertEqual(firstCloseCodes, [.goingAway])

        await harness.socket.willEnterForeground()
        try await waitUntil { await recorder.openCount() == 2 }
        let foregroundTicketRequests = await harness.tickets.requestCount()
        XCTAssertEqual(foregroundTicketRequests, 2)
        await harness.socket.close()
    }

    func testUnavailablePathDefersAttemptUntilPathBecomesUsable() async throws {
        let path = FakeNetworkPathMonitor(initialStatus: .unavailable)
        let connection = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(path: path, connections: [connection])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        for _ in 0..<20 { await Task.yield() }
        let unavailableTicketRequests = await harness.tickets.requestCount()
        XCTAssertEqual(unavailableTicketRequests, 0)

        path.send(.usable)
        try await waitUntil { await recorder.contains(.open) }
        let usableTicketRequests = await harness.tickets.requestCount()
        XCTAssertEqual(usableTicketRequests, 1)
        await harness.socket.close()
    }

    func testUnavailablePathDoesNotCloseAnEstablishedSocketOrReconnectOnRecovery() async throws {
        let path = FakeNetworkPathMonitor(initialStatus: .usable)
        let connection = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(path: path, connections: [connection])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.contains(.open) }

        path.send(.unavailable)
        for _ in 0..<20 { await Task.yield() }
        path.send(.usable)
        for _ in 0..<20 { await Task.yield() }

        let closeCodes = await connection.closeCodes()
        let ticketRequests = await harness.tickets.requestCount()
        let openCount = await recorder.openCount()
        XCTAssertEqual(closeCodes, [])
        XCTAssertEqual(ticketRequests, 1)
        XCTAssertEqual(openCount, 1)
        await harness.socket.close()
    }

    func testOneRemoteCloseProducesOneRetryAndNoDuplicateReceiveTasks() async throws {
        let first = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let second = FakeRoomWebSocketConnection(receiveSteps: [.wait])
        let harness = makeHarness(connections: [first, second])
        let recorder = await recordEvents(from: harness.socket)

        await harness.socket.start()
        try await waitUntil { await recorder.openCount() == 1 }
        await first.failPendingReceive(with: .closed(code: 1006))
        try await waitUntil { await recorder.openCount() == 2 }

        let sleeps = await harness.clock.recordedSleeps()
        let urls = await harness.factory.requestedURLs()
        let firstMaximum = await first.maximumConcurrentReceives()
        let secondMaximum = await second.maximumConcurrentReceives()
        XCTAssertEqual(sleeps, [0.5])
        XCTAssertEqual(urls.count, 2)
        XCTAssertEqual(firstMaximum, 1)
        XCTAssertEqual(secondMaximum, 1)
        await harness.socket.close()
    }

    private func makeHarness(
        tickets: FakeTicketProvider? = nil,
        path: FakeNetworkPathMonitor? = nil,
        connections: [FakeRoomWebSocketConnection],
        nowMilliseconds: Int64 = 0,
        webSocketBaseURL: URL = URL(string: "wss://example.com")!,
        allowsLoopbackWebSocket: Bool = false
    ) -> Harness {
        let tickets = tickets ?? FakeTicketProvider(steps: (0..<20).map { index in
            .success(TicketResponse(ticket: Self.ticket(index), expiresAt: 61_000))
        })
        let factory = FakeRoomWebSocketFactory(connections: connections)
        let clock = FakeRoomSocketClock(nowMilliseconds: nowMilliseconds)
        let path = path ?? FakeNetworkPathMonitor(initialStatus: .usable)
        let socket = RoomSocket(
            credentials: credentials,
            webSocketBaseURL: webSocketBaseURL,
            allowsLoopbackWebSocket: allowsLoopbackWebSocket,
            ticketProvider: tickets,
            webSocketFactory: factory,
            clock: clock,
            pathMonitor: path
        )
        return Harness(
            socket: socket,
            tickets: tickets,
            factory: factory,
            clock: clock,
            path: path
        )
    }

    private func recordEvents(from socket: RoomSocket) async -> EventRecorder {
        let recorder = EventRecorder()
        let events = await socket.events()
        Task {
            for await event in events {
                await recorder.append(event)
            }
        }
        return recorder
    }

    private func waitUntil(
        _ condition: @escaping @Sendable () async -> Bool
    ) async throws {
        for _ in 0..<2_000 {
            if await condition() { return }
            await Task.yield()
        }
        throw TestWaitError.timedOut
    }

    private func encodedString(_ message: ServerMessage) throws -> String {
        String(decoding: try JSONEncoder().encode(message), as: UTF8.self)
    }

    private static let ticketA = String(repeating: "a", count: 43)
    private static let ticketB = String(repeating: "b", count: 43)

    private static func ticket(_ index: Int) -> String {
        let scalar = UnicodeScalar(97 + index)!
        return String(repeating: Character(scalar), count: 43)
    }
}

private struct Harness {
    let socket: RoomSocket
    let tickets: FakeTicketProvider
    let factory: FakeRoomWebSocketFactory
    let clock: FakeRoomSocketClock
    let path: FakeNetworkPathMonitor
}

private enum TestWaitError: Error {
    case timedOut
}

private actor AsyncGate {
    private var suspended = false
    private var suspensionWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    func suspend() async {
        suspended = true
        suspensionWaiters.forEach { $0.resume() }
        suspensionWaiters.removeAll()
        await withCheckedContinuation { continuation in
            releaseContinuation = continuation
        }
    }

    func waitUntilSuspended() async {
        if suspended { return }
        await withCheckedContinuation { continuation in
            suspensionWaiters.append(continuation)
        }
    }

    func release() {
        let continuation = releaseContinuation
        releaseContinuation = nil
        continuation?.resume()
    }
}

private final class LockedCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func increment() {
        lock.withLock { count += 1 }
    }

    func value() -> Int {
        lock.withLock { count }
    }
}

private actor EventRecorder {
    private var values: [RoomSocketEvent] = []

    func append(_ event: RoomSocketEvent) {
        values.append(event)
    }

    func snapshot() -> [RoomSocketEvent] {
        values
    }

    func contains(_ event: RoomSocketEvent) -> Bool {
        values.contains { $0.kind == event.kind }
    }

    func openCount() -> Int {
        values.filter { $0.kind == .open }.count
    }
}

private actor FakeTicketProvider: RoomTicketProviding {
    enum Step: Sendable {
        case success(TicketResponse)
        case failure(APIClientError)
    }

    private var steps: [Step]
    private var credentials: [SeatCredentials] = []

    init(steps: [Step]) {
        self.steps = steps
    }

    func requestTicket(credentials: SeatCredentials) async throws -> TicketResponse {
        self.credentials.append(credentials)
        guard !steps.isEmpty else { throw APIClientError.transport }
        switch steps.removeFirst() {
        case let .success(response):
            return response
        case let .failure(error):
            throw error
        }
    }

    func requestCount() -> Int {
        credentials.count
    }
}

private actor FakeRoomSocketClock: RoomSocketClock {
    private let currentMilliseconds: Int64
    private var sleeps: [TimeInterval] = []

    init(nowMilliseconds: Int64) {
        currentMilliseconds = nowMilliseconds
    }

    func nowMilliseconds() -> Int64 {
        currentMilliseconds
    }

    func sleep(for seconds: TimeInterval) async throws {
        try Task.checkCancellation()
        sleeps.append(seconds)
        await Task.yield()
        try Task.checkCancellation()
    }

    func recordedSleeps() -> [TimeInterval] {
        sleeps
    }
}

private final class FakeNetworkPathMonitor: NetworkPathMonitoring, @unchecked Sendable {
    private let lock = NSLock()
    private var status: NetworkPathStatus
    private let stream: AsyncStream<NetworkPathStatus>
    private let continuation: AsyncStream<NetworkPathStatus>.Continuation

    init(initialStatus: NetworkPathStatus) {
        status = initialStatus
        let pair = AsyncStream<NetworkPathStatus>.makeStream()
        stream = pair.stream
        continuation = pair.continuation
    }

    func currentStatus() -> NetworkPathStatus {
        lock.withLock { status }
    }

    func statusUpdates() -> AsyncStream<NetworkPathStatus> {
        stream
    }

    func send(_ status: NetworkPathStatus) {
        lock.withLock { self.status = status }
        continuation.yield(status)
    }
}

private actor FakeRoomWebSocketFactory: RoomWebSocketFactory {
    private var connections: [FakeRoomWebSocketConnection]
    private var urls: [URL] = []

    init(connections: [FakeRoomWebSocketConnection]) {
        self.connections = connections
    }

    func makeConnection(url: URL) async throws -> any RoomWebSocketConnection {
        urls.append(url)
        guard !connections.isEmpty else { throw RoomWebSocketTransportError.transport }
        return connections.removeFirst()
    }

    func requestedURLs() -> [URL] {
        urls
    }
}

private actor FakeRoomWebSocketConnection: RoomWebSocketConnection {
    enum ReceiveStep: @unchecked Sendable {
        case string(String)
        case data(Data)
        case failure(RoomWebSocketTransportError)
        case wait
    }

    private let connectError: RoomWebSocketTransportError?
    private var receiveSteps: [ReceiveStep]
    private var pendingReceive: CheckedContinuation<RoomWebSocketFrame, Error>?
    private var closeValues: [RoomSocketCloseCode] = []
    private var sentTexts: [String] = []
    private var receives = 0
    private var activeReceives = 0
    private var maximumReceives = 0

    init(
        connectError: RoomWebSocketTransportError? = nil,
        receiveSteps: [ReceiveStep]
    ) {
        self.connectError = connectError
        self.receiveSteps = receiveSteps
    }

    func connect() async throws {
        if let connectError { throw connectError }
    }

    func receive() async throws -> RoomWebSocketFrame {
        receives += 1
        activeReceives += 1
        maximumReceives = max(maximumReceives, activeReceives)
        defer { activeReceives -= 1 }

        guard !receiveSteps.isEmpty else { throw RoomWebSocketTransportError.transport }
        switch receiveSteps.removeFirst() {
        case let .string(value):
            return .string(value)
        case let .data(value):
            return .data(value)
        case let .failure(error):
            throw error
        case .wait:
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    pendingReceive = continuation
                }
            } onCancel: {
                Task { await self.cancelPendingReceive() }
            }
        }
    }

    func send(text: String) async throws {
        sentTexts.append(text)
    }

    func close(code: RoomSocketCloseCode) async {
        closeValues.append(code)
        let pending = pendingReceive
        pendingReceive = nil
        pending?.resume(throwing: CancellationError())
    }

    func failPendingReceive(with error: RoomWebSocketTransportError) {
        let pending = pendingReceive
        pendingReceive = nil
        pending?.resume(throwing: error)
    }

    func closeCodes() -> [RoomSocketCloseCode] {
        closeValues
    }

    func receiveCount() -> Int {
        receives
    }

    func maximumConcurrentReceives() -> Int {
        maximumReceives
    }

    func sentTextFrames() -> [String] {
        sentTexts
    }

    private func cancelPendingReceive() {
        let pending = pendingReceive
        pendingReceive = nil
        pending?.resume(throwing: CancellationError())
    }
}
