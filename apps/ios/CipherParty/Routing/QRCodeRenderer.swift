import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation

enum QRCodeRendererError: Error, Equatable, Sendable {
    case unsafeInviteURL
    case generationFailed
}

struct QRCodeRenderer {
    private let context: CIContext

    init(context: CIContext = CIContext(options: [.useSoftwareRenderer: false])) {
        self.context = context
    }

    func render(inviteURL: URL) throws -> CGImage {
        guard Self.isSafeInviteURL(inviteURL) else {
            throw QRCodeRendererError.unsafeInviteURL
        }

        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(inviteURL.absoluteString.utf8)
        filter.correctionLevel = "M"
        guard let outputImage = filter.outputImage else {
            throw QRCodeRendererError.generationFailed
        }

        let scaledImage = outputImage.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let image = context.createCGImage(scaledImage, from: scaledImage.extent) else {
            throw QRCodeRendererError.generationFailed
        }
        return image
    }

    private static func isSafeInviteURL(_ url: URL) -> Bool {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let scheme = components.scheme?.lowercased(),
            let host = components.host?.lowercased(),
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil,
            !containsCredentialShapedValue(url.absoluteString)
        else {
            return false
        }

        guard scheme == "https" || (scheme == "http" && isLoopbackHost(host)) else {
            return false
        }

        let path = components.path.split(separator: "/", omittingEmptySubsequences: false)
        guard path.count == 3, path[0].isEmpty, path[1] == "room" else {
            return false
        }
        return (try? RoomCode.validated(String(path[2]))) != nil
    }

    private static func containsCredentialShapedValue(_ value: String) -> Bool {
        value.split(whereSeparator: { character in
            !(character.isASCII && (character.isLetter || character.isNumber || character == "-" || character == "_"))
        }).contains { component in
            component.utf8.count >= 43
        }
    }

    private static func isLoopbackHost(_ host: String) -> Bool {
        host == "localhost" || host == "127.0.0.1" || host == "::1"
    }
}
