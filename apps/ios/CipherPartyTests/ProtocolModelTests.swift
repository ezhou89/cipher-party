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

    func testRejectsOmittedRequiredNullableFieldsAndAcceptsExplicitNull() throws {
        var lobby = try projectionObject(named: "projection-lobby-unassigned")
        lobby.removeValue(forKey: "board")
        assertProjectionDecodeFails(lobby)

        lobby = try projectionObject(named: "projection-lobby-unassigned")
        var viewer = try XCTUnwrap(lobby["viewer"] as? [String: Any])
        viewer.removeValue(forKey: "teamId")
        lobby["viewer"] = viewer
        assertProjectionDecodeFails(lobby)

        lobby = try projectionObject(named: "projection-lobby-unassigned")
        var seats = try XCTUnwrap(lobby["seats"] as? [[String: Any]])
        seats[0].removeValue(forKey: "teamId")
        lobby["seats"] = seats
        assertProjectionDecodeFails(lobby)

        for field in ["clue", "nomination", "winner", "completionReason"] {
            var projection = try projectionObject(named: "projection-operative")
            var board = try XCTUnwrap(projection["board"] as? [String: Any])
            board.removeValue(forKey: field)
            projection["board"] = board
            assertProjectionDecodeFails(projection)
        }

        var projection = try projectionObject(named: "projection-operative")
        var board = try XCTUnwrap(projection["board"] as? [String: Any])
        var cards = try XCTUnwrap(board["cards"] as? [[String: Any]])
        cards[1]["owner"] = NSNull()
        board["cards"] = cards
        projection["board"] = board
        assertProjectionDecodeFails(projection)

        var assignSeat = validCommandEnvelope(command: [
            "type": "assign_seat",
            "playerId": "player-1",
            "teamId": NSNull()
        ])
        XCTAssertNoThrow(try decodeCommandEnvelope(assignSeat))
        var command = try XCTUnwrap(assignSeat["command"] as? [String: Any])
        command.removeValue(forKey: "teamId")
        assignSeat["command"] = command
        XCTAssertThrowsError(try decodeCommandEnvelope(assignSeat))
    }

    func testRejectsUnknownFieldsAtEveryStrictSchemaBoundary() throws {
        let projectionMutations: [([String: Any]) throws -> [String: Any]] = [
            { object in
                var copy = object
                copy["future"] = true
                return copy
            },
            { object in
                var copy = object
                var viewer = try XCTUnwrap(copy["viewer"] as? [String: Any])
                viewer["future"] = true
                copy["viewer"] = viewer
                return copy
            },
            { object in
                var copy = object
                var permissions = try XCTUnwrap(copy["permissions"] as? [String: Any])
                permissions["future"] = true
                copy["permissions"] = permissions
                return copy
            },
            { object in
                var copy = object
                var seats = try XCTUnwrap(copy["seats"] as? [[String: Any]])
                seats[0]["future"] = true
                copy["seats"] = seats
                return copy
            },
            { object in
                var copy = object
                var board = try XCTUnwrap(copy["board"] as? [String: Any])
                board["future"] = true
                copy["board"] = board
                return copy
            },
            { object in
                var copy = object
                var board = try XCTUnwrap(copy["board"] as? [String: Any])
                var cards = try XCTUnwrap(board["cards"] as? [[String: Any]])
                cards[0]["future"] = true
                board["cards"] = cards
                copy["board"] = board
                return copy
            },
            { object in
                var copy = object
                var board = try XCTUnwrap(copy["board"] as? [String: Any])
                var clue = try XCTUnwrap(board["clue"] as? [String: Any])
                clue["future"] = true
                board["clue"] = clue
                copy["board"] = board
                return copy
            },
            { object in
                var copy = object
                var board = try XCTUnwrap(copy["board"] as? [String: Any])
                var nomination = try XCTUnwrap(board["nomination"] as? [String: Any])
                nomination["future"] = true
                board["nomination"] = nomination
                copy["board"] = board
                return copy
            },
            { object in
                var copy = object
                var history = try XCTUnwrap(copy["publicHistory"] as? [[String: Any]])
                history[0]["future"] = true
                copy["publicHistory"] = history
                return copy
            },
            { object in
                var copy = object
                var history = try XCTUnwrap(copy["publicHistory"] as? [[String: Any]])
                history[0]["decision"] = "accept"
                copy["publicHistory"] = history
                return copy
            }
        ]

        let base = try projectionObject(named: "projection-operative")
        for mutation in projectionMutations {
            assertProjectionDecodeFails(try mutation(base))
        }

        var envelope = validCommandEnvelope(command: ["type": "randomize_teams"])
        envelope["future"] = true
        XCTAssertThrowsError(try decodeCommandEnvelope(envelope))

        envelope = validCommandEnvelope(command: ["type": "randomize_teams", "future": true])
        XCTAssertThrowsError(try decodeCommandEnvelope(envelope))

        envelope = validCommandEnvelope(command: ["type": "randomize_teams", "playerId": "p1"])
        XCTAssertThrowsError(try decodeCommandEnvelope(envelope))

        let strictMessages: [[String: Any]] = [
            ["type": "error", "code": "invalid_message", "message": "bad", "future": true],
            [
                "type": "command_result",
                "commandId": "10000000-0000-4000-8000-000000000001",
                "result": ["ok": true, "revision": 1, "future": true]
            ],
            [
                "type": "command_result",
                "commandId": "10000000-0000-4000-8000-000000000001",
                "result": ["ok": true, "revision": 1, "code": "unauthorized"]
            ],
            [
                "type": "error",
                "code": "invalid_message",
                "message": "bad",
                "result": ["ok": true, "revision": 1]
            ]
        ]
        for message in strictMessages {
            XCTAssertThrowsError(
                try JSONDecoder().decode(ServerMessage.self, from: jsonData(message))
            )
        }
    }

    func testRejectsValuesOutsideTheZodNumericAndStringContract() throws {
        let projectionMutations: [([String: Any]) throws -> [String: Any]] = [
            { object in var copy = object; copy["revision"] = -1; return copy },
            { object in var copy = object; copy["code"] = ""; return copy },
            { object in var copy = object; copy["inviteUrl"] = ""; return copy },
            { object in
                var copy = object
                var viewer = try XCTUnwrap(copy["viewer"] as? [String: Any])
                viewer["playerId"] = ""
                copy["viewer"] = viewer
                return copy
            },
            { object in
                var copy = object
                var seats = try XCTUnwrap(copy["seats"] as? [[String: Any]])
                seats[0]["displayName"] = ""
                copy["seats"] = seats
                return copy
            },
            { object in
                var copy = object
                var board = try XCTUnwrap(copy["board"] as? [String: Any])
                board["guessesRemaining"] = -1
                copy["board"] = board
                return copy
            },
            { object in
                var copy = object
                var board = try XCTUnwrap(copy["board"] as? [String: Any])
                board["order"] = [""]
                copy["board"] = board
                return copy
            },
            { object in
                var copy = object
                var board = try XCTUnwrap(copy["board"] as? [String: Any])
                var cards = try XCTUnwrap(board["cards"] as? [[String: Any]])
                cards[0]["id"] = ""
                board["cards"] = cards
                copy["board"] = board
                return copy
            },
            { object in
                var copy = object
                var board = try XCTUnwrap(copy["board"] as? [String: Any])
                var clue = try XCTUnwrap(board["clue"] as? [String: Any])
                clue["count"] = 0
                board["clue"] = clue
                copy["board"] = board
                return copy
            },
            { object in
                var copy = object
                var history = try XCTUnwrap(copy["publicHistory"] as? [[String: Any]])
                history[0]["revision"] = -1
                copy["publicHistory"] = history
                return copy
            }
        ]

        let base = try projectionObject(named: "projection-operative")
        for mutation in projectionMutations {
            assertProjectionDecodeFails(try mutation(base))
        }

        let invalidEnvelopes: [[String: Any]] = [
            validCommandEnvelope(expectedRevision: -1, command: ["type": "randomize_teams"]),
            validCommandEnvelope(command: [
                "type": "assign_seat", "playerId": "", "teamId": NSNull()
            ]),
            validCommandEnvelope(command: ["type": "nominate_card", "cardId": ""]),
            validCommandEnvelope(command: ["type": "submit_clue", "word": "", "count": 1]),
            validCommandEnvelope(command: ["type": "submit_clue", "word": "valid", "count": 0]),
            validCommandEnvelope(command: ["type": "submit_clue", "word": "valid", "count": 10]),
            validCommandEnvelope(command: ["type": "submit_clue", "word": "two words", "count": 1])
        ]
        for envelope in invalidEnvelopes {
            XCTAssertThrowsError(try decodeCommandEnvelope(envelope))
        }

        let normalized = try decodeCommandEnvelope(
            validCommandEnvelope(command: [
                "type": "submit_clue",
                "word": "  E\u{301}lan  ",
                "count": 1
            ])
        )
        XCTAssertEqual(normalized.command, .submitClue(word: "Élan", count: 1))

        XCTAssertThrowsError(
            try JSONDecoder().decode(
                ServerMessage.self,
                from: jsonData([
                    "type": "command_result",
                    "commandId": "10000000-0000-4000-8000-000000000001",
                    "result": ["ok": true, "revision": -1]
                ])
            )
        )
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

    private func projectionObject(named name: String) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: fixtureData(named: name)) as? [String: Any])
    }

    private func validCommandEnvelope(
        expectedRevision: Int = 0,
        command: [String: Any]
    ) -> [String: Any] {
        [
            "protocolVersion": 1,
            "commandId": "10000000-0000-4000-8000-000000000001",
            "expectedRevision": expectedRevision,
            "command": command
        ]
    }

    private func decodeCommandEnvelope(_ object: [String: Any]) throws -> CommandEnvelope {
        try JSONDecoder().decode(CommandEnvelope.self, from: jsonData(object))
    }

    private func assertProjectionDecodeFails(
        _ object: [String: Any],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(
            try JSONDecoder().decode(ClientProjection.self, from: jsonData(object)),
            file: file,
            line: line
        )
    }

    private func jsonData(_ object: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: object)
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
