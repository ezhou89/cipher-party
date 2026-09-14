import Foundation
import XCTest
@testable import CipherParty

final class ProtocolModelTests: XCTestCase {
    private let projectionFixtures = [
        "projection-lobby-unassigned",
        "projection-operative",
        "projection-clue-giver",
        "projection-spectator",
        "projection-challenged",
        "projection-paused",
        "projection-complete"
    ]

    func testDecodesEveryProjectionFixtureAndKeepsKeyRoleSafe() throws {
        let projections = try projectionFixtures.map {
            try JSONDecoder().decode(ClientProjection.self, from: fixtureData(named: $0))
        }

        XCTAssertEqual(
            projections.map(\.viewRole),
            [.unassigned, .operative, .clueGiver, .spectator, .operative, .operative, .spectator]
        )
        XCTAssertEqual(projections.compactMap(\.key).count, 1)
        XCTAssertEqual(projections[2].key?["hazard"], .hazard)
        XCTAssertNil(projections[0].key)
        XCTAssertNil(projections[1].key)
        XCTAssertNil(projections[3].key)
    }

    func testDecodesAndRoundTripsEveryClassicCommand() throws {
        let decoder = JSONDecoder()
        let envelopes = try decoder.decode(
            [CommandEnvelope].self,
            from: fixtureData(named: "command-envelopes")
        )

        XCTAssertEqual(envelopes.count, 14)
        XCTAssertEqual(Set(envelopes.map(\.command.type)), Set(ClassicCommand.CommandType.allCases))
        XCTAssertTrue(envelopes.allSatisfy { $0.protocolVersion == 1 })

        let encoded = try JSONEncoder().encode(envelopes)
        XCTAssertEqual(try decoder.decode([CommandEnvelope].self, from: encoded), envelopes)
    }

    func testDecodesCommandResultsAndEveryErrorCode() throws {
        let messages = try JSONDecoder().decode(
            [ServerMessage].self,
            from: fixtureData(named: "server-messages")
        )

        let commandCodes = Set(messages.compactMap(\.commandErrorCode))
        XCTAssertEqual(commandCodes, Set(CommandErrorCode.allCases))
        XCTAssertTrue(messages.contains { $0.commandRevision == 22 && $0.commandSucceeded })
        XCTAssertTrue(messages.contains { $0.serverErrorCode == .ticketExpired })

        let encoded = try JSONEncoder().encode(messages)
        XCTAssertEqual(try JSONDecoder().decode([ServerMessage].self, from: encoded), messages)
    }

    func testProjectionFixturesCoverEveryPublicHistoryEntry() throws {
        let entries = try projectionFixtures.flatMap { name in
            try JSONDecoder().decode(ClientProjection.self, from: fixtureData(named: name))
                .base.publicHistory
        }

        XCTAssertEqual(Set(entries.map(\.type)), Set(PublicHistoryEntry.EntryType.allCases))
    }

    func testServerMessageWrapsACompleteProjection() throws {
        let projectionObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: fixtureData(named: "projection-operative"))
                as? [String: Any]
        )
        let data = try JSONSerialization.data(withJSONObject: [
            "type": "projection",
            "projection": projectionObject
        ])

        let message = try JSONDecoder().decode(ServerMessage.self, from: data)
        guard case let .projection(projection) = message else {
            return XCTFail("Expected a projection message")
        }
        XCTAssertEqual(projection.base.revision, 8)
        XCTAssertEqual(projection.base.board?.phase, .guess)
    }

    func testPreservesNFCUnicodeStringsAndOptionalOwnership() throws {
        let projection = try JSONDecoder().decode(
            ClientProjection.self,
            from: fixtureData(named: "projection-operative")
        )
        let board = try XCTUnwrap(projection.base.board)

        XCTAssertEqual(projection.base.viewer.playerId, "player-operative")
        XCTAssertEqual(projection.base.seats[0].displayName, "Élodie")
        XCTAssertEqual(board.cards[0].label, "Café")
        XCTAssertEqual(board.clue?.word, "Élan")
        XCTAssertEqual(board.cards[0].owner, .red)
        XCTAssertNil(board.cards[1].owner)

        for value in [projection.base.seats[0].displayName, board.cards[0].label, board.clue?.word] {
            let string = try XCTUnwrap(value)
            XCTAssertEqual(string, string.precomposedStringWithCanonicalMapping)
        }
    }

    func testProjectionEncodingRetainsRequiredNullFields() throws {
        let lobby = try JSONDecoder().decode(
            ClientProjection.self,
            from: fixtureData(named: "projection-lobby-unassigned")
        )
        let lobbyObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(lobby))
                as? [String: Any]
        )
        let lobbyViewer = try XCTUnwrap(lobbyObject["viewer"] as? [String: Any])
        let lobbySeat = try XCTUnwrap((lobbyObject["seats"] as? [[String: Any]])?.first)

        XCTAssertTrue(lobbyObject["board"] is NSNull)
        XCTAssertTrue(lobbyViewer["teamId"] is NSNull)
        XCTAssertTrue(lobbySeat["teamId"] is NSNull)

        let clueGiver = try JSONDecoder().decode(
            ClientProjection.self,
            from: fixtureData(named: "projection-clue-giver")
        )
        let clueObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(clueGiver))
                as? [String: Any]
        )
        let board = try XCTUnwrap(clueObject["board"] as? [String: Any])

        XCTAssertTrue(board["clue"] is NSNull)
        XCTAssertTrue(board["nomination"] is NSNull)
        XCTAssertTrue(board["winner"] is NSNull)
        XCTAssertTrue(board["completionReason"] is NSNull)
    }

    func testAcceptsMaximumPublicHistoryAndRejectsOneOverTheLimit() throws {
        let base = try XCTUnwrap(
            JSONSerialization.jsonObject(with: fixtureData(named: "projection-complete"))
                as? [String: Any]
        )
        let entry: [String: Any] = [
            "revision": 1,
            "at": "2026-09-13T12:00:00Z",
            "type": "room_resumed"
        ]

        var atLimit = base
        atLimit["publicHistory"] = Array(repeating: entry, count: 100)
        XCTAssertNoThrow(
            try JSONDecoder().decode(
                ClientProjection.self,
                from: JSONSerialization.data(withJSONObject: atLimit)
            )
        )

        var overLimit = base
        overLimit["publicHistory"] = Array(repeating: entry, count: 101)
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                ClientProjection.self,
                from: JSONSerialization.data(withJSONObject: overLimit)
            )
        ) { error in
            XCTAssertEqual(
                error as? ProtocolDecodingError,
                .publicHistoryLimitExceeded(actual: 101, maximum: 100)
            )
        }
    }

    func testRejectsHiddenKeyInUnauthorizedProjectionVariants() throws {
        for name in [
            "projection-lobby-unassigned",
            "projection-operative",
            "projection-spectator"
        ] {
            var object = try XCTUnwrap(
                JSONSerialization.jsonObject(with: fixtureData(named: name))
                    as? [String: Any]
            )
            object["key"] = ["hazard": "hazard"]

            XCTAssertThrowsError(
                try JSONDecoder().decode(
                    ClientProjection.self,
                    from: JSONSerialization.data(withJSONObject: object)
                )
            ) { error in
                guard case .hiddenKeyInUnauthorizedProjection = error as? ProtocolDecodingError else {
                    return XCTFail("Expected a role-safe hidden-key error, got \(error)")
                }
            }
        }
    }

    func testRejectsUnknownMessageRoleAndPhaseAsRecoverableProtocolErrors() throws {
        let cases: [(Data, String, String)] = [
            (
                Data(#"{"type":"future_message","secretFrame":"durable-secret"}"#.utf8),
                "type",
                "future_message"
            ),
            (
                try replacing(
                    key: "viewRole",
                    with: "future-role",
                    in: fixtureData(named: "projection-operative")
                ),
                "viewRole",
                "future-role"
            ),
            (
                try replacingBoardPhase(
                    with: "future-phase",
                    in: fixtureData(named: "projection-operative")
                ),
                "phase",
                "future-phase"
            )
        ]

        for (data, field, value) in cases {
            XCTAssertThrowsError(try decodeTopLevelProtocolValue(from: data)) { error in
                XCTAssertEqual(
                    error as? ProtocolDecodingError,
                    .unsupportedDiscriminator(field: field, value: value)
                )
                XCTAssertFalse(String(describing: error).contains("durable-secret"))
            }
        }
    }

    func testRejectsUnsupportedProtocolVersion() throws {
        let data = try replacing(
            key: "protocolVersion",
            with: 2,
            in: fixtureData(named: "projection-operative")
        )

        XCTAssertThrowsError(try JSONDecoder().decode(ClientProjection.self, from: data)) { error in
            XCTAssertEqual(error as? ProtocolDecodingError, .unsupportedProtocolVersion(2))
        }
    }

    private func fixtureData(named name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: name, withExtension: "json"),
            "Missing fixture \(name).json from the CipherPartyTests bundle"
        )
        return try Data(contentsOf: url)
    }

    private func replacing(key: String, with value: Any, in data: Data) throws -> Data {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object[key] = value
        return try JSONSerialization.data(withJSONObject: object)
    }

    private func replacingBoardPhase(with value: String, in data: Data) throws -> Data {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var board = try XCTUnwrap(object["board"] as? [String: Any])
        board["phase"] = value
        object["board"] = board
        return try JSONSerialization.data(withJSONObject: object)
    }

    private func decodeTopLevelProtocolValue(from data: Data) throws {
        if let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
           object["projection"] != nil || object["type"] as? String == "future_message" {
            _ = try JSONDecoder().decode(ServerMessage.self, from: data)
        } else {
            _ = try JSONDecoder().decode(ClientProjection.self, from: data)
        }
    }
}
