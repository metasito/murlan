import { io, Socket } from "socket.io-client";
import { getApiUrl } from "@/lib/query-client";

const socketMap = new Map<string, Socket>();

export function connectSocket(userId: string): Socket {
  if (socketMap.has(userId)) {
    return socketMap.get(userId)!;
  }
  const baseUrl = getApiUrl().replace(/\/$/, "");
  const socket = io(baseUrl, {
    auth: { userId },
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  socketMap.set(userId, socket);
  return socket;
}

export function getSocket(userId: string): Socket {
  const s = socketMap.get(userId);
  if (!s) {
    return connectSocket(userId);
  }
  return s;
}

export function disconnectSocket(userId: string) {
  const s = socketMap.get(userId);
  if (s) {
    s.removeAllListeners();
    s.disconnect();
    socketMap.delete(userId);
  }
}
