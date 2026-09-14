import Foundation
import Security
import XCTest
@testable import CipherParty

final class SeatCredentialStoreTests: XCTestCase {
    func testPutAndGetRoundTripUsesDeviceOnlyNonSynchronizingKeychainItem() async throws {
        let keychain = InMemoryKeychainClient()
        let store = SeatCredentialStore(service: "test.credentials", keychain: keychain)
        let credentials = SeatCredentials(
            code: "ABC234",
            playerId: "player-host",
            seatToken: "seat-secret",
            hostToken: "host-secret"
        )

        try await store.put(credentials)

        let stored = try await store.get(code: "ABC234")
        XCTAssertEqual(stored, credentials)
        XCTAssertEqual(
            keychain.lastAddedAttributes?[kSecAttrAccessible as String] as? String,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String
        )
        XCTAssertEqual(
            keychain.lastAddedAttributes?[kSecAttrSynchronizable as String] as? Bool,
            false
        )
    }

    func testGetReturnsCredentialsWithoutOptionalHostToken() async throws {
        let keychain = InMemoryKeychainClient()
        let store = SeatCredentialStore(service: "test.credentials", keychain: keychain)
        let credentials = SeatCredentials(
            code: "ABC234",
            playerId: "player-guest",
            seatToken: "seat-guest",
            hostToken: nil
        )

        try await store.put(credentials)

        let stored = try await store.get(code: "ABC234")
        XCTAssertEqual(stored, credentials)
    }

    func testSeparateRoomCodesDoNotOverwriteEachOther() async throws {
        let keychain = InMemoryKeychainClient()
        let store = SeatCredentialStore(service: "test.credentials", keychain: keychain)
        let first = SeatCredentials(
            code: "ABC234",
            playerId: "player-one",
            seatToken: "seat-one",
            hostToken: nil
        )
        let second = SeatCredentials(
            code: "K7M2X9",
            playerId: "player-two",
            seatToken: "seat-two",
            hostToken: "host-two"
        )

        try await store.put(first)
        try await store.put(second)

        let storedFirst = try await store.get(code: first.code)
        let storedSecond = try await store.get(code: second.code)
        XCTAssertEqual(storedFirst, first)
        XCTAssertEqual(storedSecond, second)
    }

    func testPuttingDuplicateRoomReplacesExistingCredentials() async throws {
        let keychain = InMemoryKeychainClient()
        let store = SeatCredentialStore(service: "test.credentials", keychain: keychain)
        let original = SeatCredentials(
            code: "ABC234",
            playerId: "player-old",
            seatToken: "seat-old",
            hostToken: nil
        )
        let replacement = SeatCredentials(
            code: "ABC234",
            playerId: "player-new",
            seatToken: "seat-new",
            hostToken: "host-new"
        )

        try await store.put(original)
        try await store.put(replacement)

        let stored = try await store.get(code: "ABC234")
        XCTAssertEqual(stored, replacement)
        XCTAssertEqual(keychain.itemCount, 1)
    }

    func testDeleteRemovesOnlyTheExplicitlyLeftRoom() async throws {
        let keychain = InMemoryKeychainClient()
        let store = SeatCredentialStore(service: "test.credentials", keychain: keychain)
        let leaving = SeatCredentials(
            code: "ABC234",
            playerId: "player-one",
            seatToken: "seat-one",
            hostToken: nil
        )
        let staying = SeatCredentials(
            code: "K7M2X9",
            playerId: "player-two",
            seatToken: "seat-two",
            hostToken: nil
        )
        try await store.put(leaving)
        try await store.put(staying)

        try await store.delete(code: leaving.code)

        let deletedCredentials = try await store.get(code: leaving.code)
        let preservedCredentials = try await store.get(code: staying.code)
        XCTAssertNil(deletedCredentials)
        XCTAssertEqual(preservedCredentials, staying)
    }

    func testFailingKeychainStatusSurfacesAsTypedError() async throws {
        let keychain = InMemoryKeychainClient()
        keychain.forcedAddStatus = errSecInteractionNotAllowed
        let store = SeatCredentialStore(service: "test.credentials", keychain: keychain)
        let credentials = SeatCredentials(
            code: "ABC234",
            playerId: "player-one",
            seatToken: "seat-one",
            hostToken: nil
        )

        do {
            try await store.put(credentials)
            XCTFail("Expected Keychain failure")
        } catch {
            XCTAssertEqual(
                error as? SeatCredentialStoreError,
                .keychain(operation: .add, status: errSecInteractionNotAllowed)
            )
            XCTAssertFalse(String(describing: error).contains(credentials.seatToken))
        }
    }
}

private final class InMemoryKeychainClient: KeychainClient, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: Data] = [:]

    var forcedAddStatus: OSStatus?
    private(set) var lastAddedAttributes: [String: Any]?

    var itemCount: Int {
        lock.withLock { items.count }
    }

    func copyMatching(_ query: [String: Any]) -> (status: OSStatus, result: CFTypeRef?) {
        lock.withLock {
            guard let key = key(for: query), let data = items[key] else {
                return (errSecItemNotFound, nil)
            }
            return (errSecSuccess, data as CFData)
        }
    }

    func add(_ attributes: [String: Any]) -> OSStatus {
        lock.withLock {
            if let forcedAddStatus { return forcedAddStatus }
            guard
                let key = key(for: attributes),
                let data = attributes[kSecValueData as String] as? Data
            else {
                return errSecParam
            }
            guard items[key] == nil else { return errSecDuplicateItem }
            lastAddedAttributes = attributes
            items[key] = data
            return errSecSuccess
        }
    }

    func update(_ query: [String: Any], attributes: [String: Any]) -> OSStatus {
        lock.withLock {
            guard
                let key = key(for: query),
                items[key] != nil,
                let data = attributes[kSecValueData as String] as? Data
            else {
                return errSecItemNotFound
            }
            items[key] = data
            return errSecSuccess
        }
    }

    func delete(_ query: [String: Any]) -> OSStatus {
        lock.withLock {
            guard let key = key(for: query), items.removeValue(forKey: key) != nil else {
                return errSecItemNotFound
            }
            return errSecSuccess
        }
    }

    private func key(for query: [String: Any]) -> String? {
        guard
            let service = query[kSecAttrService as String] as? String,
            let account = query[kSecAttrAccount as String] as? String
        else {
            return nil
        }
        return "\(service):\(account)"
    }
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        lock()
        defer { unlock() }
        return body()
    }
}
