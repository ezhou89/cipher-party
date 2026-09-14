import Foundation
import XCTest
@testable import CipherParty

@MainActor
final class BoardViewTests: XCTestCase {
    func testBoardPresentationUsesServerOrderAndHidesKeyOutsideClueGiver() throws {
        let operative = try fixtureProjection(named: "projection-operative")
        let clueGiver = try fixtureProjection(named: "projection-clue-giver")

        let operativePresentation = BoardPresentation(
            projection: try RoomProjection(serverProjection: operative),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )
        let clueGiverPresentation = BoardPresentation(
            projection: try RoomProjection(serverProjection: clueGiver),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )

        XCTAssertEqual(
            operativePresentation.cards.map(\.label),
            ["Café", "Moon", "River", "Hazard"]
        )
        XCTAssertTrue(operativePresentation.cards.allSatisfy { $0.keyOwner == nil })
        XCTAssertNil(operativePresentation.key)
        XCTAssertEqual(clueGiverPresentation.key?["moon"], .blue)
        XCTAssertEqual(
            clueGiverPresentation.cards.first(where: { $0.id == "moon" })?.keyOwner,
            .blue
        )
    }

    func testBoardPresentationReadsChallengePauseAndCompletionFromProjection() throws {
        let challenged = try BoardPresentation(
            projection: RoomProjection(
                serverProjection: fixtureProjection(named: "projection-challenged")
            ),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )
        let paused = try BoardPresentation(
            projection: RoomProjection(
                serverProjection: fixtureProjection(named: "projection-paused")
            ),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )
        let complete = try BoardPresentation(
            projection: RoomProjection(
                serverProjection: fixtureProjection(named: "projection-complete")
            ),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )

        XCTAssertTrue(challenged.isChallenged)
        XCTAssertEqual(challenged.clueWord, "Océan")
        XCTAssertTrue(paused.isPaused)
        XCTAssertTrue(paused.controls.isReadOnly)
        XCTAssertTrue(complete.isComplete)
        XCTAssertEqual(complete.winner, .blue)
        XCTAssertEqual(complete.completionReason, .hazard)
        XCTAssertTrue(complete.publicHistoryIsPreserved)
    }

    func testBoardControlsRequireProjectionPermissionPhaseAndFreshConnection() throws {
        let operative = try BoardPresentation(
            projection: RoomProjection(
                serverProjection: fixtureProjection(named: "projection-operative")
            ),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )
        let spectator = try BoardPresentation(
            projection: RoomProjection(
                serverProjection: fixtureProjection(named: "projection-spectator")
            ),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )
        let staleOperative = BoardPresentation(
            projection: operative.projection,
            connectionState: .reconnecting(attempt: 1, delay: 0.5),
            isStale: true,
            lastUpdated: nil
        )

        XCTAssertTrue(operative.controls.canNominate)
        XCTAssertTrue(operative.controls.canConfirmReveal)
        XCTAssertTrue(operative.controls.canEndTurn)
        XCTAssertFalse(operative.controls.canSubmitClue)
        XCTAssertFalse(spectator.controls.hasAnyAction)
        XCTAssertFalse(staleOperative.controls.hasAnyAction)
    }

    func testClueValidationNormalizesLocalInputWithoutChangingServerState() {
        XCTAssertEqual(
            ClueComposerValidation.validate(word: "  Élan  ", count: 2),
            .valid(word: "Élan", count: 2)
        )
        XCTAssertEqual(
            ClueComposerValidation.validate(word: "two words", count: 2),
            .invalid("Clue word can only contain letters, numbers, apostrophes, and hyphens.")
        )
        XCTAssertEqual(
            ClueComposerValidation.validate(word: "Moon", count: 0),
            .invalid("Clue count must be an integer between 1 and 9.")
        )
    }

    func testUnassignedAndCachedBoardViewsHaveNoHiddenOrInteractiveState() throws {
        let unassigned = try BoardPresentation(
            projection: RoomProjection(
                serverProjection: fixtureProjection(named: "projection-lobby-unassigned")
            ),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )
        let cached = BoardPresentation(
            projection: try RoomProjection(
                serverProjection: fixtureProjection(named: "projection-clue-giver")
            ).redacted(),
            connectionState: .disconnected(.unavailablePath),
            isStale: true,
            lastUpdated: nil
        )

        XCTAssertTrue(unassigned.cards.isEmpty)
        XCTAssertFalse(unassigned.controls.hasAnyAction)
        XCTAssertNil(unassigned.key)
        XCTAssertFalse(cached.controls.hasAnyAction)
        XCTAssertNil(cached.cards.first(where: { $0.id == "moon" })?.keyOwner)
    }

    private func fixtureProjection(named name: String) throws -> ClientProjection {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try JSONDecoder().decode(ClientProjection.self, from: Data(contentsOf: url))
    }
}
