import XCTest

@MainActor
final class EntryFlowUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testEntryScreenLaunchesAtNarrowPhoneWidth() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.otherElements["entry.screen"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["entry.title"].exists)
        XCTAssertLessThanOrEqual(app.windows.firstMatch.frame.width, 375)
    }

    func testEntryOffersScanAndManualCodeFallback() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.buttons["entry.scanInvite"].waitForExistence(timeout: 5))
        app.buttons["entry.joinWithCode"].tap()

        XCTAssertTrue(app.textFields["join.roomCode"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["join.scanInvite"].exists)
        XCTAssertTrue(app.staticTexts["join.manualFallback"].exists)
    }

    func testHostControlsAreNotShownBeforeRoomProjection() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.otherElements["entry.screen"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.otherElements["lobby.hostControls"].exists)
    }
}
