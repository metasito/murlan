import { io, type Socket as UntypedSocket } from "socket.io-client";
import { getApiUrl } from "@/lib/query-client";
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@/shared/protocol";

export type Socket = UntypedSocket<ServerToClientEvents, ClientToServerEvents>;

/**
 * `onAuthFailure` fires when the ticket endpoint reports the session is dead
 * (401): a ticket mint can never succeed again until the user signs in, so the
 * owner stops retrying instead.
 */
interface SocketEntry {
  socket: Socket;
  handlers: { onAuthFailure: () => void };
}

const socketMap = new Map<string, SocketEntry>();

/**
 * The map, readable by React without owning a copy of it.
 *
 * `connectSocket` mints one, so asking it during a render would be a render
 * that creates a connection. These two only report what is already there, which
 * is what lets `SocketContext` read the socket rather than mirror it into state.
 */
const mapListeners = new Set<() => void>();

export function subscribeToSockets(onChange: () => void): () => void {
  mapListeners.add(onChange);
  return () => {
    mapListeners.delete(onChange);
  };
}

export function peekSocket(userId: string | null | undefined): Socket | null {
  return userId ? (socketMap.get(userId)?.socket ?? null) : null;
}

/**
 * Mints a short-lived, single-use handshake ticket from the authenticated REST
 * session. Native clients do not reliably send the session cookie on the
 * websocket upgrade, and the handshake accepts only a session or a ticket.
 *
 * Uses a raw fetch (not apiRequest) so a 401 can be told apart from a
 * transient network failure instead of being swallowed identically.
 */
async function fetchSocketTicket(onAuthFailure: () => void): Promise<string | null> {
  try {
    const baseUrl = getApiUrl().replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/api/auth/socket-ticket`, {
      method: "POST",
      credentials: "include",
    });
    if (res.status === 401) {
      onAuthFailure();
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { ticket?: string };
    return data.ticket ?? null;
  } catch {
    return null;
  }
}

export function connectSocket(userId: string, { onAuthFailure }: { onAuthFailure: () => void }): Socket {
  const existing = socketMap.get(userId);
  if (existing) {
    existing.handlers.onAuthFailure = onAuthFailure;
    return existing.socket;
  }
  const handlers = { onAuthFailure };
  let latestAttempt = 0;
  const baseUrl = getApiUrl().replace(/\/$/, "");
  const socket = io(baseUrl, {
    // Called before every connection attempt, including each reconnect, so a
    // fresh ticket is minted every time (tickets are single-use).
    auth: (cb: (data: Record<string, unknown>) => void) => {
      const attempt = ++latestAttempt;
      void fetchSocketTicket(() => handlers.onAuthFailure()).then((ticket) => {
        if (attempt !== latestAttempt) return;
        cb(ticket ? { ticket, protocolVersion: PROTOCOL_VERSION } : { protocolVersion: PROTOCOL_VERSION });
      });
    },
    withCredentials: true,
    // Websocket only, matching the server. An HTTP long-polling handshake is
    // spread across several requests that must all reach the same instance,
    // and this platform's session affinity is documented as best effort only —
    // so polling is not a fallback here, it is an intermittent 400.
    transports: ["websocket"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  socketMap.set(userId, { socket, handlers });
  mapListeners.forEach((fn) => fn());
  return socket;
}


export function disconnectSocket(userId: string) {
  const s = socketMap.get(userId)?.socket;
  if (s) {
    s.removeAllListeners();
    s.disconnect();
    socketMap.delete(userId);
    mapListeners.forEach((fn) => fn());
  }
}
