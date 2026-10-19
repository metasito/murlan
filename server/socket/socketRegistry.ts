// server/socket/socketRegistry.ts — the live Socket.IO server, and the questions the
// rest of the app asks it about an account rather than about a socket.
//
// Apart from socket.ts because both the presence family and socket.ts itself
// need these: keeping them next to `setupSocket` made an import cycle.
import type { ServerToClientEvents } from "../../shared/protocol.ts";
import type { SocketServer } from "./socketTypes.ts";
import { logger } from "../http/logger.ts";
import { socketRoomMap, userRoom, userSocketMap } from "../game/gameRoom.ts";
import { safeTimer } from "../game/gamePersistence.ts";
import { announceRoomChanged, handleSeatRelease } from "./socketTable.ts";
import { applyOrForward } from "../game/tableRouter.ts";
import { payload } from "./payload.ts";

let _io: SocketServer | null = null;

/** Called once by `setupSocket`; every accessor below is a no-op until it is. */
export function setSocketServer(io: SocketServer) {
  _io = io;
}

export function emitToUser<E extends keyof ServerToClientEvents>(
  userId: string,
  event: E,
  ...data: Parameters<ServerToClientEvents[E]>
) {
  if (!_io) return;
  _io.to(userRoom(userId)).emit(event, ...data);
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
 * Whether one of this account's sockets, anywhere in the cluster, has joined
 * `roomId` — back at the table, not merely online. Never throws, as above.
 */
export async function isUserAtTable(userId: string, roomId: string): Promise<boolean> {
  // This instance's own sockets first: they need no cluster to answer, and one that fails must
  // not unseat a player sitting here.
  const local = userSocketMap.get(userId);
  if (local && socketRoomMap.get(local) === roomId) return true;
  if (!_io) return false;
  try {
    return (await _io.in(userRoom(userId)).fetchSockets()).some((s) => s.rooms.has(roomId));
  } catch (err) {
    logger.warn({ err, userId, roomId }, "Cluster presence check failed; treating as away");
    return false;
  }
}

/**
 * Every account with a socket anywhere in the cluster, and those of them at
 * `roomId`; `null` when the cluster did not answer, which is not "nobody".
 */
export async function tablePresence(
  roomId: string
): Promise<{ online: Set<string>; atTable: Set<string> } | null> {
  const online = new Set<string>();
  const atTable = new Set<string>();
  if (!_io) return { online, atTable };
  try {
    for (const s of await _io.fetchSockets()) {
      const userId: unknown = s.data?.userId;
      if (typeof userId !== "string") continue;
      online.add(userId);
      if (s.rooms.has(roomId)) atTable.add(userId);
    }
  } catch (err) {
    logger.warn({ err, roomId }, "Cluster presence sweep failed");
    return null;
  }
  return { online, atTable };
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
 * round, and the round's writes must not race the transaction. Never throws.
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
      // returns when it is gone — leaving the seat live in a round still being
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
 * `announceRoomChanged` for a caller with no `io` of its own: the one path from
 * an HTTP handler to a room broadcast, so a row-deleting endpoint has somewhere
 * to route through instead of reaching for the socket server directly.
 */
export async function announceRoom(roomId: string): Promise<void> {
  if (!_io) return;
  await announceRoomChanged(_io, roomId);
}

/**
 * The one internal a test cannot reach any other way: `_io` is private to this
 * module, and the containment property needs a timer body that throws on demand.
 */
export const __testables = {
  runTimerBody: (label: string, roomId: string, fn: () => void) =>
    safeTimer(_io, label, roomId, fn),
};
