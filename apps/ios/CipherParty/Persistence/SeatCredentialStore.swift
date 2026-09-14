import Foundation
import Security

struct SeatCredentials: Codable, Equatable, Sendable {
    let code: String
    let playerId: String
    let seatToken: String
    let hostToken: String?
}

protocol KeychainClient: Sendable {
    func copyMatching(_ query: [String: Any]) -> (status: OSStatus, result: CFTypeRef?)
    func add(_ attributes: [String: Any]) -> OSStatus
    func update(_ query: [String: Any], attributes: [String: Any]) -> OSStatus
    func delete(_ query: [String: Any]) -> OSStatus
}

struct SecurityKeychainClient: KeychainClient {
    func copyMatching(_ query: [String: Any]) -> (status: OSStatus, result: CFTypeRef?) {
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        return (status, result)
    }

    func add(_ attributes: [String: Any]) -> OSStatus {
        SecItemAdd(attributes as CFDictionary, nil)
    }

    func update(_ query: [String: Any], attributes: [String: Any]) -> OSStatus {
        SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    }

    func delete(_ query: [String: Any]) -> OSStatus {
        SecItemDelete(query as CFDictionary)
    }
}

enum SeatCredentialStoreError: Error, Equatable, Sendable, CustomStringConvertible {
    enum Operation: String, Equatable, Sendable {
        case read
        case add
        case update
        case delete
    }

    case invalidRoomCode
    case keychain(operation: Operation, status: OSStatus)
    case invalidData

    var description: String {
        switch self {
        case .invalidRoomCode:
            return "Invalid room code."
        case let .keychain(operation, status):
            return "Credential storage \(operation.rawValue) failed with status \(status)."
        case .invalidData:
            return "Stored credentials are invalid."
        }
    }
}

actor SeatCredentialStore {
    private let service: String
    private let keychain: any KeychainClient
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(service: String, keychain: any KeychainClient = SecurityKeychainClient()) {
        self.service = service
        self.keychain = keychain
        encoder = JSONEncoder()
        decoder = JSONDecoder()
    }

    func put(_ credentials: SeatCredentials) throws {
        let code = try normalizedCode(credentials.code)
        let normalizedCredentials = SeatCredentials(
            code: code,
            playerId: credentials.playerId,
            seatToken: credentials.seatToken,
            hostToken: credentials.hostToken
        )
        let data: Data
        do {
            data = try encoder.encode(normalizedCredentials)
        } catch {
            throw SeatCredentialStoreError.invalidData
        }

        var attributes = itemQuery(code: code)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        attributes[kSecValueData as String] = data

        let addStatus = keychain.add(attributes)
        switch addStatus {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            let updateStatus = keychain.update(
                itemQuery(code: code),
                attributes: [
                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                    kSecValueData as String: data
                ]
            )
            guard updateStatus == errSecSuccess else {
                throw SeatCredentialStoreError.keychain(
                    operation: .update,
                    status: updateStatus
                )
            }
        default:
            throw SeatCredentialStoreError.keychain(operation: .add, status: addStatus)
        }
    }

    func get(code: String) throws -> SeatCredentials? {
        let code = try normalizedCode(code)
        var query = itemQuery(code: code)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true
        let result = keychain.copyMatching(query)

        switch result.status {
        case errSecItemNotFound:
            return nil
        case errSecSuccess:
            guard let data = result.result as? Data else {
                throw SeatCredentialStoreError.invalidData
            }
            do {
                let credentials = try decoder.decode(SeatCredentials.self, from: data)
                guard credentials.code == code else {
                    throw SeatCredentialStoreError.invalidData
                }
                return credentials
            } catch let error as SeatCredentialStoreError {
                throw error
            } catch {
                throw SeatCredentialStoreError.invalidData
            }
        default:
            throw SeatCredentialStoreError.keychain(operation: .read, status: result.status)
        }
    }

    func delete(code: String) throws {
        let code = try normalizedCode(code)
        let status = keychain.delete(itemQuery(code: code))
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SeatCredentialStoreError.keychain(operation: .delete, status: status)
        }
    }

    private func itemQuery(code: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: code,
            kSecAttrSynchronizable as String: false
        ]
    }

    private func normalizedCode(_ input: String) throws -> String {
        do {
            return try RoomCode.normalizedAndValidated(input)
        } catch {
            throw SeatCredentialStoreError.invalidRoomCode
        }
    }
}
