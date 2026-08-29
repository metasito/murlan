import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { NextFunction, Request, Response } from "express";
import type { Session, SessionData } from "express-session";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { trackEvent } from "./events.ts";
import { sessionMiddleware } from "./session.ts";
import { consumeSocketTicket } from "./ticket.ts";
import { isAllowedOrigin } from "./cors.ts";
import { createSocketAdapter } from "./socketAdapter.ts";
import { registerRoomHandlers } from "./socketRooms.ts";
import { registerGameplayHandlers } from "./socketGameplay.ts";
import {
  announcePresence,
  evictRemoteSessions,
  evictReplacedSession,
  registerDisconnect,
  registerFriendHandlers,
} from "./socketPresence.ts";
import { setSocketServer } from "./socketRegistry.ts";
import { allowSocketAction } from "./socketSafety.ts";
import { userRoom, userSocketMap } from "./gameRoom.ts";
import { startSweeper } from "./gamePersistence.ts";

// The account-facing surface lives in socketRegistry.ts, apart from this file
// so the presence family can reach it without an import cycle. Re-exported
// because `server/routes.ts` and the timer-containment test ask for it here.
export {
  emitToUser,
  evictUser,
  isUserOnline,
  onlineUserIds,
  __testables,
} from "./socketRegistry.ts";

/**
 * Handshakes one account may complete per minute. Socket.io answers
 * `/socket.io/*` before Express sees it, so no express-rate-limit instance
 * reaches the handshake. Matched to the ticket limiter's 60/min
 * (`server/routes.ts`), which mints one ticket per attempt — a smaller budget
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
};

export function setupSocket(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: {
      // Mirrors the Express allowlist. `origin: "*"` with credentials is both
      // invalid and permissive.
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      methods: ["GET", "POST"],
      credentials: true,
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
  setSocketServer(io);

  // Inject session into socket requests. `next` is cast because express and
  // socket.io disagree about it, not about the session: express overloads it
  // with `"route"`/`"router"`, which socket.io's error-only signature rejects.
  io.use((socket, next) => {
    sessionMiddleware(socket.request as Request, {} as Response, next as NextFunction);
  });

  /**
   * Handshake auth: a valid session, or a valid unconsumed ticket. Nothing
   * else — accepting a bare `handshake.auth.userId` would let any client
   * connect as any user.
   */
  io.use(async (socket, next) => {
    try {
      const req = socket.request as HandshakeRequest;
      const sessionUserId = req.session?.userId;
      const claimedUserId =
        sessionUserId ?? consumeSocketTicket(socket.handshake.auth?.ticket);

      if (!claimedUserId) return next(new Error("Not authenticated"));

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

      const user = await storage.getUser(claimedUserId).catch(() => null);
      if (!user) return next(new Error("Not authenticated"));

      socket.data.username = user.username;
      return next();
    } catch (err) {
      logger.error({ err }, "Socket handshake failed");
      return next(new Error("Not authenticated"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string;
    const username = socket.data.username as string;
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
      evictReplacedSession(io, userId, replacedSocketId, socket);
    }
    evictRemoteSessions(io, userId, socket.id, replacedSocketId);
    logger.debug({ userId, username, socketId: socket.id }, "Socket connected");

    // Every registration below must run before this function's first `await`.
    // Socket.io delivers packets the instant the transport is up, and a client
    // that emits from its own "connect" handler — OnlineGameContext fires
    // game:rejoin there — beats an `await` placed ahead of them. A packet with
    // no listener is dropped silently. The work that needs the database runs
    // after instead.
    const ctx = { io, socket, userId, username };
    registerRoomHandlers(ctx);
    registerGameplayHandlers(ctx);
    registerFriendHandlers(ctx);

    await announcePresence(ctx);

    registerDisconnect(ctx);
  });

  startSweeper(io);

  return io;
}




