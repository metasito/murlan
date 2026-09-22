// server/socket/socketPresence.ts — who is here.
//
// One account's arrival and departure, and what its friends are told about
// both: the invite it can send, the online list it is given, the notice its
// friends receive, and the grace its seat is held under when it drops.
//
// `registerDisconnect` registers synchronously, before `announcePresence`'s
// own awaits (server/socket/socket.ts): a socket that closes while those are still
// running has no other listener that will ever see it.
import type { DisconnectReason } from "socket.io";
import type { SocketServer, GameSocket as Socket } from "./socketTypes.ts";
import { friendStore } from "../store/friendStore.ts";
import { roomStore } from "../store/roomStore.ts";
import { userStore } from "../store/userStore.ts";
import { logger } from "../http/logger.ts";
import { notifyUser } from "./push.ts";
import { trackEvent } from "./events.ts";
import { onEvent } from "./socketSafety.ts";
import {
  activeGames,
  isShuttingDown,
  seatOfUser,
  socketRoomMap,
  userRoom,
  userSocketMap,
} from "../game/gameRoom.ts";
import { clearDisconnectGrace } from "../game/gameTimers.ts";
import {
  announceRejoin,
  armLobbyGrace,
  roomStatePayload,
} from "./socketTable.ts";
import { seatSocket, stopSpectating } from "./seating.ts";
import { applyOrForward } from "../game/tableRouter.ts";
import { NoPayloadSchema, FriendInviteSchema } from "./socketSchemas.ts";
import { isUserOnline, onlineUserIds } from "./socketRegistry.ts";
import { payload } from "./payload.ts";

export interface PresenceContext {
  io: SocketServer;
  socket: Socket;
  userId: string;
}

export function registerFriendHandlers({ io, socket, userId }: PresenceContext) {

    onEvent(
      socket,
      "friend:invite",
      FriendInviteSchema,
      async ({ friendUserId, roomCode }) => {
        // Only accepted friends may invite each other, and only a few per
        // minute — an invite is otherwise an unauthenticated broadcast
        // primitive that would let any user spam any userId.
        const areFriends = await friendStore.areFriends(userId, friendUserId);
        if (!areFriends) {
          socket.emit("friend:error", payload("NOT_FRIENDS"));
          return { ok: false, code: "NOT_FRIENDS" };
        }

        const room = await roomStore.getRoomByCode(roomCode.toUpperCase());
        if (!room || room.status !== "waiting") {
          socket.emit("friend:error", payload("ROOM_NOT_FOUND"));
          return { ok: false, code: "ROOM_NOT_FOUND" };
        }

        // The code comes from the client, and the client is not what decides
        // whether the sender is at that table. Without this, naming any waiting
        // room's code would invite a friend into a stranger's room.
        const seated = await roomStore.getRoomPlayers(room.id);
        if (!seated.some((p) => p.userId === userId)) {
          socket.emit("friend:error", payload("NOT_IN_ROOM"));
          return { ok: false, code: "NOT_IN_ROOM" };
        }

        // Written before it is announced. The emit and the push are both ways
        // of saying "look now"; the row is what makes the invite exist, and it
        // is the only one of the three that survives the friend being away.
        await friendStore.recordGameInvite(room.id, userId, friendUserId);

        // The row is what holds the seat, so the room has to be told the moment
        // it exists — otherwise the seat waiting for this friend reads as an
        // empty one until something else happens to broadcast.
        io.to(room.id).emit("room:state", await roomStatePayload(room, seated));

        // Read now, not at the handshake: a rename in between would send the
        // name a stranger may have registered since.
        const username = (await userStore.getUser(userId))?.username ?? "";
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
        const userFriends = await friendStore.getFriends(userId);
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
export async function announcePresence({ io, socket, userId }: PresenceContext) {

    if (clearDisconnectGrace(userId)) {
      for (const [roomId, game] of activeGames.entries()) {
        if (seatOfUser(game, userId) === null || game.gameState.gameOver) continue;
        await seatSocket(io, socket, userId, roomId);
        try {
          await announceRejoin(io, userId, roomId, game);
          logger.info(
            { userId, roomId },
            "Player reconnected within grace period"
          );
        } catch (err) {
          logger.error({ err, userId, roomId }, "grace rejoin failed");
        }
        break;
      }
    }

    try {
      // One read for both halves of the connect notice: the friends who must
      // be told this account came online, and the online list this socket is
      // sent, are the same rows.
      const friends = await friendStore.getFriends(userId);
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

const pendingDisconnects = new Set<Promise<void>>();

/**
 * Resolves once every disconnect handler already started has finished, or at
 * `timeoutMs`. `io.close()` starts them and waits for none, and a seat lost at a
 * table another instance owns is forwarded over the adapter pool.
 */
export async function settleDisconnects(timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled([...pendingDisconnects]),
    new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  clearTimeout(timer);
}

export function registerDisconnect({ io, socket, userId }: PresenceContext) {

    socket.on("disconnect", (reason: DisconnectReason) => {
      trackEvent("socket.closed", userId, { reason });
      const handled = (async () => {
        try {
          // A spectator holds no seat, so none of the grace/AFK machinery below
          // applies to them; they are simply dropped.
          await stopSpectating(io, socket, userId);
          // Only blank the mapping if it still points at THIS socket: a second
          // tab or a fast reconnect would otherwise black out the live one.
          if (userSocketMap.get(userId) === socket.id) {
            userSocketMap.delete(userId);
          }
          logger.debug({ userId, socketId: socket.id }, "Socket disconnected");

          await userStore
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
          // A lobby has no game anywhere, so a process on its way out need not
          // spend its last seconds asking.
          const lobby =
            isShuttingDown() &&
            (await roomStore.getRoomById(currentRoomId))?.status === "waiting";
          const seat = lobby
            ? { ok: false, code: "NO_LIVE_GAME" }
            : await applyOrForward(io, {
                kind: "seatLost",
                roomId: currentRoomId,
                userId,
              });
          // Only "no game anywhere" is a lobby. `NOT_SEATED` is the owner
          // saying the table is live and this account holds no seat at it, and
          // `TABLE_UNREACHABLE` is nobody having answered — releasing a seat on
          // either would be acting on a question that was never answered.
          if (seat.code !== "NO_LIVE_GAME") return;

          // No instance holds a game for this room. Nobody is mid-turn, but the
          // seat is still theirs: releasing it on the disconnect itself made a
          // two-second hiccup cost a player their place in a room they were
          // waiting in.
          await armLobbyGrace(io, currentRoomId, userId);
        } catch (err) {
          logger.error({ err, userId }, "disconnect handler failed");
        }
      })();
      pendingDisconnects.add(handled);
      void handled.finally(() => pendingDisconnects.delete(handled));
    });
}

/**
 * The same one-socket-per-account rule as `evictReplacedSession` below, for
 * the sockets this process cannot see.
 *
 * `userSocketMap` and `io.sockets.sockets` are both process-local, so before
 * the adapter a second connection on another instance simply went unnoticed
 * and the account held two live sockets — the singleton invariant held only
 * inside one process. The broadcast carries the arriving socket's handshake
 * time and each instance closes only what connected before it: the adapter can
 * deliver one connection's eviction after the next connection has arrived,
 * so excluding only the arriving socket's id would let it close a newer one.
 *
 * A *local* predecessor belongs to `evictReplacedSession`, which moves the room
 * association across before closing it — and has closed it by the time this
 * runs, so it is no longer in the room.
 *
 * Not gated on there being more than one instance, though the adapter would
 * answer that for free: it answers from the heartbeat's view of its peers, and
 * a second instance is invisible for the first few seconds of its life —
 * exactly when a player is most likely to be handed to it. One `pg_notify` per
 * connection is far below the queries this handler already runs.
 */
export function evictRemoteSessions(io: SocketServer, userId: string, keep: Socket) {
  const eviction: Eviction = { userId, keepSocketId: keep.id, connectedAt: keep.handshake.issued };
  evictOlderSessions(io, eviction);
  io.serverSideEmit(SESSION_EVICTION_EVENT, eviction);
}

export const SESSION_EVICTION_EVENT = "murlan:evict-session";

interface Eviction {
  userId: string;
  keepSocketId: string;
  connectedAt: number;
}

// Each instance stamps with its own clock, so two connections closer together than the skew between instances can still be misordered; a shared sequence fixes that if it is ever seen.
export function evictOlderSessions(io: SocketServer, { userId, keepSocketId, connectedAt }: Eviction) {
  for (const id of [...(io.sockets.adapter.rooms.get(userRoom(userId)) ?? [])]) {
    const socket = io.sockets.sockets.get(id);
    if (!socket || id === keepSocketId) continue;
    const issued = socket.handshake.issued;
    // Two instances stamping the same millisecond each receive the other's eviction; the id breaks the tie so exactly one closes.
    if (issued > connectedAt || (issued === connectedAt && id > keepSocketId)) continue;
    socket.emit("socket:error", payload("SESSION_REPLACED"));
    socket.disconnect(true);
  }
}

export function registerSessionEviction(io: SocketServer) {
  io.on(SESSION_EVICTION_EVENT, (eviction: Eviction) => evictOlderSessions(io, eviction));
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
    void seatSocket(io, replacement, userId, roomId);
  }

  replaced.emit("socket:error", payload("SESSION_REPLACED"));
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
  friends: Awaited<ReturnType<typeof friendStore.getFriends>>
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
  const friends = await friendStore.getFriends(userId).catch(() => []);
  if (await isUserOnline(userId)) return;
  friends.forEach((f) => {
    io.to(userRoom(f.friend.id)).emit("friend:status", {
      userId,
      online: false,
      lastSeen,
    });
  });
}
