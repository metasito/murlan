import { Platform } from "react-native";
import { io, type Socket as UntypedSocket } from "socket.io-client";
import { getApiUrl, requestOf, type Reply } from "@/lib/query-client";
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@/shared/protocol";
import { NOT_AUTHENTICATED } from "@/shared/handshake";

type RawSocket = UntypedSocket<ServerToClientEvents, ClientToServerEvents>;

export type DisconnectReason = UntypedSocket.DisconnectReason;

/**
 * What a caller may do with a socket. It cannot open or close one, or reach its engine: that is
 * `reopenSocket`, `reconnectSocket`, `closeSocket` and `haltSocket`, which know when a websocket is
 * still connecting.
 */
export type Socket = Omit<RawSocket, "connect" | "open" | "disconnect" | "close" | "io">;

const raw = (socket: Socket) => socket as RawSocket;

/**
 * `onAuthFailure` fires when the session is dead: on native the ticket endpoint
 * answers 401, on web the cookie-only handshake is refused as unauthenticated.
 * Neither can succeed again until the user signs in, so the owner stops
 * retrying instead.
 */
interface SocketEntry {
  socket: RawSocket;
  handlers: { onAuthFailure: () => void };
  retire: () => void;
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
 * websocket upgrade, and the handshake accepts only a session or a ticket. Web
 * never asks: its upgrade carries the cookie, which the handshake reads first.
 *
 * Uses a raw fetch (not api) so a 401 can be told apart from a
 * transient network failure instead of being swallowed identically.
 */
async function fetchSocketTicket(onAuthFailure: () => void): Promise<string | null> {
  try {
    const res = await fetch(...requestOf("POST auth/socket-ticket"));
    if (res.status === 401) {
      onAuthFailure();
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<Reply<"POST auth/socket-ticket">>;
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
  let retired = false;
  const baseUrl = getApiUrl().replace(/\/$/, "");
  const socket: RawSocket = io(baseUrl, {
    // Called before every connection attempt, including each reconnect, so a
    // fresh ticket is minted every time (tickets are single-use).
    auth: (cb: (data: Record<string, unknown>) => void) => {
      if (retired) return;
      if (Platform.OS === "web") return cb({ protocolVersion: PROTOCOL_VERSION });
      const attempt = ++latestAttempt;
      void fetchSocketTicket(() => handlers.onAuthFailure()).then((ticket) => {
        if (attempt !== latestAttempt || retired) return;
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
    // `SocketProvider` drives every retry through `lib/reconnectDelay.ts`.
    // Socket.io's own backoff draws one random number for both the sign and the
    // size of its jitter, so a dropped crowd comes back in ten 50 ms teeth.
    reconnection: false,
  });
  if (Platform.OS === "web") {
    socket.on("connect_error", (err) => {
      if (err.message === NOT_AUTHENTICATED) handlers.onAuthFailure();
    });
  }
  socketMap.set(userId, { socket, handlers, retire: () => (retired = true) });
  mapListeners.forEach((fn) => fn());
  return socket;
}


const pendingClose = new WeakMap<Socket, () => void>();
const halted = new WeakSet<Socket>();

function cancelPendingClose(socket: Socket): void {
  pendingClose.get(socket)?.();
}

/**

 * once its engine settles, unless a reconnect takes the attempt over first.
 */
export function closeSocket(socket: Socket): void {
  const s = raw(socket);
  if (s.io.engine?.readyState !== "opening") {
    cancelPendingClose(socket);
    s.disconnect();
    return;
  }
  if (pendingClose.has(socket)) return;
  const cancel = () => {
    s.io.off("open", close);
    s.io.off("error", close);
    pendingClose.delete(socket);
  };
  const close = () => {
    cancel();
    s.disconnect();
  };
  pendingClose.set(socket, cancel);
  s.io.once("open", close);
  s.io.once("error", close);
}

/** Closes a socket that must stay shut until `reopenSocket` or `reconnectSocket` takes it back. */
export function haltSocket(socket: Socket): void {
  halted.add(socket);
  closeSocket(socket);
}

export const isHalted = (socket: Socket) => halted.has(socket);

/** Connects a socket that is not connected; a close still waiting on an opening attempt is dropped, so the attempt stands. */
export function reopenSocket(socket: Socket): void {
  halted.delete(socket);
  cancelPendingClose(socket);
  raw(socket).connect();
}

/** A fresh attempt; one already opening is that attempt, and closing it would only log. */
export function reconnectSocket(socket: Socket): void {
  halted.delete(socket);
  cancelPendingClose(socket);
  const s = raw(socket);
  if (s.io.engine?.readyState === "opening") return;
  s.disconnect().connect();
}

/**
 * A retired socket never hands over credentials again, so it never sends the
 * namespace CONNECT: nothing can be emitted or received on it once signed out.
 */
export function disconnectSocket(userId: string) {
  const entry = socketMap.get(userId);
  if (!entry) return;
  const { socket } = entry;
  entry.retire();
  entry.handlers.onAuthFailure = () => {};
  socket.removeAllListeners();
  closeSocket(socket);
  socketMap.delete(userId);
  mapListeners.forEach((fn) => fn());
}
