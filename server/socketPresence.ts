// server/socketPresence.ts — who is here.
//
// One account's arrival and departure, and what its friends are told about
// both: the invite it can send, the online list it is given, the notice its
// friends receive, and the grace its seat is held under when it drops.
//
// `registerDisconnect` is called after this module's own awaits rather than
// before them, exactly as it was inline.
import type { Server as SocketServer, Socket } from "socket.io";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { notifyUser } from "./push.ts";
import { onEvent } from "./socketSafety.ts";
import {
  activeGames,
  seatOfUser,
  socketRoomMap,
  spectatorRoomMap,
  userRoom,
  userSocketMap,
} from "./gameRoom.ts";
import { clearDisconnectGrace } from "./gameTimers.ts";
import {
  announceRejoin,
  armLobbyGrace,
  joinSocketToRoom,
} from "./socketTable.ts";
import { applyOrForward } from "./tableRouter.ts";
import { NoPayloadSchema, FriendInviteSchema } from "./socketSchemas.ts";
import { isUserOnline, onlineUserIds } from "./socketRegistry.ts";

export interface PresenceContext {
  io: SocketServer;
  socket: Socket;
  userId: string;
  username: string;
}

export function registerFriendHandlers({ io, socket, userId, username }: PresenceContext) {

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
}

/**
 * The connect notice: a hand still held under the disconnect grace is resumed,
 * and the account's friends learn it is here.
 *
 * Deliberately after every listener is registered — these awaits are exactly
 * the window in which a packet arriving with no listener would be dropped.
 */
export async function announcePresence({ io, socket, userId, username }: PresenceContext) {

    if (clearDisconnectGrace(userId)) {
      for (const [roomId, game] of activeGames.entries()) {
        if (seatOfUser(game, userId) === null || game.gameState.gameOver) continue;
        joinSocketToRoom(socket, roomId);
        await announceRejoin(io, userId, username, roomId, game);
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
}

export function registerDisconnect({ io, socket, userId, username }: PresenceContext) {

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

          // Whether this is a hand in progress, a finished table or a waiting
          // lobby is a question about the game, which lives in one instance's
          // memory — and not necessarily this one. Reading `activeGames` here
          // read every table held elsewhere as a lobby and released the seat.
          const seat = await applyOrForward(io, {
            kind: "seatLost",
            roomId: currentRoomId,
            userId,
            username,
          });
          // `NOT_SEATED` is the owner saying the table is live and this
          // account holds no seat at it; only "no game anywhere" is a lobby.
          if (seat.code !== "NO_LIVE_GAME") return;

          // No instance holds a game for this room. Nobody is mid-turn, but the
          // seat is still theirs: releasing it on the disconnect itself made a
          // two-second hiccup cost a player their place in a room they were
          // waiting in.
          await armLobbyGrace(io, currentRoomId, userId, username);
        } catch (err) {
          logger.error({ err, userId }, "disconnect handler failed");
        }
      })();
    });
}

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
export function evictRemoteSessions(
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
export function evictReplacedSession(
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
