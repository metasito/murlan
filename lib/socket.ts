import { io, Socket } from "socket.io-client";
import { getApiUrl } from "@/lib/query-client";

const socketMap = new Map<string, Socket>();

/**
 * Fired when the ticket endpoint reports the session is dead (401). Retrying
 * a ticket mint after that can never succeed until the user logs in again —
 * SocketContext registers this to stop hammering the endpoint and route to
 * auth instead.
 */
let authFailureHandler: (() => void) | null = null;
export function setSocketAuthFailureHandler(handler: (() => void) | null) {
  authFailureHandler = handler;
}

/**
 * Mints a short-lived, single-use handshake ticket from the authenticated REST
 * session. Native clients do not reliably send the session cookie on the
 * websocket upgrade, and the server no longer accepts a bare userId, so this
 * is what proves who we are.
 *
 * Uses a raw fetch (not apiRequest) so a 401 can be told apart from a
 * transient network failure instead of being swallowed identically.
 */
async function fetchSocketTicket(): Promise<string | null> {
  try {
    const baseUrl = getApiUrl().replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/api/auth/socket-ticket`, {
      method: "POST",
      credentials: "include",
    });
    if (res.status === 401) {
      authFailureHandler?.();
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { ticket?: string };
    return data.ticket ?? null;
  } catch {
    return null;
  }
}

export function connectSocket(userId: string): Socket {
  if (socketMap.has(userId)) {
    return socketMap.get(userId)!;
  }
  const baseUrl = getApiUrl().replace(/\/$/, "");
  const socket = io(baseUrl, {
    // Called before every connection attempt, including each reconnect, so a
    // fresh ticket is minted every time (tickets are single-use).
    auth: (cb: (data: Record<string, unknown>) => void) => {
      void fetchSocketTicket().then((ticket) => cb(ticket ? { ticket } : {}));
    },
    withCredentials: true,
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

export function getSocket(userId: string): Socket | null {
  return socketMap.get(userId) ?? null;
}

export function disconnectSocket(userId: string) {
  const s = socketMap.get(userId);
  if (s) {
    s.removeAllListeners();
    s.disconnect();
    socketMap.delete(userId);
  }
}
