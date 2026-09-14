import XCTest
@testable import CipherParty

final class CameraInviteScannerLifecycleTests: XCTestCase {
    func testDismissalRejectsPendingPermissionGeneration() {
        var lifecycle = CameraInviteScannerLifecycle()
        let pendingPermissionGeneration = lifecycle.activate()

        lifecycle.invalidate()

        XCTAssertFalse(lifecycle.isActive(pendingPermissionGeneration))
    }

    func testDismissalRejectsQueuedMetadataDelivery() {
        var lifecycle = CameraInviteScannerLifecycle()
        let queuedMetadataGeneration = lifecycle.activate()

        lifecycle.invalidate()

        XCTAssertFalse(lifecycle.claimCompletion(queuedMetadataGeneration))
    }

    func testNewAppearanceRejectsOldGenerationAndAcceptsNewGeneration() {
        var lifecycle = CameraInviteScannerLifecycle()
        let oldGeneration = lifecycle.activate()
        lifecycle.invalidate()

        let newGeneration = lifecycle.activate()

        XCTAssertFalse(lifecycle.isActive(oldGeneration))
        XCTAssertTrue(lifecycle.isActive(newGeneration))
    }
}
