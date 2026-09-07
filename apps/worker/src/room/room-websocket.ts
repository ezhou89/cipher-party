export interface WebSocketAttachment {
  connectionId: string;
  playerId: string;
  hostAuthority: boolean;
}

export function serializeSocketAttachment(
  ws: WebSocket,
  attachment: WebSocketAttachment
): void {
  ws.serializeAttachment(attachment);
}

export function getSocketAttachment(ws: WebSocket): WebSocketAttachment | null {
  try {
    return ws.deserializeAttachment() as WebSocketAttachment;
  } catch {
    return null;
  }
}
