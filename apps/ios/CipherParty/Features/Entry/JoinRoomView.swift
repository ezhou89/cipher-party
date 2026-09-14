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

            Button(isSubmitting ? "Joining…" : "Join room") {
                Task { await joinRoom() }
            }
            .disabled(isSubmitting)
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
        guard let name = normalizedDisplayNameForJoin(displayName) else {
            errorMessage = "Enter a name of 24 characters or fewer."
            return
        }

        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let response = try await apiClient.joinRoom(
                code: code,
                displayName: name,
                asSpectator: joinAsSpectator
            )
            let credentials = SeatCredentials(
                code: response.code,
                playerId: response.playerId,
                seatToken: response.seatToken,
                hostToken: nil
            )
            try await credentialStore.put(credentials)
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

private final class InviteScannerViewController: UIViewController,
    @preconcurrency AVCaptureMetadataOutputObjectsDelegate
{
    private let inviteRouter: InviteRouter
    private let onCode: (String) -> Void
    private let onFailure: (CameraInviteScannerFailure) -> Void
    private let captureSession = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var hasCompleted = false
    private var hasStarted = false

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
        guard !hasStarted else { return }
        hasStarted = true
        requestCameraAccessAfterUserChoice()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stopCapture()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func requestCameraAccessAfterUserChoice() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureAndStartCapture()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor in
                    guard let self else { return }
                    if granted {
                        self.configureAndStartCapture()
                    } else {
                        self.finish(with: .permissionDenied)
                    }
                }
            }
        case .denied, .restricted:
            finish(with: .permissionDenied)
        @unknown default:
            finish(with: .permissionDenied)
        }
    }

    private func configureAndStartCapture() {
        guard !captureSession.isRunning, !hasCompleted else { return }
        guard
            let camera = AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: camera),
            captureSession.canAddInput(input)
        else {
            finish(with: .cameraUnavailable)
            return
        }

        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else {
            finish(with: .cameraUnavailable)
            return
        }

        captureSession.beginConfiguration()
        captureSession.addInput(input)
        captureSession.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        guard output.availableMetadataObjectTypes.contains(.qr) else {
            captureSession.commitConfiguration()
            finish(with: .cameraUnavailable)
            return
        }
        output.metadataObjectTypes = [.qr]
        captureSession.commitConfiguration()

        let previewLayer = AVCaptureVideoPreviewLayer(session: captureSession)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.bounds
        view.layer.addSublayer(previewLayer)
        self.previewLayer = previewLayer
        captureSession.startRunning()
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !hasCompleted else { return }
        for case let codeObject as AVMetadataMachineReadableCodeObject in metadataObjects {
            guard
                codeObject.type == .qr,
                let payload = codeObject.stringValue,
                let code = try? inviteRouter.roomCode(from: payload)
            else {
                continue
            }
            hasCompleted = true
            stopCapture()
            onCode(code)
            return
        }
    }

    private func finish(with failure: CameraInviteScannerFailure) {
        guard !hasCompleted else { return }
        hasCompleted = true
        stopCapture()
        onFailure(failure)
    }

    private func stopCapture() {
        if captureSession.isRunning {
            captureSession.stopRunning()
        }
    }
}

private func normalizedDisplayNameForJoin(_ input: String) -> String? {
    let normalized = input
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .precomposedStringWithCanonicalMapping
    guard
        !normalized.isEmpty,
        normalized.count <= 24,
        normalized.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
    else {
        return nil
    }
    return normalized
}

private func userFacingJoinError(_ error: Error) -> String {
    if let apiError = error as? APIClientError {
        return apiError.localizedDescription
    }
    return "The room could not be joined. Try again."
}
