import Foundation
import XCTest
@testable import CipherParty

final class ProjectionCacheTests: XCTestCase {
    func testClueGiverCacheStripsKeyAndLoadsAUsefulRedactedProjection() async throws {
        let harness = try makeHarness()
        defer { try? FileManager.default.removeItem(at: harness.root) }
        let projection = try fixtureProjection(named: "projection-clue-giver")

        try await harness.cache.save(projection, lastUpdated: Self.savedAt)

        let file = try XCTUnwrap(try cacheFiles(in: harness.root).first)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
        )
        XCTAssertFalse(containsKey(named: "key", in: object))

        let loaded = try await harness.cache.load(code: "abc-234")
        XCTAssertEqual(loaded?.projection.viewRole, .clueGiver)
        XCTAssertEqual(loaded?.projection.revision, 5)
        XCTAssertNil(loaded?.projection.key)
        XCTAssertEqual(loaded?.lastUpdated, Self.savedAt)
    }

    func testCacheRedactsUnrevealedOwnershipFromOperativeAndSpectatorData() async throws {
        let harness = try makeHarness()
        defer { try? FileManager.default.removeItem(at: harness.root) }
        for fixture in ["projection-operative", "projection-spectator"] {
            let forged = try fixtureProjection(named: fixture, unrevealedOwner: .hazard)
            try await harness.cache.save(forged, lastUpdated: Self.savedAt)

            let cached = try await harness.cache.load(code: "ABC234")
            let loaded = try XCTUnwrap(cached)
            let cards = try XCTUnwrap(loaded.projection.board?.cards)
            XCTAssertTrue(cards.filter { !$0.revealed }.allSatisfy { $0.owner == nil })
            XCTAssertEqual(cards.first(where: \.revealed)?.owner, .red)
        }
    }

    func testSeparateRoomFilesAndDeleteOnlyAffectRequestedRoom() async throws {
        let harness = try makeHarness()
        defer { try? FileManager.default.removeItem(at: harness.root) }
        let first = try fixtureProjection(named: "projection-operative")
        let second = try projection(first, code: "XYZ789")

        try await harness.cache.save(first, lastUpdated: Self.savedAt)
        try await harness.cache.save(second, lastUpdated: Self.savedAt)
        let firstBeforeDelete = try await harness.cache.load(code: "ABC234")
        let secondBeforeDelete = try await harness.cache.load(code: "XYZ789")
        XCTAssertNotNil(firstBeforeDelete)
        XCTAssertNotNil(secondBeforeDelete)

        try await harness.cache.delete(code: "ABC234")

        let firstAfterDelete = try await harness.cache.load(code: "ABC234")
        let secondAfterDelete = try await harness.cache.load(code: "XYZ789")
        XCTAssertNil(firstAfterDelete)
        XCTAssertNotNil(secondAfterDelete)
        XCTAssertEqual(try cacheFiles(in: harness.root).count, 1)
    }

    func testPersistedFileIsExcludedFromBackupAndUsesDeviceFileProtection() async throws {
        let writer = RecordingProjectionCacheFileWriter()
        let harness = try makeHarness(fileWriter: writer)
        defer { try? FileManager.default.removeItem(at: harness.root) }

        try await harness.cache.save(
            fixtureProjection(named: "projection-operative"),
            lastUpdated: Self.savedAt
        )

        let file = try XCTUnwrap(try cacheFiles(in: harness.root).first)
        let values = try file.resourceValues(forKeys: [.isExcludedFromBackupKey])
        XCTAssertEqual(values.isExcludedFromBackup, true)
        XCTAssertEqual(writer.recordedPolicies(), [.appPrivate])
    }

    func testCorruptOrCrossRoomCacheFailsClosedWithoutReturningProjection() async throws {
        let harness = try makeHarness()
        defer { try? FileManager.default.removeItem(at: harness.root) }
        let mismatched = try projection(
            fixtureProjection(named: "projection-operative"),
            code: "XYZ789"
        )
        try await harness.cache.save(mismatched, lastUpdated: Self.savedAt)
        let file = try XCTUnwrap(try cacheFiles(in: harness.root).first)
        let abcFile = file.deletingLastPathComponent().appendingPathComponent("ABC234.json")
        try FileManager.default.copyItem(at: file, to: abcFile)

        await XCTAssertThrowsErrorAsyncCache(try await harness.cache.load(code: "ABC234")) {
            XCTAssertEqual($0 as? ProjectionCacheError, .roomMismatch)
        }
    }

    func testCacheContainingAnyHiddenKeyFailsClosed() async throws {
        let harness = try makeHarness()
        defer { try? FileManager.default.removeItem(at: harness.root) }
        try await harness.cache.save(
            fixtureProjection(named: "projection-operative"),
            lastUpdated: Self.savedAt
        )
        let file = try XCTUnwrap(try cacheFiles(in: harness.root).first)
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
        )
        var payload = try XCTUnwrap(object["projection"] as? [String: Any])
        payload["key"] = ["moon": "hazard"]
        object["projection"] = payload
        try JSONSerialization.data(withJSONObject: object).write(to: file, options: .atomic)

        await XCTAssertThrowsErrorAsyncCache(try await harness.cache.load(code: "ABC234")) {
            XCTAssertEqual($0 as? ProjectionCacheError, .unsafeProjection)
        }
    }

    private func makeHarness(
        fileWriter: (any ProjectionCacheFileWriting)? = nil
    ) throws -> (cache: ProjectionCache, root: URL) {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ProjectionCacheTests-\(UUID().uuidString)", isDirectory: true)
        return (
            ProjectionCache(directoryURL: root, fileWriter: fileWriter),
            root
        )
    }

    private func cacheFiles(in root: URL) throws -> [URL] {
        guard FileManager.default.fileExists(atPath: root.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil
        ).filter { $0.pathExtension == "json" }
    }

    private func fixtureProjection(
        named name: String,
        unrevealedOwner: Ownership? = nil
    ) throws -> ClientProjection {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        let data = try Data(contentsOf: url)
        guard let unrevealedOwner else {
            return try JSONDecoder().decode(ClientProjection.self, from: data)
        }
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var board = try XCTUnwrap(object["board"] as? [String: Any])
        var cards = try XCTUnwrap(board["cards"] as? [[String: Any]])
        let index = try XCTUnwrap(cards.firstIndex { ($0["revealed"] as? Bool) == false })
        cards[index]["owner"] = unrevealedOwner.rawValue
        board["cards"] = cards
        object["board"] = board
        return try JSONDecoder().decode(
            ClientProjection.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
    }

    private func projection(_ source: ClientProjection, code: String) throws -> ClientProjection {
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(source)) as? [String: Any]
        )
        object["code"] = code
        object["inviteUrl"] = "https://oddlyuseful.studio/room/\(code)"
        return try JSONDecoder().decode(
            ClientProjection.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
    }

    private func containsKey(named key: String, in value: Any) -> Bool {
        if let dictionary = value as? [String: Any] {
            return dictionary.keys.contains(key)
                || dictionary.values.contains { containsKey(named: key, in: $0) }
        }
        if let array = value as? [Any] {
            return array.contains { containsKey(named: key, in: $0) }
        }
        return false
    }

    private static let savedAt = Date(timeIntervalSince1970: 1_750_000_000)
}

private final class RecordingProjectionCacheFileWriter: ProjectionCacheFileWriting,
    @unchecked Sendable {
    private let lock = NSLock()
    private var policies: [ProjectionCacheWritePolicy] = []
    private let writer = SystemProjectionCacheFileWriter()

    func write(_ data: Data, to url: URL, policy: ProjectionCacheWritePolicy) throws {
        lock.lock()
        policies.append(policy)
        lock.unlock()
        try writer.write(data, to: url, policy: policy)
    }

    func recordedPolicies() -> [ProjectionCacheWritePolicy] {
        lock.lock()
        defer { lock.unlock() }
        return policies
    }
}

private func XCTAssertThrowsErrorAsyncCache<T>(
    _ expression: @autoclosure () async throws -> T,
    _ errorHandler: (Error) -> Void = { _ in }
) async {
    do {
        _ = try await expression()
        XCTFail("Expected expression to throw")
    } catch {
        errorHandler(error)
    }
}
