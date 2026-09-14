import Foundation
import Network

enum NetworkPathStatus: Equatable, Sendable {
    case usable
    case unavailable
}

protocol NetworkPathMonitoring: Sendable {
    func currentStatus() -> NetworkPathStatus
    func statusUpdates() -> AsyncStream<NetworkPathStatus>
}

final class NetworkPathMonitor: NetworkPathMonitoring, @unchecked Sendable {
    private let monitor: NWPathMonitor
    private let queue: DispatchQueue
    private let lock = NSLock()
    private var status: NetworkPathStatus
    private let updates: AsyncStream<NetworkPathStatus>
    private let continuation: AsyncStream<NetworkPathStatus>.Continuation

    init(
        monitor: NWPathMonitor = NWPathMonitor(),
        queue: DispatchQueue = DispatchQueue(label: "studio.oddlyuseful.cipherparty.path")
    ) {
        self.monitor = monitor
        self.queue = queue
        status = monitor.currentPath.status == .satisfied ? .usable : .unavailable
        let pair = AsyncStream<NetworkPathStatus>.makeStream(
            bufferingPolicy: .bufferingNewest(1)
        )
        updates = pair.stream
        continuation = pair.continuation

        monitor.pathUpdateHandler = { [weak self] path in
            self?.publish(path.status == .satisfied ? .usable : .unavailable)
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
        continuation.finish()
    }

    func currentStatus() -> NetworkPathStatus {
        lock.withLock { status }
    }

    func statusUpdates() -> AsyncStream<NetworkPathStatus> {
        updates
    }

    private func publish(_ newStatus: NetworkPathStatus) {
        let changed = lock.withLock {
            guard status != newStatus else { return false }
            status = newStatus
            return true
        }
        if changed {
            continuation.yield(newStatus)
        }
    }
}
