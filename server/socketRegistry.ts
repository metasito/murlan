// server/socketRegistry.ts — the live Socket.IO server, and the questions the
// rest of the app asks it about an account rather than about a socket.
//
// Apart from socket.ts because both the presence family and socket.ts itself
// need these: keeping them next to `setupSocket` made an import cycle.
import type { Server as SocketServer } from "socket.io";
import { logger } from "./logger.ts";
import { socketRoomMap, userRoom, userSocketMap } from "./gameRoom.ts";
import { safeTimer } from "./gamePersistence.ts";
import { handleSeatRelease } from "./socketTable.ts";
import { applyOrForward } from "./tableRouter.ts";

let _io: SocketServer | null = null;

/** Called once by `setupSocket`; every accessor below is a no-op until it is. */
export function setSocketServer(io: SocketServer) {
  _io = io;
}

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
      // Not handleSeatRelease when a game is live: deleting an account also
      // deletes the rooms rows it hosted, and that path reads the room back and
      // returns when it is gone — leaving the seat live in a hand still being
      // played. Routed, because the game may be held by another instance.
      socket.leave(roomId);
      const vacated = await applyOrForward(io, {
        kind: "vacate",
        roomId,
        userId,
        username,
      });
      if (!vacated.ok) {
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
