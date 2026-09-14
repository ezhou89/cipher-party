import Foundation

struct AppEnvironment: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    enum Deployment: String, Sendable {
        case debug
        case staging
        case release

        var requiresSecureTransport: Bool {
            self != .debug
        }
    }

    struct FeatureFlags: Equatable, Sendable {
        let connectionDiagnosticsEnabled: Bool
    }

    enum ConfigurationError: Error, Equatable {
        case missingValue(String)
        case invalidValue(String)
        case secureTransportRequired
    }

    let deployment: Deployment
    let apiBaseURL: URL
    let webSocketBaseURL: URL
    let urlScheme: String
    let keychainServiceName: String
    let featureFlags: FeatureFlags

    init(
        deployment: Deployment,
        apiBaseURL: URL,
        urlScheme: String,
        keychainServiceName: String,
        featureFlags: FeatureFlags
    ) throws {
        try Self.validate(apiBaseURL: apiBaseURL, deployment: deployment)
        try Self.validate(urlScheme: urlScheme)

        guard !keychainServiceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ConfigurationError.invalidValue("KeychainServiceName")
        }

        self.deployment = deployment
        self.apiBaseURL = apiBaseURL
        webSocketBaseURL = try Self.makeWebSocketBaseURL(from: apiBaseURL)
        self.urlScheme = urlScheme
        self.keychainServiceName = keychainServiceName
        self.featureFlags = featureFlags
    }

    static func production(bundle: Bundle = .main) throws -> AppEnvironment {
        let deploymentName = try requiredString("AppEnvironmentName", in: bundle)
        guard let deployment = Deployment(rawValue: deploymentName) else {
            throw ConfigurationError.invalidValue("AppEnvironmentName")
        }

        let apiBaseURLString = try requiredString("APIBaseURL", in: bundle)
        guard let apiBaseURL = URL(string: apiBaseURLString) else {
            throw ConfigurationError.invalidValue("APIBaseURL")
        }

        return try AppEnvironment(
            deployment: deployment,
            apiBaseURL: apiBaseURL,
            urlScheme: requiredString("AppURLScheme", in: bundle),
            keychainServiceName: requiredString("KeychainServiceName", in: bundle),
            featureFlags: FeatureFlags(
                connectionDiagnosticsEnabled: boolean(
                    "FeatureConnectionDiagnostics",
                    in: bundle
                )
            )
        )
    }

    static func testing(
        apiBaseURL: URL,
        urlScheme: String = "cipherparty-test",
        keychainServiceName: String = "studio.oddlyuseful.cipherparty.tests.credentials",
        featureFlags: FeatureFlags = .init(connectionDiagnosticsEnabled: false)
    ) throws -> AppEnvironment {
        try AppEnvironment(
            deployment: .debug,
            apiBaseURL: apiBaseURL,
            urlScheme: urlScheme,
            keychainServiceName: keychainServiceName,
            featureFlags: featureFlags
        )
    }

    var description: String {
        "AppEnvironment(deployment: \(deployment.rawValue), apiHost: \(apiBaseURL.host ?? "unavailable"))"
    }

    var debugDescription: String {
        description
    }

    private static func validate(apiBaseURL: URL, deployment: Deployment) throws {
        guard
            let components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false),
            let scheme = components.scheme?.lowercased(),
            components.host != nil,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil,
            ["http", "https"].contains(scheme)
        else {
            throw ConfigurationError.invalidValue("APIBaseURL")
        }

        if deployment.requiresSecureTransport, scheme != "https" {
            throw ConfigurationError.secureTransportRequired
        }

        if scheme == "http", !isLoopbackHost(components.host) {
            throw ConfigurationError.secureTransportRequired
        }
    }

    private static func validate(urlScheme: String) throws {
        let allowedCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "+-."))
        guard
            let first = urlScheme.unicodeScalars.first,
            CharacterSet.letters.contains(first),
            urlScheme.unicodeScalars.allSatisfy(allowedCharacters.contains)
        else {
            throw ConfigurationError.invalidValue("AppURLScheme")
        }
    }

    private static func makeWebSocketBaseURL(from apiBaseURL: URL) throws -> URL {
        guard var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false) else {
            throw ConfigurationError.invalidValue("APIBaseURL")
        }

        components.scheme = components.scheme?.lowercased() == "https" ? "wss" : "ws"
        guard let url = components.url else {
            throw ConfigurationError.invalidValue("APIBaseURL")
        }
        return url
    }

    private static func isLoopbackHost(_ host: String?) -> Bool {
        guard let host = host?.lowercased() else { return false }
        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }

    private static func requiredString(_ key: String, in bundle: Bundle) throws -> String {
        guard
            let value = bundle.object(forInfoDictionaryKey: key) as? String,
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw ConfigurationError.missingValue(key)
        }
        return value
    }

    private static func boolean(_ key: String, in bundle: Bundle) -> Bool {
        if let value = bundle.object(forInfoDictionaryKey: key) as? Bool {
            return value
        }
        guard let value = bundle.object(forInfoDictionaryKey: key) as? String else {
            return false
        }
        return ["1", "true", "yes"].contains(value.lowercased())
    }
}
