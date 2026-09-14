import Foundation
import XCTest
@testable import CipherParty

final class LobbyViewTests: XCTestCase {
    func testNonHostProjectionDoesNotExposeHostControls() throws {
        let projection = try fixtureProjection(named: "projection-lobby-unassigned")
        let presentation = LobbyPresentation(
            projection: try RoomProjection(serverProjection: projection),
            connectionState: .connected,
            isStale: false,
            lastUpdated: Date(timeIntervalSince1970: 2_000)
        )

        XCTAssertFalse(presentation.showsHostControls)
        XCTAssertFalse(presentation.hostControls.canConfigure)
        XCTAssertFalse(presentation.hostControls.canModerate)
    }

    func testConfiguredProjectionExposesHostControlsOnlyThroughServerPermissions() throws {
        let base = try fixtureProjection(named: "projection-lobby-unassigned")
        let projection = try projectionWithPermissions(base, configure: true, moderate: false)
        let presentation = LobbyPresentation(
            projection: try RoomProjection(serverProjection: projection),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )

        XCTAssertTrue(presentation.showsHostControls)
        XCTAssertTrue(presentation.hostControls.canConfigure)
        XCTAssertFalse(presentation.hostControls.canModerate)
    }

    func testStartReadinessMatchesWebRequirementForBothTeams() throws {
        let base = try fixtureProjection(named: "projection-lobby-unassigned")
        let incomplete = try projectionWithSeats(
            base,
            seats: [
                seat(id: "00000000-0000-4000-8000-000000000001", team: "red", role: "clue-giver"),
                seat(id: "00000000-0000-4000-8000-000000000002", team: "blue", role: "clue-giver")
            ]
        )
        let incompletePresentation = LobbyPresentation(
            projection: try RoomProjection(serverProjection: incomplete),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )
        XCTAssertFalse(incompletePresentation.readiness.isReady)
        XCTAssertEqual(
            incompletePresentation.readiness.requirementHint,
            LobbyReadiness.startRequirementHint
        )

        let complete = try projectionWithSeats(
            base,
            seats: [
                seat(id: "00000000-0000-4000-8000-000000000001", team: "red", role: "clue-giver"),
                seat(id: "00000000-0000-4000-8000-000000000002", team: "red", role: "operative"),
                seat(id: "00000000-0000-4000-8000-000000000003", team: "blue", role: "clue-giver"),
                seat(id: "00000000-0000-4000-8000-000000000004", team: "blue", role: "operative")
            ]
        )
        let completePresentation = LobbyPresentation(
            projection: try RoomProjection(serverProjection: complete),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )
        XCTAssertTrue(completePresentation.readiness.isReady)
        XCTAssertNil(completePresentation.readiness.requirementHint)
    }

    func testMixedClientGuidanceDoesNotInventPlatformMetadata() {
        XCTAssertTrue(LobbyPresentation.mixedClientGuidance.contains("Browser"))
        XCTAssertTrue(LobbyPresentation.mixedClientGuidance.contains("iPhone"))
        XCTAssertTrue(LobbyPresentation.mixedClientGuidance.contains("server-provided seat list"))
    }

    func testDisconnectedSeatIsExplicitlyLabeledAndSpectatorIsSupported() throws {
        let projection = try fixtureProjection(named: "projection-lobby-unassigned")
        let updated = try projectionWithSeats(
            projection,
            seats: [
                [
                    "playerId": "00000000-0000-4000-8000-000000000001",
                    "displayName": "Browser host",
                    "teamId": NSNull(),
                    "role": "spectator",
                    "connected": false
                ],
                [
                    "playerId": "00000000-0000-4000-8000-000000000002",
                    "displayName": "iPhone player",
                    "teamId": "red",
                    "role": "operative",
                    "connected": true
                ]
            ]
        )
        let presentation = LobbyPresentation(
            projection: try RoomProjection(serverProjection: updated),
            connectionState: .connected,
            isStale: false,
            lastUpdated: nil
        )

        XCTAssertEqual(presentation.seats.count, 2)
        XCTAssertEqual(presentation.seats[0].roleLabel, "Spectator")
        XCTAssertEqual(presentation.seats[0].teamLabel, "No team")
        XCTAssertEqual(presentation.seats[0].connectionLabel, "Disconnected")
        XCTAssertEqual(presentation.seats[1].teamLabel, "Red team")
        XCTAssertEqual(presentation.seats[1].connectionLabel, "Connected")
    }

    func testSharePayloadIsExactlySafeInviteURL() throws {
        let inviteURL = "https://oddlyuseful.studio/room/ABC234"
        let payload = try RoomSharePayload(inviteURLString: inviteURL)

        XCTAssertEqual(payload.value, inviteURL)
        XCTAssertFalse(payload.value.contains("seatToken"))
        XCTAssertFalse(payload.value.contains("hostToken"))
        XCTAssertFalse(payload.value.contains("ticket"))
    }

    func testConnectionPresentationLabelsStaleCachedStateWithoutClaimingOfflineActions() throws {
        let projection = try RoomProjection(
            serverProjection: fixtureProjection(named: "projection-lobby-unassigned")
        )
        let presentation = LobbyPresentation(
            projection: projection,
            connectionState: .reconnecting(attempt: 2, delay: 2),
            isStale: true,
            lastUpdated: Date(timeIntervalSince1970: 2_000)
        )

        XCTAssertEqual(presentation.connection.title, "Reconnecting")
        XCTAssertTrue(presentation.connection.isReadOnly)
        XCTAssertTrue(presentation.connection.lastUpdated != nil)
        XCTAssertFalse(presentation.hostControls.actionsAreEnabled)
    }

    private func fixtureProjection(named name: String) throws -> ClientProjection {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try JSONDecoder().decode(ClientProjection.self, from: Data(contentsOf: url))
    }

    private func projectionWithSeats(
        _ projection: ClientProjection,
        seats: [[String: Any]]
    ) throws -> ClientProjection {
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(projection)) as? [String: Any]
        )
        object["seats"] = seats
        return try JSONDecoder().decode(
            ClientProjection.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
    }

    private func projectionWithPermissions(
        _ projection: ClientProjection,
        configure: Bool,
        moderate: Bool
    ) throws -> ClientProjection {
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(projection)) as? [String: Any]
        )
        var permissions = try XCTUnwrap(object["permissions"] as? [String: Any])
        permissions["configure"] = configure
        permissions["moderate"] = moderate
        object["permissions"] = permissions
        return try JSONDecoder().decode(
            ClientProjection.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
    }

    private func seat(id: String, team: String, role: String) -> [String: Any] {
        [
            "playerId": id,
            "displayName": String(id.suffix(4)),
            "teamId": team,
            "role": role,
            "connected": true
        ]
    }
}
