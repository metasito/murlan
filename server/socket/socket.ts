import { Server } from "socket.io";
import type { GameSocket as Socket, SocketServer } from "./socketTypes.ts";
import {
  AUTH_UNAVAILABLE,
  CLIENT_OUTDATED,
  MIN_PROTOCOL_VERSION,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "../../shared/protocol.ts";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Session, SessionData } from "express-session";
import { userStore } from "../store/userStore.ts";
import { logger } from "../shared/logger.ts";
import { trackEvent } from "../shared/events.ts";
import { sessionMiddleware } from "../http/session.ts";
import { redeemSocketTicket, verifySocketTicket } from "./ticket.ts";
import { isAllowedOrigin } from "../http/cors.ts";
import { createSocketAdapter } from "./socketAdapter.ts";
import { registerRoomHandlers } from "./socketRooms.ts";
import { registerGameplayHandlers } from "./socketGameplay.ts";
import {
  announcePresence,
  evictRemoteSessions,
  evictReplacedSession,
  registerDisconnect,
  registerFriendHandlers,
  registerSessionEviction,
} from "./socketPresence.ts";
import { bindSocketRuntime } from "./socketRegistry.ts";
import { allowSocketAction, answerUnknownEvents } from "./socketSafety.ts";
import { userRoom, userSocketMap } from "../game/gameRoom.ts";
import { startSweeper, tableWriters } from "../game/gamePersistence.ts";
import { resumeOrphanedTables } from "../game/tableLifecycle.ts";
import { createTableRuntime } from "../game/tableRuntime.ts";
import { activeGameStore } from "../store/activeGameStore.ts";
import { roomStore } from "../store/roomStore.ts";
import { registerStopSpectating } from "./seating.ts";
import { socketOutbox, socketPresence } from "./socketOutbox.ts";

/**
 * Handshakes one account may complete per minute. Socket.io answers
 * `/socket.io/*` before Express sees it, so no express-rate-limit instance
 * reaches the handshake. Matched to the ticket limiter's 60/min
 * (`server/http/routes/auth.ts`), which mints one ticket per attempt — a smaller budget
 * locks a phone out of its own game while its connection flaps.
 */
const HANDSHAKES_PER_MINUTE = 60;

const HANDSHAKE_WINDOW_MS = 60_000;








// ─── Server ───────────────────────────────────────────────────────────────────
/**
 * express-session types its attachment as always present. The handshake reaches
 * the auth guard whether the store answered or not.
 */
type HandshakeRequest = IncomingMessage & {
  session?: Session & Partial<SessionData>;
  sessionID?: string;
};

/**
 * Injects the session into a socket's request. A store that cannot answer is
 * transient, so it is refused the way the auth guard below refuses one — the
 * client retries — and never with the driver's own message.
 */
export function handshakeSession(middleware: RequestHandler) {
  return (socket: { request: IncomingMessage }, next: (err?: Error) => void) => {
    middleware(socket.request as Request, {} as Response, ((err?: unknown) => {
      if (!err) return next();
      logger.error({ err }, "Socket handshake could not load the session");
      next(new Error(AUTH_UNAVAILABLE));
    }) as NextFunction);
  };
}

export function setupSocket(httpServer: HttpServer) {
  const io: SocketServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      // Mirrors the Express allowlist. `origin: "*"` with credentials is both
      // invalid and permissive.
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    // `cors` only shapes response headers, and a websocket upgrade carries
    // none of them: without this a disallowed origin still connects.
    allowRequest: (req, callback) => {
      callback(null, isAllowedOrigin(req.headers.origin));
    },
    // Websocket only. The Postgres adapter's own documentation requires sticky
    // sessions, because an HTTP long-polling handshake is spread across several
    // requests that must all reach one instance — and this platform cannot
    // promise that: Cloud Run's session affinity is documented as best effort,
    // and explicitly "you cannot assume that a client will always reconnect to
    // the same instance, even when session affinity is enabled". Leaving
    // polling enabled would trade silently dropped broadcasts for HTTP 400s
    // under exactly the load that creates a second instance.
    transports: ["websocket"],
    maxHttpBufferSize: 1e5,
  });
  io.adapter(createSocketAdapter());
  // Before the first connection: a table action forwarded from another
  // instance arrives on `io`, not on a socket, and one that lands before the
  // runtime's listener exists is answered by nobody.
  const store = { games: activeGameStore, rooms: roomStore };
  const rt = createTableRuntime({
    out: socketOutbox(io),
    presence: socketPresence(io),
    writers: tableWriters(store),
    transport: io,
    store,
  });
  bindSocketRuntime(rt);
  registerSessionEviction(io);
  registerStopSpectating(rt);

  io.use(handshakeSession(sessionMiddleware));

  /**
   * Handshake auth: a valid session, or a valid unconsumed ticket. Nothing
   * else — accepting a bare `handshake.auth.userId` would let any client
   * connect as any user.
   */
  io.use(async (socket, next) => {
    try {
      // Before the ticket is redeemed: an outdated bundle keeps its ticket and
      // spends none of the handshake budget on a connection it cannot use.
      const version: unknown = socket.handshake.auth?.protocolVersion;
      if (typeof version !== "number" || version < MIN_PROTOCOL_VERSION) {
        return next(new Error(CLIENT_OUTDATED));
      }
      const req = socket.request as HandshakeRequest;
      const sessionUserId = req.session?.userId;
      const ticket = sessionUserId ? null : verifySocketTicket(socket.handshake.auth?.ticket);
      const claimedUserId = sessionUserId ?? ticket?.userId;

      if (!claimedUserId) return next(new Error("Not authenticated"));
      socket.data.sid = sessionUserId ? req.sessionID : ticket?.sid;

      // The session or the ticket has already proved this id, so the budget is
      // keyed on it and spent *before* the account's first query rather than
      // after it — the queries are what the limit exists to bound.
      socket.data.userId = claimedUserId;
      if (
        !allowSocketAction(
          socket,
          "connection",
          HANDSHAKES_PER_MINUTE,
          HANDSHAKE_WINDOW_MS
        )
      ) {
        logger.warn({ userId: claimedUserId }, "Handshake refused — too many connections");
        return next(new Error("Too many connections"));
      }

      if (ticket && !(await redeemSocketTicket(ticket))) {
        return next(new Error("Not authenticated"));
      }
      const user = await userStore.getUser(claimedUserId);
      if (!user) return next(new Error("Not authenticated"));
      return next();
    } catch (err) {
      logger.error({ err }, "Socket handshake failed");
      return next(new Error(AUTH_UNAVAILABLE));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string;
    // The mapping has to name the new socket before the old one is closed —
    // see evictReplacedSession for what reads it on the way out.
    const replacedSocketId = userSocketMap.get(userId);
    userSocketMap.set(userId, socket.id);
    // Before the first `await`, like every listener below: a send addressed to
    // this account between here and the end of the handler must find it.
    void socket.join(userRoom(userId));
    // Opening a socket is what reaching the online area does, so this is the
    // server's only sight of "got past the menu".
    trackEvent("lobby.entered", userId);
    if (replacedSocketId && replacedSocketId !== socket.id) {
      evictReplacedSession(io, rt, userId, replacedSocketId, socket);
    }
    evictRemoteSessions(io, userId, socket);
    logger.debug({ userId, socketId: socket.id }, "Socket connected");

    // Every registration below must run before this function's first `await`.
    // Socket.io delivers packets the instant the transport is up, and a client
    // that emits from its own "connect" handler — OnlineGameContext fires
    // game:rejoin there — beats an `await` placed ahead of them. A packet with
    // no listener is dropped silently. The work that needs the database runs
    // after instead.
    const ctx = { rt, socket, userId };
    answerUnknownEvents(socket);
    registerRoomHandlers(ctx);
    registerGameplayHandlers(ctx);
    registerFriendHandlers(ctx);
    registerDisconnect(ctx);

    await announcePresence(ctx);
  });

  startSweeper(rt, resumeOrphanedTables);

  return { io, rt };
}




