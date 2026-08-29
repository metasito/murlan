import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { NextFunction, Request, Response } from "express";
import type { Session, SessionData } from "express-session";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { trackEvent } from "./events.ts";
import { notifyUser } from "./push.ts";
import { sessionMiddleware } from "./session.ts";
import { consumeSocketTicket } from "./ticket.ts";
import { isAllowedOrigin } from "./cors.ts";
import { createSocketAdapter } from "./socketAdapter.ts";
import { registerRoomHandlers } from "./socketRooms.ts";
import { registerGameplayHandlers } from "./socketGameplay.ts";
import {
  armLobbyGrace,
  handleSeatRelease,
  rejoinSocketToTable,
} from "./socketTable.ts";
import { allowSocketAction, onEvent } from "./socketSafety.ts";
import {
  activeGames,
  seatOfUser,
  socketRoomMap,
  spectatorRoomMap,
  userRoom,
  userSocketMap,
} from "./gameRoom.ts";
import { disconnectTimers, DISCONNECT_GRACE_MS } from "./gameTimers.ts";
import { safeTimer, startSweeper } from "./gamePersistence.ts";
import { armTurn, vacateSeat } from "./gameTurn.ts";
import { NoPayloadSchema, FriendInviteSchema } from "./socketSchemas.ts";

/**
 * Handshakes one account may complete per minute. Socket.io answers
 * `/socket.io/*` before Express sees it, so no express-rate-limit instance
 * reaches the handshake. Matched to the ticket limiter's 60/min
 * (`server/routes.ts`), which mints one ticket per attempt — a smaller budget
 * locks a phone out of its own game while its connection flaps.
 */
const HANDSHAKES_PER_MINUTE = 60;

const HANDSHAKE_WINDOW_MS = 60_000;

let _io: SocketServer | null = null;


export function emitToUser(userId: string, event: string, data: unknown) {
  if (!_io) return;
  _io.to(userRoom(userId)).emit(event, data);
}

/**
 * Whether this account has a socket anywhere in the cluster.
 *
 * `adapter.rooms` holds only the sockets this process is serving, so reading it
 * reports a player on another instance as offline. `fetchSockets()` asks the
 * other instances and, when there are none, answers from the local rooms
 * without a round trip.
 *
 * Never throws: the cluster call rejects if an instance does not answer in
 * time, and no caller here has anything better to do with that than treat the
 * account as offline — a friend shown offline is a smaller wrong than a
 * connect handler that dies.
 */
export async function isUserOnline(userId: string): Promise<boolean> {
  if (!_io) return false;
  try {
    return (await _io.in(userRoom(userId)).fetchSockets()).length > 0;
  } catch (err) {
    logger.warn({ err, userId }, "Cluster presence check failed; treating as offline");
    return false;
  }
}

/**
 * Every account with a socket anywhere in the cluster, in one round trip.
 *
 * Filtering a friends list with `isUserOnline` would ask the cluster once per
 * friend; this asks once and answers all of them.
 */
export async function onlineUserIds(): Promise<Set<string>> {
  if (!_io) return new Set();
  try {
    const sockets = await _io.fetchSockets();
    return new Set(
      sockets
        .map((s) => s.data?.userId)
        .filter((id): id is string => typeof id === "string")
    );
  } catch (err) {
    logger.warn({ err }, "Cluster presence sweep failed; reporting no friends online");
    return new Set();
  }
}

/**
 * Throws an account off the server once its `users` row is gone: a socket
 * authenticates once and `socket.data.userId` is never re-checked.
 *
 * Call only after the delete has committed — releasing the seat can end the
 * hand, and the hand's writes must not race the transaction. Never throws.
 */
export async function evictUser(userId: string): Promise<void> {
  const io = _io;
  if (!io) return;
  const socketId = userSocketMap.get(userId);
  if (!socketId) return;
  userSocketMap.delete(userId);
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;

  // Taken here so the disconnect below cannot release the same seat a second
  // time. Spectator state is left to it, which drops it correctly.
  const roomId = socketRoomMap.get(socketId);
  socketRoomMap.delete(socketId);
  const username = (socket.data?.username as string) ?? "";

  if (roomId) {
    try {
      if (activeGames.has(roomId)) {
        // Not handleSeatRelease: deleting an account also deletes the rooms
        // rows it hosted, and that path reads the room back and returns when
        // it is gone — leaving the seat live in a hand still being played.
        socket.leave(roomId);
        await vacateSeat(io, roomId, userId, username);
      } else {
        await handleSeatRelease(io, roomId, userId, username, {
          socket,
          source: "leave",
        });
      }
    } catch (err) {
      logger.error(
        { err, userId, roomId },
        "Failed to release the seat of a deleted account"
      );
    }
  }

  socket.disconnect(true);
}

/**
 * The one internal a test cannot reach any other way: `_io` is private to this
 * module, and the containment property needs a timer body that throws on demand.
 */
export const __testables = {
  runTimerBody: (label: string, roomId: string, fn: () => void) =>
    safeTimer(_io, label, roomId, fn),
};

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
  _io = io;

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
    registerRoomHandlers({ io, socket, userId, username });

    registerGameplayHandlers({ io, socket, userId, username });

    // ── Friend invite ────────────────────────────────────────────────────────

    onEvent(
      socket,
      "friend:invite",
      FriendInviteSchema,
      async ({ friendUserId, roomCode }) => {
        // Only accepted friends may invite each other, and only a few per
        // minute — an invite is otherwise an unauthenticated broadcast
        // primitive that would let any user spam any userId.
        const areFriends = await storage.areFriends(userId, friendUserId);
        if (!areFriends) {
          socket.emit("friend:error", { message: "You are not friends", code: "NOT_FRIENDS" });
          return { ok: false, code: "NOT_FRIENDS" };
        }

        const room = await storage.getRoomByCode(roomCode.toUpperCase());
        if (!room || room.status !== "waiting") {
          socket.emit("friend:error", { message: "Room not found", code: "ROOM_NOT_FOUND" });
          return { ok: false, code: "ROOM_NOT_FOUND" };
        }

        // The code comes from the client, and the client is not what decides
        // whether the sender is at that table. Without this, naming any waiting
        // room's code would invite a friend into a stranger's room.
        const seated = await storage.getRoomPlayers(room.id);
        if (!seated.some((p) => p.userId === userId)) {
          socket.emit("friend:error", { message: "You are not in that room", code: "NOT_IN_ROOM" });
          return { ok: false, code: "NOT_IN_ROOM" };
        }

        // Written before it is announced. The emit and the push are both ways
        // of saying "look now"; the row is what makes the invite exist, and it
        // is the only one of the three that survives the friend being away.
        await storage.recordGameInvite(room.id, userId, friendUserId);

        const friendIsHere = await isUserOnline(friendUserId);
        if (friendIsHere) {
          io.to(userRoom(friendUserId)).emit("friend:invite", {
            from: username,
            roomCode,
          });
        } else {
          // Not awaited: the invite must not be held up by a push, and the row
          // above already means a failed push costs nothing.
          void notifyUser(friendUserId, {
            title: "Murlan",
            code: "FRIEND_INVITE",
            params: { username },
            data: { roomCode },
          });
        }
        // Not "delivered or lost" — the invite is written down either way, so
        // what the host learns is whether their friend is looking right now.
        return { ok: true, code: friendIsHere ? "INVITE_SHOWN" : "INVITE_WAITING" };
      },
      { limit: 5, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "friend:get_online_list",
      NoPayloadSchema,
      async () => {
        const userFriends = await storage.getFriends(userId);
        const online = await onlineUserIds();
        const onlineIds = userFriends
          .map((f) => f.friend.id)
          .filter((id) => online.has(id));
        socket.emit("friend:online_list", { onlineIds });
      },
      { limit: 20, windowMs: 60_000 }
    );

    // ── Reconnect notice + friends list (async — every listener above is
    // already registered, so nothing emitted while these awaits are in
    // flight can be dropped) ──────────────────────────────────────────────

    const pendingDcTimer = disconnectTimers.get(userId);
    if (pendingDcTimer) {
      clearTimeout(pendingDcTimer);
      disconnectTimers.delete(userId);

      for (const [roomId, game] of activeGames.entries()) {
        if (seatOfUser(game, userId) === null || game.gameState.gameOver) continue;
        await rejoinSocketToTable(io, socket, userId, username, roomId, game);
        logger.info(
          { userId, username, roomId },
          "Player reconnected within grace period"
        );
        break;
      }
    }

    try {
      // One read for both halves of the connect notice: the friends who must
      // be told this account came online, and the online list this socket is
      // sent, are the same rows.
      const friends = await storage.getFriends(userId);
      await announceOnlineToFriends(io, userId, friends);
      const online = await onlineUserIds();
      const onlineIds = friends
        .map((f) => f.friend.id)
        .filter((id) => online.has(id));
      socket.emit("friend:online_list", { onlineIds });
    } catch (err) {
      // Swallowing this silently leaves a connected account with no friends
      // list and no way to notice: the client is waiting for a push that is
      // never coming, and only a reconnect asks again.
      logger.warn({ err, userId }, "friend list read failed; this socket gets no online list");
    }

    // ── Disconnect ───────────────────────────────────────────────────────────

    socket.on("disconnect", () => {
      void (async () => {
        try {
          // A spectator holds no seat, so none of the grace/AFK machinery below
          // applies to them; they are simply dropped.
          const spectatingRoom = spectatorRoomMap.get(socket.id);
          if (spectatingRoom) {
            activeGames.get(spectatingRoom)?.spectators.delete(userId);
            spectatorRoomMap.delete(socket.id);
          }
          // Only blank the mapping if it still points at THIS socket: a second
          // tab or a fast reconnect would otherwise black out the live one.
          if (userSocketMap.get(userId) === socket.id) {
            userSocketMap.delete(userId);
          }
          logger.debug({ userId, socketId: socket.id }, "Socket disconnected");

          await storage
            .updateLastSeen(userId)
            .catch((err) =>
              logger.debug({ err, userId }, "Failed to update users.last_seen on disconnect")
            );

          const lastSeen = new Date().toISOString();
          void emitFriendStatusOffline(io, userId, lastSeen);

          const currentRoomId = socketRoomMap.get(socket.id);
          socketRoomMap.delete(socket.id);
          // Three paths reach a return without announcing the drop, and from
          // outside a seat that should have been released reads exactly like
          // one that was never held. Which path ran is the whole diagnosis.
          if (!currentRoomId) {
            logger.debug({ userId, socketId: socket.id }, "Socket held no room");
            return;
          }

          // Still connected elsewhere — nothing to tear down.
          if (userSocketMap.has(userId)) {
            logger.debug(
              {
                userId,
                socketId: socket.id,
                roomId: currentRoomId,
                liveSocketId: userSocketMap.get(userId),
              },
              "Account still holds another socket"
            );
            return;
          }

          const game = activeGames.get(currentRoomId);

          if (!game) {
            // A waiting lobby. Nobody is mid-turn, but the seat is still
            // theirs: releasing it on the disconnect itself made a two-second
            // hiccup cost a player their place in a room they were waiting in.
            await armLobbyGrace(io, currentRoomId, userId, username);
            return;
          }

          if (game.gameState.gameOver) {
            // The results screen is the opposite case: the seat counts towards
            // the rematch gate, so holding it means the others can never start
            // the next manche.
            logger.debug(
              { userId, socketId: socket.id, roomId: currentRoomId },
              "Seat released without a grace period"
            );
            await handleSeatRelease(io, currentRoomId, userId, username, {
              source: "disconnect",
            });
            return;
          }

          // Distinct from losing: the hand was still running when they went.
          trackEvent("game.abandoned", userId, {
            playerCount: game.gameState.players.length,
            gameMode: game.gameState.gameMode,
          });

          const graceSeconds = Math.round(DISCONNECT_GRACE_MS / 1000);
          io.to(currentRoomId).emit("game:player_disconnected", {
            userId,
            username,
            code: "PLAYER_DISCONNECTED_GRACE",
            // The grace period is configurable, so the number has to come from
            // the same constant the timer below is armed with — a hardcoded
            // "60 seconds" in the text is a promise the server may not keep.
            message: `${username} disconnected. They have ${graceSeconds} seconds to rejoin.`,
            params: { username, seconds: graceSeconds },
          });

          // A vacant seat must keep playing while we wait, or the table stalls
          // for a full minute on this player's turn.
          armTurn(io, currentRoomId);

          const prevTimer = disconnectTimers.get(userId);
          if (prevTimer) clearTimeout(prevTimer);

          const dcTimer = setTimeout(() => {
            void (async () => {
              try {
                disconnectTimers.delete(userId);
                if (userSocketMap.has(userId)) return;

                await storage
                  .removeRoomPlayer(currentRoomId, userId)
                  .catch((err) =>
                    logger.warn(
                      { err, roomId: currentRoomId, userId },
                      "Failed to delete the room_players row after the disconnect grace expired — the seat stays counted as taken"
                    )
                  );
                await vacateSeat(io, currentRoomId, userId, username);
                logger.info(
                  { userId, username, roomId: currentRoomId },
                  "Disconnect grace expired — seat handed to a bot"
                );
              } catch (err) {
                logger.error(
                  { err, userId, roomId: currentRoomId },
                  "Disconnect timeout handler failed"
                );
              }
            })();
          }, DISCONNECT_GRACE_MS);
          disconnectTimers.set(userId, dcTimer);
        } catch (err) {
          logger.error({ err, userId }, "disconnect handler failed");
        }
      })();
    });
  });

  startSweeper(io);

  return io;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────






// Stable code counterpart to seatClaimMessage's English fallback text, so the
// client can localise the same rejection reason (see the `code` field above).



/**
 * The same one-socket-per-account rule as `evictReplacedSession` below, for
 * the sockets this process cannot see.
 *
 * `userSocketMap` and `io.sockets.sockets` are both process-local, so before
 * the adapter a second connection on another instance simply went unnoticed
 * and the account held two live sockets — the singleton invariant held only
 * inside one process. A room-scoped disconnect is the one form of this that
 * crosses instances.
 *
 * Both exclusions matter: the arriving socket must survive, and a *local*
 * predecessor belongs to `evictReplacedSession`, which moves the room
 * association across before closing it. Cutting it here instead would strand
 * the seat.
 *
 * Not gated on there being more than one instance, though the adapter would
 * answer that for free: it answers from the heartbeat's view of its peers, and
 * a second instance is invisible for the first few seconds of its life —
 * exactly when a player is most likely to be handed to it. One `pg_notify` per
 * connection is far below the queries this handler already runs.
 */
function evictRemoteSessions(
  io: SocketServer,
  userId: string,
  keepSocketId: string,
  locallyHandledSocketId: string | undefined
) {
  let targets = io.in(userRoom(userId)).except(keepSocketId);
  if (locallyHandledSocketId) targets = targets.except(locallyHandledSocketId);
  targets.disconnectSockets(true);
}

/**
 * Enforces one live socket per account: the newest connection keeps it.
 *
 * `userSocketMap` must already name the new socket — the replaced socket's
 * disconnect handler reads it and then declines to act, so the room
 * association has to move with the account or nothing releases the seat.
 *
 * The client stops reconnecting on this code (`context/SocketContext.tsx`):
 * socket.io retries forever, so two tabs would evict each other indefinitely.
 */
function evictReplacedSession(
  io: SocketServer,
  userId: string,
  replacedSocketId: string,
  replacement: Socket
) {
  const replaced = io.sockets.sockets.get(replacedSocketId);
  if (!replaced) return;

  const roomId = socketRoomMap.get(replacedSocketId);
  if (roomId) {
    socketRoomMap.delete(replacedSocketId);
    socketRoomMap.set(replacement.id, roomId);
    void replacement.join(roomId);
  }

  replaced.emit("socket:error", {
    code: "SESSION_REPLACED",
    message: "Your account was opened somewhere else. This session has been closed.",
  });
  logger.info(
    { userId, replacedSocketId },
    "Session replaced by a newer connection for the same account"
  );
  replaced.disconnect(true);
}

/** Takes the friend rows rather than reading them: the connection handler pays
 *  for one `getFriends`, not two. */
async function announceOnlineToFriends(
  io: SocketServer,
  userId: string,
  friends: Awaited<ReturnType<typeof storage.getFriends>>
) {
  // The read the caller did is awaited, so the socket may already be gone.
  if (!(await isUserOnline(userId))) return;
  friends.forEach((f) => {
    io.to(userRoom(f.friend.id)).emit("friend:status", { userId, online: true });
  });
}

async function emitFriendStatusOffline(
  io: SocketServer,
  userId: string,
  lastSeen: string
) {
  // Debounced, and re-checked after every await: a reconnect inside any of
  // these windows must cancel the offline notice rather than race it.
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (await isUserOnline(userId)) return;
  const friends = await storage.getFriends(userId).catch(() => []);
  if (await isUserOnline(userId)) return;
  friends.forEach((f) => {
    io.to(userRoom(f.friend.id)).emit("friend:status", {
      userId,
      online: false,
      lastSeen,
    });
  });
}
