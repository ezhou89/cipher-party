import SwiftUI

struct RoomActionPresentation: Equatable {
    let status: String?
    let error: String?
    let canRetry: Bool
    let canCancel: Bool

    @MainActor
    init(session: RoomSession) {
        canRetry = session.canRetryPendingCommand
        error = session.lastError.flatMap(BoardActionErrorPresentation.message(for:))
        switch session.pendingCommand?.delivery {
        case .awaitingResult:
            status = "Waiting for the server to confirm your action…"
            canCancel = false
        case .awaitingProjection:
            status = "Getting the updated room before actions resume…"
            canCancel = false
        case .unknownDelivery:
            status = "Your action may already have happened. Wait for the latest room before deciding whether to retry."
            canCancel = true
        case .retryAvailable:
            status = "Check the current room before retrying. The previous action may already have happened. Dismiss to continue without retrying."
            canCancel = true
        case nil:
            status = nil
            canCancel = false
        }
    }
}

@MainActor
struct RoomActionStatusView: View {
    let session: RoomSession
    @State private var retryError: String?

    var body: some View {
        let presentation = RoomActionPresentation(session: session)
        if presentation.status != nil || presentation.error != nil || retryError != nil {
            VStack(alignment: .leading, spacing: 10) {
                if let status = presentation.status { Text(status) }
                if let message = retryError ?? presentation.error {
                    Text(message).foregroundStyle(.red)
                }
                if presentation.canCancel {
                    ViewThatFits(in: .horizontal) {
                        HStack { recoveryButtons(presentation) }
                        VStack(alignment: .leading) { recoveryButtons(presentation) }
                    }
                }
            }
            .font(.footnote)
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityIdentifier("room.actionStatus")
            .onChange(of: session.lastCommandResult) { _, _ in retryError = nil }
        }
    }

    @ViewBuilder
    private func recoveryButtons(_ presentation: RoomActionPresentation) -> some View {
        Button("Retry action") {
            Task {
                retryError = nil
                do { try await session.retryPendingCommand() }
                catch let error as RoomSessionIntentError { retryError = error.description }
                catch { retryError = "The action could not be retried. Wait for a room update." }
            }
        }
        .disabled(!presentation.canRetry)
        .accessibilityIdentifier("room.retryAction")
        Button("Dismiss action") {
            retryError = nil
            session.cancelPendingCommand()
        }
        .accessibilityIdentifier("room.dismissAction")
    }
}

struct ConnectionBannerPresentation: Equatable, Sendable {
    let title: String
    let message: String
    let symbolName: String
    let isReadOnly: Bool
    let lastUpdated: Date?

    static func make(
        state: RoomConnectionState,
        isStale: Bool,
        lastUpdated: Date?
    ) -> ConnectionBannerPresentation {
        switch state {
        case .idle:
            return ConnectionBannerPresentation(
                title: "Not connected",
                message: "Room actions are paused until the room reconnects.",
                symbolName: "wifi.slash",
                isReadOnly: true,
                lastUpdated: lastUpdated
            )
        case .connecting:
            return ConnectionBannerPresentation(
                title: "Connecting",
                message: "Getting the latest room state…",
                symbolName: "arrow.triangle.2.circlepath",
                isReadOnly: true,
                lastUpdated: lastUpdated
            )
        case .connected where isStale:
            return ConnectionBannerPresentation(
                title: "Waiting for room update",
                message: "The cached room view is read-only until the server confirms it.",
                symbolName: "arrow.triangle.2.circlepath",
                isReadOnly: true,
                lastUpdated: lastUpdated
            )
        case .connected:
            return ConnectionBannerPresentation(
                title: "Connected",
                message: "Room updates are live.",
                symbolName: "wifi",
                isReadOnly: false,
                lastUpdated: lastUpdated
            )
        case let .reconnecting(attempt, delay):
            let seconds = delay.formatted(.number.precision(.fractionLength(0...1)))
            return ConnectionBannerPresentation(
                title: "Reconnecting",
                message: "Trying again in \(seconds) seconds (attempt \(attempt)). Changes are paused.",
                symbolName: "arrow.triangle.2.circlepath",
                isReadOnly: true,
                lastUpdated: lastUpdated
            )
        case let .disconnected(reason):
            let message: String
            switch reason {
            case .background:
                message = "The app is paused in the background. Room actions will resume when connected."
            case .unavailablePath:
                message = "Showing the last saved room state. Room actions are paused while offline."
            case .userInitiated:
                message = "Room actions are paused until the room reconnects."
            }
            return ConnectionBannerPresentation(
                title: "Connection paused",
                message: message,
                symbolName: "wifi.slash",
                isReadOnly: true,
                lastUpdated: lastUpdated
            )
        case let .failed(failure):
            return ConnectionBannerPresentation(
                title: "Unable to connect",
                message: "\(failure.description) Room actions are paused.",
                symbolName: "exclamationmark.triangle",
                isReadOnly: true,
                lastUpdated: lastUpdated
            )
        }
    }
}

struct ConnectionBanner: View {
    let state: RoomConnectionState
    let isStale: Bool
    let lastUpdated: Date?

    private var presentation: ConnectionBannerPresentation {
        ConnectionBannerPresentation.make(
            state: state,
            isStale: isStale,
            lastUpdated: lastUpdated
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: presentation.symbolName)
                .font(.headline)
                .foregroundStyle(presentation.isReadOnly ? .orange : .green)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(presentation.title)
                    .font(.headline)
                Text(presentation.message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let lastUpdated = presentation.lastUpdated {
                    Text("Last updated \(lastUpdated, format: .dateTime.hour().minute().second())")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            (presentation.isReadOnly ? Color.orange : Color.green)
                .opacity(0.12),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(
                    (presentation.isReadOnly ? Color.orange : Color.green)
                        .opacity(0.35),
                    lineWidth: 1
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("lobby.connection")
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        presentation.lastUpdated.map {
            "\(presentation.title). \(presentation.message) Last updated \($0.formatted(.dateTime.hour().minute().second()))."
        } ?? "\(presentation.title). \(presentation.message)"
    }
}
