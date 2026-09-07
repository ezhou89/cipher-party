import type { RoomConnectionState } from "../lib/room-socket";

export interface ConnectionBadgeProps {
  state: RoomConnectionState;
}

export function ConnectionBadge({ state }: ConnectionBadgeProps) {
  const labels: Record<
    RoomConnectionState,
    { text: string; className: string }
  > = {
    idle: { text: "Idle", className: "badge-idle" },
    connecting: { text: "Connecting...", className: "badge-connecting" },
    open: { text: "Connected", className: "badge-open" },
    reconnecting: { text: "Reconnecting...", className: "badge-reconnecting" },
    closed: { text: "Disconnected", className: "badge-closed" }
  };

  const current = labels[state] ?? { text: state, className: "" };

  return (
    <div className="connection-badge-container">
      <span className={`connection-badge ${current.className}`}>
        <span className="badge-dot" aria-hidden="true" />
        {current.text}
      </span>
      <div role="status" aria-live="polite" className="sr-only">
        Connection status: {current.text}
      </div>
    </div>
  );
}
