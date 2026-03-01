import { io, Socket } from "socket.io-client";
import { getApiUrl } from "@/lib/query-client";

let socket: Socket | null = null;

export function getSocket(userId: string): Socket {
  if (!socket || !socket.connected) {
    const baseUrl = getApiUrl().replace(/\/$/, "");
    socket = io(baseUrl, {
      auth: { userId },
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
