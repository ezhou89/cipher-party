import Foundation

enum InviteRouterError: Error, Equatable, Sendable {
    case emptyInput
    case unsupportedLink
    case invalidPath
    case invalidRoomCode
}

struct InviteRouter: Sendable {
    private let universalLinkHost: String
    private let customScheme: String

    init(
        universalLinkHost: String = "oddlyuseful.studio",
        customScheme: String = "cipherparty"
    ) {
        self.universalLinkHost = universalLinkHost.lowercased()
        self.customScheme = customScheme.lowercased()
    }

    func roomCode(from input: String) throws -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw InviteRouterError.emptyInput }

        if trimmed.contains("://") {
            guard let url = URL(string: trimmed) else {
                throw InviteRouterError.unsupportedLink
            }
            return try roomCode(from: url)
        }

        return try normalize(code: trimmed)
    }

    func roomCode(from url: URL) throws -> String {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let scheme = components.scheme?.lowercased(),
            components.user == nil,
            components.password == nil
        else {
            throw InviteRouterError.unsupportedLink
        }

        let rawCode: String
        switch scheme {
        case "https":
            guard
                components.host?.lowercased() == universalLinkHost,
                components.port == nil
            else {
                throw InviteRouterError.unsupportedLink
            }
            rawCode = try webRoomCode(from: components.path)
        case customScheme:
            guard components.host?.lowercased() == "room", components.port == nil else {
                throw InviteRouterError.invalidPath
            }
            rawCode = try customSchemeRoomCode(from: components.path)
        default:
            throw InviteRouterError.unsupportedLink
        }

        return try normalize(code: rawCode)
    }

    private func webRoomCode(from path: String) throws -> String {
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard components.count == 3, components[0].isEmpty, components[1] == "room", !components[2].isEmpty else {
            throw InviteRouterError.invalidPath
        }
        return String(components[2])
    }

    private func customSchemeRoomCode(from path: String) throws -> String {
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard components.count == 2, components[0].isEmpty, !components[1].isEmpty else {
            throw InviteRouterError.invalidPath
        }
        return String(components[1])
    }

    private func normalize(code: String) throws -> String {
        do {
            return try RoomCode.normalizedAndValidated(code)
        } catch {
            throw InviteRouterError.invalidRoomCode
        }
    }
}
