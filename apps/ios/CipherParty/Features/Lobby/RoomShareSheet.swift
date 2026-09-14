import SwiftUI
import UIKit

struct RoomSharePayload: Equatable, Sendable {
    let inviteURL: URL
    let value: String

    init(inviteURLString: String) throws {
        guard
            let url = URL(string: inviteURLString),
            url.absoluteString == inviteURLString
        else {
            throw QRCodeRendererError.unsafeInviteURL
        }
        _ = try QRCodeRenderer.validatedInviteURL(url)
        inviteURL = url
        value = inviteURLString
    }
}

struct RoomShareSheet: View {
    let roomCode: String
    let inviteURLString: String

    @State private var isQRCodePresented = false
    @State private var copiedItem: CopiedItem?

    private enum CopiedItem: String, Identifiable {
        case code
        case invite

        var id: String { rawValue }

        var message: String {
            switch self {
            case .code: return "Room code copied"
            case .invite: return "Invite link copied"
            }
        }
    }

    private var payload: RoomSharePayload? {
        try? RoomSharePayload(inviteURLString: inviteURLString)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Invite friends")
                .font(.title3.bold())

            Text("Share the link or code. The link only identifies this room.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                Text(roomCode)
                    .font(.title2.monospaced().weight(.bold))
                    .tracking(2)
                    .accessibilityLabel("Room code \(roomCode)")
                    .accessibilityIdentifier("lobby.roomCode")

                Spacer(minLength: 0)

                Button("Copy code", systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = roomCode
                    copiedItem = .code
                }
                .labelStyle(.iconOnly)
                .accessibilityLabel("Copy room code")
                .accessibilityIdentifier("lobby.copyCode")
            }
            .padding(14)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            if let payload {
                HStack(spacing: 12) {
                    ShareLink(
                        item: payload.value,
                        subject: Text("Join my Cipher Party room")
                    ) {
                        Label("Share invite", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("lobby.shareInvite")

                    Button("Copy invite", systemImage: "link") {
                        UIPasteboard.general.string = payload.value
                        copiedItem = .invite
                    }
                    .labelStyle(.iconOnly)
                    .accessibilityLabel("Copy invite link")
                    .accessibilityIdentifier("lobby.copyInvite")

                    Button("Show QR code", systemImage: "qrcode") {
                        isQRCodePresented = true
                    }
                    .labelStyle(.iconOnly)
                    .accessibilityLabel("Show QR code")
                    .accessibilityIdentifier("lobby.showQR")
                }
            } else {
                Text("Invite sharing is unavailable for this room.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("lobby.shareUnavailable")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lobby.share")
        .alert(item: $copiedItem) { item in
            Alert(
                title: Text(item.message),
                dismissButton: .default(Text("OK"))
            )
        }
        .sheet(isPresented: $isQRCodePresented) {
            if let payload {
                NavigationStack {
                    RoomQRCodeView(payload: payload)
                        .navigationTitle("Room QR code")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { isQRCodePresented = false }
                            }
                        }
                }
            }
        }
    }
}

private struct RoomQRCodeView: View {
    let payload: RoomSharePayload

    var body: some View {
        VStack(spacing: 20) {
            if let image = try? QRCodeRenderer().render(inviteURL: payload.inviteURL) {
                Image(decorative: image, scale: 1, orientation: .up)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .padding(24)
                    .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .accessibilityLabel("QR code for room \(payload.inviteURL.absoluteString)")
                    .accessibilityIdentifier("lobby.qrCode")
            } else {
                Text("This invite cannot be displayed as a QR code.")
                    .foregroundStyle(.secondary)
            }

            Text(payload.value)
                .font(.footnote.monospaced())
                .multilineTextAlignment(.center)
                .textSelection(.enabled)
                .padding(.horizontal, 24)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemGroupedBackground))
    }
}
