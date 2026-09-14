import Foundation
import XCTest
@testable import CipherParty

final class APIClientTests: XCTestCase {
    override func tearDown() {
        URLProtocolStub.handler = nil
        super.tearDown()
    }

    func testCreateRoomSendsExactRequestAndDecodesStrictResponse() async throws {
        let client = try makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/rooms")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(
                try Self.jsonObject(from: request),
                ["displayName": "Zoë"]
            )
            return Self.response(
                for: request,
                status: 201,
                body: #"{"code":"K7M2X9","inviteUrl":"https://cipher.party/room/K7M2X9","playerId":"player-host","seatToken":"seat-secret","hostToken":"host-secret"}"#
            )
        }

        let response = try await client.createRoom(displayName: "Zoë")

        XCTAssertEqual(response.code, "K7M2X9")
        XCTAssertEqual(response.inviteURL.absoluteString, "https://cipher.party/room/K7M2X9")
        XCTAssertEqual(response.playerId, "player-host")
        XCTAssertEqual(response.seatToken, "seat-secret")
        XCTAssertEqual(response.hostToken, "host-secret")
    }

    func testJoinRoomNormalizesCodeBeforeBuildingPathAndSendsSpectatorChoice() async throws {
        let client = try makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/rooms/001129/join")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(
                try Self.jsonObject(from: request),
                ["asSpectator": true, "displayName": "Guest"]
            )
            return Self.response(
                for: request,
                status: 200,
                body: #"{"code":"001129","playerId":"player-guest","seatToken":"seat-guest"}"#
            )
        }

        let response = try await client.joinRoom(
            code: " o0-iL2 9 ",
            displayName: "Guest",
            asSpectator: true
        )

        XCTAssertEqual(
            response,
            JoinRoomResponse(code: "001129", playerId: "player-guest", seatToken: "seat-guest")
        )
    }

    func testInvalidRoomCodeIsRejectedBeforeARequestCanBeSent() async throws {
        let client = try makeClient { _ in
            XCTFail("Invalid path input must not reach URLSession")
            throw URLError(.badURL)
        }

        do {
            _ = try await client.joinRoom(code: "../../", displayName: "Guest", asSpectator: false)
            XCTFail("Expected invalid room code")
        } catch {
            XCTAssertEqual(error as? APIClientError, .invalidRoomCode)
        }
    }

    func testRequestTicketSendsBearerAndHostTokenWithoutABody() async throws {
        let credentials = SeatCredentials(
            code: "K7M2X9",
            playerId: "player-host",
            seatToken: "seat-secret",
            hostToken: "host-secret"
        )
        let client = try makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/rooms/K7M2X9/tickets")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer seat-secret")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Cipher-Host-Token"), "host-secret")
            XCTAssertNil(request.httpBody)
            return Self.response(
                for: request,
                status: 200,
                body: #"{"ticket":"one-use-ticket","expiresAt":1789350123456}"#
            )
        }

        let response = try await client.requestTicket(credentials: credentials)

        XCTAssertEqual(response, TicketResponse(ticket: "one-use-ticket", expiresAt: 1_789_350_123_456))
    }

    func testRequestTicketOmitsHostHeaderWhenCredentialHasNoHostToken() async throws {
        let credentials = SeatCredentials(
            code: "ABC234",
            playerId: "player-guest",
            seatToken: "guest-secret",
            hostToken: nil
        )
        let client = try makeClient { request in
            XCTAssertNil(request.value(forHTTPHeaderField: "X-Cipher-Host-Token"))
            return Self.response(
                for: request,
                status: 200,
                body: #"{"ticket":"guest-ticket","expiresAt":1789350123456}"#
            )
        }

        _ = try await client.requestTicket(credentials: credentials)
    }

    func testServerFailureMapsStatusAndCodeWithoutExposingResponseOrCredentialTokens() async throws {
        let credentials = SeatCredentials(
            code: "ABC234",
            playerId: "player-host",
            seatToken: "seat-token-must-stay-private",
            hostToken: "host-token-must-stay-private"
        )
        let client = try makeClient { request in
            Self.response(
                for: request,
                status: 401,
                body: #"{"error":{"code":"unauthorized","message":"seat-token-must-stay-private host-token-must-stay-private"}}"#
            )
        }

        do {
            _ = try await client.requestTicket(credentials: credentials)
            XCTFail("Expected server error")
        } catch {
            let apiError = try XCTUnwrap(error as? APIClientError)
            XCTAssertEqual(apiError.status, 401)
            XCTAssertEqual(apiError.code, "unauthorized")
            for output in [String(describing: apiError), apiError.localizedDescription] {
                XCTAssertFalse(output.contains(credentials.seatToken))
                XCTAssertFalse(output.contains(credentials.hostToken!))
                XCTAssertFalse(output.contains("seat-token-must-stay-private"))
                XCTAssertFalse(output.contains("host-token-must-stay-private"))
            }
        }
    }

    func testTransportFailureDoesNotExposeRequestCredentialTokens() async throws {
        let credentials = SeatCredentials(
            code: "ABC234",
            playerId: "player-host",
            seatToken: "seat-transport-secret",
            hostToken: "host-transport-secret"
        )
        let client = try makeClient { _ in
            throw URLError(.networkConnectionLost)
        }

        do {
            _ = try await client.requestTicket(credentials: credentials)
            XCTFail("Expected transport error")
        } catch {
            XCTAssertEqual(error as? APIClientError, .transport)
            XCTAssertFalse(String(describing: error).contains(credentials.seatToken))
            XCTAssertFalse(error.localizedDescription.contains(credentials.hostToken!))
        }
    }

    func testSuccessfulResponseWithUnknownFieldIsRejectedAsIncompatible() async throws {
        let client = try makeClient { request in
            Self.response(
                for: request,
                status: 201,
                body: #"{"code":"K7M2X9","inviteUrl":"https://cipher.party/room/K7M2X9","playerId":"player-host","seatToken":"seat-secret","hostToken":"host-secret","unexpected":true}"#
            )
        }

        do {
            _ = try await client.createRoom(displayName: "Host")
            XCTFail("Expected strict decoding failure")
        } catch {
            XCTAssertEqual(error as? APIClientError, .invalidResponse)
        }
    }

    func testSuccessfulCreateResponseWithRelativeInviteURLIsRejectedAsIncompatible() async throws {
        let client = try makeClient { request in
            Self.response(
                for: request,
                status: 201,
                body: #"{"code":"K7M2X9","inviteUrl":"/room/K7M2X9","playerId":"player-host","seatToken":"seat-secret","hostToken":"host-secret"}"#
            )
        }

        do {
            _ = try await client.createRoom(displayName: "Host")
            XCTFail("Expected strict decoding failure")
        } catch {
            XCTAssertEqual(error as? APIClientError, .invalidResponse)
        }
    }

    private func makeClient(
        handler: @escaping URLProtocolStub.Handler
    ) throws -> APIClient {
        URLProtocolStub.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://api.example.test")),
            session: URLSession(configuration: configuration)
        )
    }

    private static func jsonObject(from request: URLRequest) throws -> NSDictionary {
        let data: Data
        if let body = request.httpBody {
            data = body
        } else {
            let stream = try XCTUnwrap(request.httpBodyStream)
            stream.open()
            defer { stream.close() }

            var collected = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1_024)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let count = stream.read(buffer, maxLength: 1_024)
                guard count >= 0 else {
                    throw try XCTUnwrap(stream.streamError)
                }
                if count == 0 { break }
                collected.append(buffer, count: count)
            }
            data = collected
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }

    private static func response(
        for request: URLRequest,
        status: Int,
        body: String
    ) -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        return (response, Data(body.utf8))
    }
}

private final class URLProtocolStub: URLProtocol, @unchecked Sendable {
    typealias Handler = (URLRequest) throws -> (HTTPURLResponse, Data)

    private static let handlerState = LockedHandler()

    static var handler: Handler? {
        get { handlerState.get() }
        set { handlerState.set(newValue) }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private final class LockedHandler: @unchecked Sendable {
        private let lock = NSLock()
        private var value: Handler?

        func get() -> Handler? {
            lock.lock()
            defer { lock.unlock() }
            return value
        }

        func set(_ newValue: Handler?) {
            lock.lock()
            value = newValue
            lock.unlock()
        }
    }
}
