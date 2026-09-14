import Foundation

struct CreateRoomResponse: Equatable, Sendable, Decodable {
    let code: String
    let inviteURL: URL
    let playerId: String
    let seatToken: String
    let hostToken: String

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case code
        case inviteURL = "inviteUrl"
        case playerId
        case seatToken
        case hostToken
    }

    init(from decoder: Decoder) throws {
        try decoder.requireExactKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = try RoomCode.validated(container.decode(String.self, forKey: .code))
        playerId = try container.decodePlayerID(forKey: .playerId)
        seatToken = try container.decodeWorkerToken(forKey: .seatToken)
        hostToken = try container.decodeWorkerToken(forKey: .hostToken)
        let decodedInviteURLString = try container.decode(String.self, forKey: .inviteURL)
        guard
            !decodedInviteURLString.contains(seatToken),
            !decodedInviteURLString.contains(hostToken),
            let decodedInviteURL = URL(string: decodedInviteURLString),
            let components = URLComponents(
                url: decodedInviteURL,
                resolvingAgainstBaseURL: false
            ),
            let scheme = components.scheme?.lowercased(),
            ["http", "https"].contains(scheme),
            components.host != nil,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil,
            components.path == "/room/\(code)"
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .inviteURL,
                in: container,
                debugDescription: "Expected an absolute room invite URL"
            )
        }
        inviteURL = decodedInviteURL
    }
}

struct JoinRoomResponse: Equatable, Sendable, Decodable {
    let code: String
    let playerId: String
    let seatToken: String

    init(code: String, playerId: String, seatToken: String) {
        self.code = code
        self.playerId = playerId
        self.seatToken = seatToken
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case code
        case playerId
        case seatToken
    }

    init(from decoder: Decoder) throws {
        try decoder.requireExactKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = try RoomCode.validated(container.decode(String.self, forKey: .code))
        playerId = try container.decodePlayerID(forKey: .playerId)
        seatToken = try container.decodeWorkerToken(forKey: .seatToken)
    }
}

struct TicketResponse: Equatable, Sendable, Decodable {
    let ticket: String
    let expiresAt: Int64

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case ticket
        case expiresAt
    }

    init(ticket: String, expiresAt: Int64) {
        self.ticket = ticket
        self.expiresAt = expiresAt
    }

    init(from decoder: Decoder) throws {
        try decoder.requireExactKeys(CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ticket = try container.decodeWorkerToken(forKey: .ticket)
        expiresAt = try container.decode(Int64.self, forKey: .expiresAt)
        guard expiresAt > 0 else {
            throw DecodingError.dataCorruptedError(
                forKey: .expiresAt,
                in: container,
                debugDescription: "Ticket expiry must be positive"
            )
        }
    }
}

enum APIClientError: Error, Equatable, Sendable, CustomStringConvertible, LocalizedError {
    case invalidRoomCode
    case transport
    case server(status: Int, code: String)
    case invalidResponse

    var status: Int? {
        guard case let .server(status, _) = self else { return nil }
        return status
    }

    var code: String? {
        guard case let .server(_, code) = self else { return nil }
        return code
    }

    var description: String {
        switch self {
        case .invalidRoomCode:
            return "Invalid room code."
        case .transport:
            return "Network request failed."
        case let .server(status, code):
            return Self.serverMessage(status: status, code: code)
        case .invalidResponse:
            return "The server returned an incompatible response."
        }
    }

    var errorDescription: String? { description }

    private static func serverMessage(status: Int, code: String) -> String {
        switch code {
        case "room_unavailable":
            return "Room not found or expired."
        case "room_locked":
            return "Room is locked."
        case "room_in_progress":
            return "The game is in progress; join as a spectator."
        case "room_full":
            return "Room has reached maximum capacity."
        case "unauthorized":
            return "Authentication failed."
        case "invalid_request":
            return "The request was invalid."
        default:
            return "Request failed with status \(status)."
        }
    }
}

struct APIClient: Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        encoder = JSONEncoder()
        decoder = JSONDecoder()
    }

    func createRoom(displayName: String) async throws -> CreateRoomResponse {
        let body = CreateRoomRequest(displayName: displayName)
        let request = try jsonRequest(path: ["api", "rooms"], body: body)
        return try await perform(request)
    }

    func joinRoom(
        code: String,
        displayName: String,
        asSpectator: Bool
    ) async throws -> JoinRoomResponse {
        let normalizedCode: String
        do {
            normalizedCode = try RoomCode.normalizedAndValidated(code)
        } catch {
            throw APIClientError.invalidRoomCode
        }

        let body = JoinRoomRequest(displayName: displayName, asSpectator: asSpectator)
        let request = try jsonRequest(
            path: ["api", "rooms", normalizedCode, "join"],
            body: body
        )
        return try await perform(request)
    }

    func requestTicket(credentials: SeatCredentials) async throws -> TicketResponse {
        let normalizedCode: String
        do {
            normalizedCode = try RoomCode.normalizedAndValidated(credentials.code)
        } catch {
            throw APIClientError.invalidRoomCode
        }

        var request = URLRequest(url: endpoint(path: ["api", "rooms", normalizedCode, "tickets"]))
        request.httpMethod = "POST"
        request.setValue("Bearer \(credentials.seatToken)", forHTTPHeaderField: "Authorization")
        if let hostToken = credentials.hostToken {
            request.setValue(hostToken, forHTTPHeaderField: "X-Cipher-Host-Token")
        }
        return try await perform(request)
    }

    private func jsonRequest<Body: Encodable>(path: [String], body: Body) throws -> URLRequest {
        var request = URLRequest(url: endpoint(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        return request
    }

    private func endpoint(path: [String]) -> URL {
        path.reduce(baseURL) { url, component in
            url.appendingPathComponent(component, isDirectory: false)
        }
    }

    private func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIClientError.transport
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data)
            throw APIClientError.server(
                status: httpResponse.statusCode,
                code: Self.safeServerCode(envelope?.error.code)
            )
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIClientError.invalidResponse
        }
    }

    private static func safeServerCode(_ candidate: String?) -> String {
        guard
            let candidate,
            !candidate.isEmpty,
            candidate.count <= 64,
            candidate.unicodeScalars.allSatisfy({
                CharacterSet.lowercaseLetters
                    .union(.decimalDigits)
                    .union(CharacterSet(charactersIn: "_"))
                    .contains($0)
            })
        else {
            return "request_failed"
        }
        return candidate
    }
}

enum RoomCode {
    private static let allowedCharacters = CharacterSet(charactersIn: "0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    static func normalize(_ input: String) -> String {
        let uppercased = input.uppercased()
        let aliased = uppercased
            .replacingOccurrences(of: "O", with: "0")
            .replacingOccurrences(of: "I", with: "1")
            .replacingOccurrences(of: "L", with: "1")
        return String(
            aliased.unicodeScalars.filter {
                $0 != "-" && !CharacterSet.whitespacesAndNewlines.contains($0)
            }
        )
    }

    static func normalizedAndValidated(_ input: String) throws -> String {
        try validated(normalize(input))
    }

    static func validated(_ code: String) throws -> String {
        guard
            code.unicodeScalars.count == 6,
            code.unicodeScalars.allSatisfy(allowedCharacters.contains)
        else {
            throw APIClientError.invalidRoomCode
        }
        return code
    }
}

enum WorkerContractValue {
    static func isPlayerID(_ value: String) -> Bool {
        guard let uuid = UUID(uuidString: value) else { return false }
        return uuid.uuidString.lowercased() == value
    }

    static func isToken(_ value: String) -> Bool {
        guard value.utf8.count == 43 else { return false }
        return value.utf8.allSatisfy { byte in
            switch byte {
            case 48...57, 65...90, 97...122, 45, 95:
                return true
            default:
                return false
            }
        }
    }
}

private struct CreateRoomRequest: Encodable {
    let displayName: String
}

private struct JoinRoomRequest: Encodable {
    let displayName: String
    let asSpectator: Bool
}

private struct APIErrorEnvelope: Decodable {
    struct Payload: Decodable {
        let code: String
    }

    let error: Payload
}

private struct APIResponseCodingKey: CodingKey {
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
    func requireExactKeys<Key>(_ keyType: Key.Type) throws where Key: CodingKey & CaseIterable {
        let container = try container(keyedBy: APIResponseCodingKey.self)
        let expected = Set(Key.allCases.map(\.stringValue))
        let actual = Set(container.allKeys.map(\.stringValue))
        guard actual == expected else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: codingPath, debugDescription: "Unexpected response shape")
            )
        }
    }
}

private extension KeyedDecodingContainer {
    func decodePlayerID(forKey key: Key) throws -> String {
        let value = try decode(String.self, forKey: key)
        guard WorkerContractValue.isPlayerID(value) else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "Expected a canonical UUID"
            )
        }
        return value
    }

    func decodeWorkerToken(forKey key: Key) throws -> String {
        let value = try decode(String.self, forKey: key)
        guard WorkerContractValue.isToken(value) else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "Expected a 32-byte unpadded base64url value"
            )
        }
        return value
    }
}
