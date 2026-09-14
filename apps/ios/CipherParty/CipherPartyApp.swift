import SwiftUI

@main
struct CipherPartyApp: App {
    private let environment: AppEnvironment

    init() {
        do {
            environment = try AppEnvironment.production()
        } catch {
            preconditionFailure("Cipher Party has an invalid app configuration.")
        }
    }

    var body: some Scene {
        WindowGroup {
            EntryView(environment: environment)
        }
    }
}

struct EntryView: View {
    let environment: AppEnvironment

    var body: some View {
        VStack(spacing: 24) {
            Text("Cipher Party")
                .font(.largeTitle.bold())
                .accessibilityIdentifier("entry.title")

            Text("Create or join a private game with friends.")
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                Button("Create room") {}
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("entry.createRoom")

                Button("Join with code") {}
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("entry.joinWithCode")
            }
        }
        .padding(24)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("entry.screen")
    }
}
