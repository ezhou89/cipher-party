import CoreImage
import Foundation
import XCTest
@testable import CipherParty

final class InviteRouterTests: XCTestCase {
    private let router = InviteRouter()

    func testUniversalLinkReturnsNormalizedCodeAndIgnoresQueryAndFragment() throws {
        let url = try XCTUnwrap(
            URL(string: "https://oddlyuseful.studio/room/oI-l29A?source=message#join")
        )

        XCTAssertEqual(try router.roomCode(from: url.absoluteString), "01129A")
    }

    func testDevelopmentSchemeReturnsNormalizedCode() throws {
        let url = try XCTUnwrap(URL(string: "cipherparty://room/oI-l29A"))

        XCTAssertEqual(try router.roomCode(from: url), "01129A")
    }

    func testManualInputNormalizesAliasesWhitespaceAndHyphens() throws {
        XCTAssertEqual(try router.roomCode(from: " o0-iL2 9 "), "001129")
    }

    func testUniversalLinkRejectsUnsupportedOrigin() throws {
        let url = try XCTUnwrap(URL(string: "https://example.com/room/ABC234"))

        XCTAssertThrowsError(try router.roomCode(from: url)) { error in
            XCTAssertEqual(error as? InviteRouterError, .unsupportedLink)
        }
    }

    func testLinksRejectMalformedOrExtraPathComponents() throws {
        let malformedLinks = [
            "https://oddlyuseful.studio/rooms/ABC234",
            "https://oddlyuseful.studio/room/ABC234/extra",
            "https://oddlyuseful.studio/room/",
            "cipherparty://room/ABC234/extra",
            "cipherparty://wrong/ABC234"
        ]

        for rawLink in malformedLinks {
            let url = try XCTUnwrap(URL(string: rawLink))
            XCTAssertThrowsError(try router.roomCode(from: url), rawLink) { error in
                XCTAssertEqual(error as? InviteRouterError, .invalidPath)
            }
        }
    }

    func testInvalidManualCodeReturnsTypedError() {
        XCTAssertThrowsError(try router.roomCode(from: "ABC")) { error in
            XCTAssertEqual(error as? InviteRouterError, .invalidRoomCode)
        }
    }

    func testQRCodeDecodesToExactServerInviteURL() throws {
        let inviteURL = try XCTUnwrap(
            URL(string: "https://oddlyuseful.studio/room/ABC234")
        )
        let image = try QRCodeRenderer().render(inviteURL: inviteURL)

        let detector = try XCTUnwrap(
            CIDetector(
                ofType: CIDetectorTypeQRCode,
                context: CIContext(),
                options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
            )
        )
        let payloads = detector.features(in: CIImage(cgImage: image)).compactMap {
            ($0 as? CIQRCodeFeature)?.messageString
        }

        XCTAssertEqual(payloads, [inviteURL.absoluteString])
    }

    func testQRCodeRejectsQueryFragmentAndCredentialShapedValues() throws {
        let token = String(repeating: "A", count: 43)
        let unsafeURLs = [
            "https://oddlyuseful.studio/room/ABC234?seatToken=\(token)",
            "https://oddlyuseful.studio/room/ABC234#hostToken=\(token)",
            "https://\(token).example/room/ABC234"
        ]

        for rawURL in unsafeURLs {
            let url = try XCTUnwrap(URL(string: rawURL))
            XCTAssertThrowsError(try QRCodeRenderer().render(inviteURL: url), rawURL) { error in
                XCTAssertEqual(error as? QRCodeRendererError, .unsafeInviteURL)
            }
        }
    }
}
