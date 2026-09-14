import XCTest

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
}
