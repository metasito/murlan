// server/socketRegistry.ts — the live Socket.IO server, and the questions the
// rest of the app asks it about an account rather than about a socket.
//
// Apart from socket.ts because both the presence family and socket.ts itself
// need these: keeping them next to `setupSocket` made an import cycle.
import type { SocketServer } from "./socketTypes.ts";
import { logger } from "./logger.ts";
import { friendStore } from "./friendStore.ts";
import { socketRoomMap, userRoom, userSocketMap } from "./gameRoom.ts";
import { safeTimer } from "./gamePersistence.ts";
import { announceRoomChanged, handleSeatRelease } from "./socketTable.ts";
import { applyOrForward } from "./tableRouter.ts";
import { payload } from "./payload.ts";

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
 * Ends an account's sockets on every instance: a socket authenticates once, so
 * a credential that stops being valid does not end the sockets it opened.
 * `onlySid` cuts the sockets one session opened, `exceptSid` spares them.
 *
 * Call only after the write that revoked the credential has committed. Never
 * throws: that write has already happened, and a caller cannot undo it.
 */
export async function revokeAccountSockets(
  userId: string,
  { onlySid, exceptSid }: { onlySid?: string; exceptSid?: string } = {}
): Promise<void> {
  if (!_io) return;
  try {
    for (const socket of await _io.in(userRoom(userId)).fetchSockets()) {
      const sid = socket.data?.sid as string | undefined;
      if (onlySid !== undefined && sid !== onlySid) continue;
      if (exceptSid !== undefined && sid === exceptSid) continue;
      socket.emit("socket:error", payload("SESSION_REVOKED"));
      socket.disconnect(true);
    }
  } catch (err) {
    logger.error({ err, userId }, "Failed to revoke an account's sockets");
  }
}

/**
 * Throws an account off the server once its `users` row is gone, and gives up
 * every seat it held. `seatedRoomIds` comes from the delete itself: the socket
 * may be on another instance, where this process cannot read its room.
 *
 * Call only after the delete has committed — releasing the seat can end the
 * hand, and the hand's writes must not race the transaction. Never throws.
 */
export async function evictUser(userId: string, seatedRoomIds: readonly string[]): Promise<void> {
  const io = _io;
  if (!io) return;
  const roomIds = new Set(seatedRoomIds);
  const socketId = userSocketMap.get(userId);
  userSocketMap.delete(userId);
  const socket = socketId ? io.sockets.sockets.get(socketId) : undefined;
  if (socket) {
    // Taken here so the disconnect below cannot release the same seat a second
    // time. Spectator state is left to it, which drops it correctly.
    const roomId = socketRoomMap.get(socket.id);
    socketRoomMap.delete(socket.id);
    if (roomId) {
      roomIds.add(roomId);
      socket.leave(roomId);
    }
  }

  for (const roomId of roomIds) {
    try {
      // Not handleSeatRelease when a game is live: deleting an account also
      // deletes the rooms rows it hosted, and that path reads the room back and
      // returns when it is gone — leaving the seat live in a hand still being
      // played. Routed, because the game may be held by another instance.
      const vacated = await applyOrForward(io, { kind: "vacate", roomId, userId });
      if (!vacated.ok) {
        await handleSeatRelease(io, roomId, userId, { socket, source: "leave" });
      }
    } catch (err) {
      logger.error(
        { err, userId, roomId },
        "Failed to release the seat of a deleted account"
      );
    }
  }

  await revokeAccountSockets(userId);
}

/**
 * Declines an invite and tells the room in the same event. `server/routes.ts`
 * has no `io` of its own — this is the one path from an HTTP handler to a
 * room broadcast, so a row-deleting endpoint added there later has somewhere
 * to route through instead of reaching for the socket server directly.
 */
export async function declineGameInviteAndNotify(
  inviteeId: string,
  roomCode: string
): Promise<void> {
  // Deliberately unguarded: a decline that did not happen must reach the
  // caller as a failure, not as an ok with the invite still standing.
  // `announceRoomChanged` swallows its own read failures.
  const roomId = await friendStore.declineGameInvite(inviteeId, roomCode);
  if (!roomId || !_io) return;
  await announceRoomChanged(_io, roomId);
}

/** An invite rides the friendship, so ending one frees the seats the other held. */
export async function removeFriendAndNotify(userId: string, friendUserId: string): Promise<void> {
  const roomIds = await friendStore.removeFriend(userId, friendUserId);
  if (!_io) return;
  for (const roomId of roomIds) await announceRoomChanged(_io, roomId);
}

/**
 * The one internal a test cannot reach any other way: `_io` is private to this
 * module, and the containment property needs a timer body that throws on demand.
 */
export const __testables = {
  runTimerBody: (label: string, roomId: string, fn: () => void) =>
    safeTimer(_io, label, roomId, fn),
};
