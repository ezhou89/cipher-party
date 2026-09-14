@preconcurrency import AVFoundation
import SwiftUI
import UIKit

struct JoinRoomView: View {
    let inviteRouter: InviteRouter
    let apiClient: APIClient
    let credentialStore: SeatCredentialStore
    let onJoined: (SeatCredentials) -> Void

    @State private var roomCode: String
    @State private var displayName = ""
    @State private var joinAsSpectator = false
    @State private var isSubmitting = false
    @State private var scannerIsPresented = false
    @State private var scannerMessage: String?
    @State private var errorMessage: String?
    @State private var shouldScanOnAppear: Bool

    init(
        initialCode: String = "",
        scanImmediately: Bool = false,
        inviteRouter: InviteRouter,
        apiClient: APIClient,
        credentialStore: SeatCredentialStore,
        onJoined: @escaping (SeatCredentials) -> Void
    ) {
        self.inviteRouter = inviteRouter
        self.apiClient = apiClient
        self.credentialStore = credentialStore
        self.onJoined = onJoined
        _roomCode = State(initialValue: initialCode)
        _shouldScanOnAppear = State(initialValue: scanImmediately)
    }

    var body: some View {
        Form {
            Section("Invite") {
                TextField("Room code", text: $roomCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("join.roomCode")

                Button("Scan invite", systemImage: "qrcode.viewfinder") {
                    scannerIsPresented = true
                }
                .accessibilityIdentifier("join.scanInvite")

                Text("Camera unavailable or permission denied? Enter the six-character code above.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("join.manualFallback")
            }

            Section("Your seat") {
                Text("Already played in this room on this device? Enter its code and continue to restore your saved seat, including host access. A name is only needed for a new seat.")
                    .font(.footnote)
                    .accessibilityIdentifier("join.restoreGuidance")
                TextField("Your name", text: $displayName)
                    .textContentType(.name)
                    .autocorrectionDisabled()

                Toggle("Join as spectator", isOn: $joinAsSpectator)
            }

            if let scannerMessage {
                Text(scannerMessage)
                    .foregroundStyle(.secondary)
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .accessibilityLabel("Error: \(errorMessage)")
            }

            Button(isSubmitting ? "Opening…" : "Continue to room") {
                Task { await joinRoom() }
            }
            .disabled(isSubmitting)
            .accessibilityIdentifier("join.continue")
        }
        .navigationTitle("Join room")
        .sheet(isPresented: $scannerIsPresented) {
            NavigationStack {
                CameraInviteScannerView(
                    inviteRouter: inviteRouter,
                    onCode: receiveScannedCode,
                    onFailure: receiveScannerFailure
                )
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Scan invite")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { scannerIsPresented = false }
                    }
                }
            }
        }
        .onAppear {
            guard shouldScanOnAppear else { return }
            shouldScanOnAppear = false
            scannerIsPresented = true
        }
    }

    @MainActor
    private func joinRoom() async {
        let code: String
        do {
            code = try inviteRouter.roomCode(from: roomCode)
        } catch {
            errorMessage = "Enter a valid six-character room code."
            return
        }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let credentials = try await RoomEntryService(apiClient: apiClient, credentialStore: credentialStore).resumeOrJoin(
                code: code,
                displayName: displayName,
                asSpectator: joinAsSpectator
            )
            onJoined(credentials)
        } catch {
            errorMessage = userFacingJoinError(error)
        }
    }

    private func receiveScannedCode(_ code: String) {
        roomCode = code
        scannerMessage = nil
        scannerIsPresented = false
    }

    private func receiveScannerFailure(_ failure: CameraInviteScannerFailure) {
        scannerIsPresented = false
        switch failure {
        case .permissionDenied:
            scannerMessage = "Camera access is off. Enter the room code manually or enable Camera in Settings."
        case .cameraUnavailable:
            scannerMessage = "This device has no available camera. Enter the room code manually."
        }
    }
}

enum CameraInviteScannerFailure: Equatable, Sendable {
    case permissionDenied
    case cameraUnavailable
}

struct CameraInviteScannerLifecycle: Sendable {
    typealias Generation = UInt

    private(set) var generation: Generation = 0
    private(set) var isVisible = false
    private var hasCompleted = false

    mutating func activate() -> Generation {
        generation &+= 1
        isVisible = true
        hasCompleted = false
        return generation
    }

    mutating func invalidate() {
        guard isVisible else { return }
        isVisible = false
        generation &+= 1
    }

    func isActive(_ candidate: Generation) -> Bool {
        isVisible && !hasCompleted && generation == candidate
    }

    mutating func claimCompletion(_ candidate: Generation) -> Bool {
        guard isActive(candidate) else { return false }
        hasCompleted = true
        isVisible = false
        return true
    }
}

private struct CameraInviteScannerView: UIViewControllerRepresentable {
    let inviteRouter: InviteRouter
    let onCode: (String) -> Void
    let onFailure: (CameraInviteScannerFailure) -> Void

    func makeUIViewController(context: Context) -> InviteScannerViewController {
        InviteScannerViewController(
            inviteRouter: inviteRouter,
            onCode: onCode,
            onFailure: onFailure
        )
    }

    func updateUIViewController(_ uiViewController: InviteScannerViewController, context: Context) {}
}

private final class InviteScannerViewController: UIViewController {
    private let inviteRouter: InviteRouter
    private let onCode: (String) -> Void
    private let onFailure: (CameraInviteScannerFailure) -> Void
    private let captureSession = AVCaptureSession()
    private var lifecycle = CameraInviteScannerLifecycle()
    private var metadataOutput: AVCaptureMetadataOutput?
    private var metadataDelegate: InviteScannerMetadataDelegate?
    private var previewLayer: AVCaptureVideoPreviewLayer?

    init(
        inviteRouter: InviteRouter,
        onCode: @escaping (String) -> Void,
        onFailure: @escaping (CameraInviteScannerFailure) -> Void
    ) {
        self.inviteRouter = inviteRouter
        self.onCode = onCode
        self.onFailure = onFailure
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        let generation = lifecycle.activate()
        requestCameraAccessAfterUserChoice(generation: generation)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        invalidateScanner()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        invalidateScanner()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func requestCameraAccessAfterUserChoice(
        generation: CameraInviteScannerLifecycle.Generation
    ) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureAndStartCapture(generation: generation)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor in
                    guard let self, self.lifecycle.isActive(generation) else { return }
                    if granted {
                        self.configureAndStartCapture(generation: generation)
                    } else {
                        self.finish(with: .permissionDenied, generation: generation)
                    }
                }
            }
        case .denied, .restricted:
            finish(with: .permissionDenied, generation: generation)
        @unknown default:
            finish(with: .permissionDenied, generation: generation)
        }
    }

    private func configureAndStartCapture(
        generation: CameraInviteScannerLifecycle.Generation
    ) {
        guard lifecycle.isActive(generation), !captureSession.isRunning else { return }
        guard
            let camera = AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: camera),
            captureSession.canAddInput(input)
        else {
            finish(with: .cameraUnavailable, generation: generation)
            return
        }

        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else {
            finish(with: .cameraUnavailable, generation: generation)
            return
        }

        captureSession.beginConfiguration()
        captureSession.addInput(input)
        captureSession.addOutput(output)
        let metadataDelegate = InviteScannerMetadataDelegate(
            generation: generation,
            onMetadata: { [weak self] metadataObjects, generation in
                self?.handleMetadata(metadataObjects, generation: generation)
            }
        )
        output.setMetadataObjectsDelegate(metadataDelegate, queue: .main)
        guard output.availableMetadataObjectTypes.contains(.qr) else {
            captureSession.commitConfiguration()
            finish(with: .cameraUnavailable, generation: generation)
            return
        }
        output.metadataObjectTypes = [.qr]
        captureSession.commitConfiguration()
        self.metadataOutput = output
        self.metadataDelegate = metadataDelegate

        let previewLayer = AVCaptureVideoPreviewLayer(session: captureSession)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.bounds
        view.layer.addSublayer(previewLayer)
        self.previewLayer = previewLayer
        guard lifecycle.isActive(generation) else {
            invalidateScanner()
            return
        }
        captureSession.startRunning()
    }

    private func handleMetadata(
        _ metadataObjects: [AVMetadataObject],
        generation: CameraInviteScannerLifecycle.Generation
    ) {
        guard lifecycle.isActive(generation) else { return }
        for case let codeObject as AVMetadataMachineReadableCodeObject in metadataObjects {
            guard
                codeObject.type == .qr,
                let payload = codeObject.stringValue,
                let code = try? inviteRouter.roomCode(from: payload)
            else {
                continue
            }
            guard lifecycle.claimCompletion(generation) else { return }
            tearDownCapture()
            onCode(code)
            return
        }
    }

    private func finish(
        with failure: CameraInviteScannerFailure,
        generation: CameraInviteScannerLifecycle.Generation
    ) {
        guard lifecycle.claimCompletion(generation) else { return }
        tearDownCapture()
        onFailure(failure)
    }

    private func invalidateScanner() {
        lifecycle.invalidate()
        tearDownCapture()
    }

    private func tearDownCapture() {
        metadataOutput?.setMetadataObjectsDelegate(nil, queue: nil)
        metadataOutput = nil
        metadataDelegate = nil
        previewLayer?.removeFromSuperlayer()
        previewLayer = nil
        stopCapture()
    }

    private func stopCapture() {
        if captureSession.isRunning {
            captureSession.stopRunning()
        }
    }
}

private final class InviteScannerMetadataDelegate: NSObject,
    AVCaptureMetadataOutputObjectsDelegate
{
    private let generation: CameraInviteScannerLifecycle.Generation
    private let onMetadata: (
        [AVMetadataObject],
        CameraInviteScannerLifecycle.Generation
    ) -> Void

    init(
        generation: CameraInviteScannerLifecycle.Generation,
        onMetadata: @escaping (
            [AVMetadataObject],
            CameraInviteScannerLifecycle.Generation
        ) -> Void
    ) {
        self.generation = generation
        self.onMetadata = onMetadata
        super.init()
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        onMetadata(metadataObjects, generation)
    }
}

private func userFacingJoinError(_ error: Error) -> String {
    if let entryError = error as? RoomEntryError { return entryError.localizedDescription }
    if let apiError = error as? APIClientError {
        return apiError.localizedDescription
    }
    return "The room could not be joined. Try again."
}
