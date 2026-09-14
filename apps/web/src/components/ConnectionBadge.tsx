import type { RoomConnectionState } from "../lib/room-socket";

const CONNECTION_LABELS: Record<RoomConnectionState, string> = {
  idle: "Connection idle",
  connecting: "Connecting to room",
  open: "Connected",
  reconnecting: "Reconnecting to room",
  closed: "Connection closed",
};

interface ConnectionBadgeProps {
  connection: RoomConnectionState;
}

export function ConnectionBadge({ connection }: ConnectionBadgeProps) {
  return (
    <span
      className={`connection-badge connection-${connection}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="connection-dot" aria-hidden="true" />
      {CONNECTION_LABELS[connection]}
    </span>
  );
}
