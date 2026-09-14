import Foundation

struct RoomProjection: Equatable, Sendable {
    let base: ProjectionBase
    let viewRole: SeatRole
    let key: [String: Ownership]?

    var revision: Int { base.revision }
    var board: PublicBoardProjection? { base.board }

    var serverProjection: ClientProjection? {
        switch viewRole {
        case .operative:
            return .operative(base)
        case .clueGiver:
            guard let key else { return nil }
            return .clueGiver(base: base, key: key)
        case .spectator:
            return .spectator(base)
        case .unassigned:
            return .unassigned(base)
        }
    }

    init(serverProjection: ClientProjection) throws {
        guard Self.containsOnlyPublicCardOwnership(serverProjection.base) else {
            throw ProjectionCacheError.unsafeProjection
        }
        base = serverProjection.base
        viewRole = serverProjection.viewRole
        key = serverProjection.key
    }

    func redacted() -> RoomProjection {
        RoomProjection(base: base, viewRole: viewRole, key: nil)
    }

    fileprivate init(base: ProjectionBase, viewRole: SeatRole, key: [String: Ownership]?) {
        self.base = base
        self.viewRole = viewRole
        self.key = key
    }

    private static func containsOnlyPublicCardOwnership(_ base: ProjectionBase) -> Bool {
        base.board?.cards.allSatisfy { $0.revealed || $0.owner == nil } ?? true
    }
}

struct CachedRoomProjection: Codable, Equatable, Sendable {
    let projection: RoomProjection
    let lastUpdated: Date

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case projection
        case lastUpdated
    }

    init(projection: RoomProjection, lastUpdated: Date) {
        self.projection = projection.redacted()
        self.lastUpdated = lastUpdated
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let payload = try container.decode(RedactedProjectionPayload.self, forKey: .projection)
        projection = RoomProjection(
            base: payload.base,
            viewRole: payload.viewRole,
            key: nil
        )
        lastUpdated = try container.decode(Date.self, forKey: .lastUpdated)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(
            RedactedProjectionPayload(base: projection.base, viewRole: projection.viewRole),
            forKey: .projection
        )
        try container.encode(lastUpdated, forKey: .lastUpdated)
    }
}

private struct RedactedProjectionPayload: Codable {
    let base: ProjectionBase
    let viewRole: SeatRole
}

enum ProjectionCacheError: Error, Equatable, Sendable, CustomStringConvertible {
    case invalidRoomCode
    case unsafeProjection
    case roomMismatch
    case encoding
    case decoding
    case storage

    var description: String {
        switch self {
        case .invalidRoomCode:
            return "Invalid room code."
        case .unsafeProjection:
            return "The projection contains hidden card ownership."
        case .roomMismatch:
            return "The cached projection belongs to a different room."
        case .encoding:
            return "The projection cache could not be encoded."
        case .decoding:
            return "The projection cache is invalid."
        case .storage:
            return "The projection cache could not be accessed."
        }
    }
}

protocol ProjectionCaching: Actor {
    func load(code: String) throws -> CachedRoomProjection?
    func save(_ projection: ClientProjection, lastUpdated: Date) throws
    func delete(code: String) throws
}

struct ProjectionCacheWritePolicy: Equatable, Sendable {
    let protection: FileProtectionType
    let excludedFromBackup: Bool

    static let appPrivate = ProjectionCacheWritePolicy(
        protection: .completeUntilFirstUserAuthentication,
        excludedFromBackup: true
    )
}

protocol ProjectionCacheFileWriting: Sendable {
    func write(_ data: Data, to url: URL, policy: ProjectionCacheWritePolicy) throws
}

final class SystemProjectionCacheFileWriter: ProjectionCacheFileWriting, @unchecked Sendable {
    let fileManager: FileManager

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    func write(_ data: Data, to url: URL, policy: ProjectionCacheWritePolicy) throws {
        try data.write(
            to: url,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
        try fileManager.setAttributes(
            [.protectionKey: policy.protection],
            ofItemAtPath: url.path
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = policy.excludedFromBackup
        var mutableURL = url
        try mutableURL.setResourceValues(values)
    }
}

actor ProjectionCache: ProjectionCaching {
    private let directoryURL: URL
    private let fileManager: FileManager
    private let fileWriter: any ProjectionCacheFileWriting
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(
        directoryURL: URL,
        fileManager: FileManager = .default,
        fileWriter: (any ProjectionCacheFileWriting)? = nil
    ) {
        self.directoryURL = directoryURL
        self.fileManager = fileManager
        self.fileWriter = fileWriter ?? SystemProjectionCacheFileWriter(fileManager: fileManager)
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
    }

    init(fileManager: FileManager = .default) {
        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        self.init(
            directoryURL: applicationSupport.appendingPathComponent(
                "CipherParty/ProjectionCache",
                isDirectory: true
            ),
            fileManager: fileManager
        )
    }

    func load(code: String) throws -> CachedRoomProjection? {
        let code = try normalizedCode(code)
        let fileURL = cacheURL(code: code)
        guard fileManager.fileExists(atPath: fileURL.path) else { return nil }

        let data: Data
        do {
            data = try Data(contentsOf: fileURL)
        } catch {
            throw ProjectionCacheError.storage
        }

        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            !Self.containsKey(named: "key", in: object)
        else {
            throw ProjectionCacheError.unsafeProjection
        }

        let record: CachedRoomProjection
        do {
            record = try decoder.decode(CachedRoomProjection.self, from: data)
        } catch {
            throw ProjectionCacheError.decoding
        }
        guard record.projection.base.code == code else {
            throw ProjectionCacheError.roomMismatch
        }
        guard record.projection.board?.cards.allSatisfy({ $0.revealed || $0.owner == nil }) ?? true else {
            throw ProjectionCacheError.unsafeProjection
        }
        return record
    }

    func save(_ projection: ClientProjection, lastUpdated: Date) throws {
        let code = try normalizedCode(projection.base.code)
        guard projection.base.code == code else {
            throw ProjectionCacheError.roomMismatch
        }
        let redactedBase = try redactedBase(from: projection.base)
        let record = CachedRoomProjection(
            projection: RoomProjection(
                base: redactedBase,
                viewRole: projection.viewRole,
                key: nil
            ),
            lastUpdated: lastUpdated
        )

        let data: Data
        do {
            data = try encoder.encode(record)
        } catch {
            throw ProjectionCacheError.encoding
        }

        do {
            try prepareDirectory()
            let fileURL = cacheURL(code: code)
            try fileWriter.write(data, to: fileURL, policy: .appPrivate)
        } catch {
            throw ProjectionCacheError.storage
        }
    }

    func delete(code: String) throws {
        let fileURL = cacheURL(code: try normalizedCode(code))
        guard fileManager.fileExists(atPath: fileURL.path) else { return }
        do {
            try fileManager.removeItem(at: fileURL)
        } catch {
            throw ProjectionCacheError.storage
        }
    }

    private func prepareDirectory() throws {
        if !fileManager.fileExists(atPath: directoryURL.path) {
            try fileManager.createDirectory(
                at: directoryURL,
                withIntermediateDirectories: true,
                attributes: [
                    .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication
                ]
            )
        }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableDirectoryURL = directoryURL
        try mutableDirectoryURL.setResourceValues(values)
    }

    private func redactedBase(from base: ProjectionBase) throws -> ProjectionBase {
        let data: Data
        do {
            data = try JSONEncoder().encode(base)
        } catch {
            throw ProjectionCacheError.encoding
        }
        guard var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ProjectionCacheError.encoding
        }
        if var board = object["board"] as? [String: Any],
           var cards = board["cards"] as? [[String: Any]] {
            for index in cards.indices where cards[index]["revealed"] as? Bool == false {
                cards[index].removeValue(forKey: "owner")
            }
            board["cards"] = cards
            object["board"] = board
        }
        do {
            return try JSONDecoder().decode(
                ProjectionBase.self,
                from: JSONSerialization.data(withJSONObject: object)
            )
        } catch {
            throw ProjectionCacheError.decoding
        }
    }

    private func cacheURL(code: String) -> URL {
        directoryURL.appendingPathComponent("\(code).json", isDirectory: false)
    }

    private func normalizedCode(_ input: String) throws -> String {
        do {
            return try RoomCode.normalizedAndValidated(input)
        } catch {
            throw ProjectionCacheError.invalidRoomCode
        }
    }

    private static func containsKey(named key: String, in value: Any) -> Bool {
        if let dictionary = value as? [String: Any] {
            return dictionary.keys.contains(key)
                || dictionary.values.contains { containsKey(named: key, in: $0) }
        }
        if let array = value as? [Any] {
            return array.contains { containsKey(named: key, in: $0) }
        }
        return false
    }
}
