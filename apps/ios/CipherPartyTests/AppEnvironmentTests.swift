import Foundation
import XCTest
@testable import CipherParty

final class AppEnvironmentTests: XCTestCase {
    func testStagingRejectsAnInsecureAPIBaseURL() throws {
        let insecureURL = try XCTUnwrap(URL(string: "http://oddlyuseful.studio"))

        XCTAssertThrowsError(
            try AppEnvironment(
                deployment: .staging,
                apiBaseURL: insecureURL,
                urlScheme: "cipherparty-staging",
                keychainServiceName: "studio.oddlyuseful.cipherparty.staging.credentials",
                featureFlags: .init(connectionDiagnosticsEnabled: false)
            )
        ) { error in
            XCTAssertEqual(
                error as? AppEnvironment.ConfigurationError,
                .secureTransportRequired
            )
        }
    }

    func testSecureAPIBaseURLProducesSecureWebSocketBaseURL() throws {
        let apiURL = try XCTUnwrap(URL(string: "https://oddlyuseful.studio/service"))
        let environment = try AppEnvironment(
            deployment: .staging,
            apiBaseURL: apiURL,
            urlScheme: "cipherparty-staging",
            keychainServiceName: "studio.oddlyuseful.cipherparty.staging.credentials",
            featureFlags: .init(connectionDiagnosticsEnabled: false)
        )

        XCTAssertEqual(
            environment.webSocketBaseURL.absoluteString,
            "wss://oddlyuseful.studio/service"
        )
    }

    func testDescriptionAndDebugOutputDoNotExposeCredentialMetadata() throws {
        let apiURL = try XCTUnwrap(URL(string: "https://oddlyuseful.studio"))
        let environment = try AppEnvironment.testing(apiBaseURL: apiURL)

        for output in [String(describing: environment), String(reflecting: environment)] {
            XCTAssertFalse(output.localizedCaseInsensitiveContains("seatToken"))
            XCTAssertFalse(output.localizedCaseInsensitiveContains("hostToken"))
            XCTAssertFalse(output.contains(environment.keychainServiceName))
        }
    }
}
