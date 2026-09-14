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
