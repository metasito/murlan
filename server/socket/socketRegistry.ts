// server/socket/socketRegistry.ts — the table runtime, late-bound for the HTTP
// layer, and the questions the rest of the app asks about an account rather
// than about a socket.
//
// `mountApi` runs before `setupSocket` builds the runtime, so this binding
// is the one setter that stays.
import type { ServerToClientEvents } from "../../shared/protocol.ts";
import type { TableRuntime } from "../game/tableRuntime.ts";
import { logger } from "../shared/logger.ts";
import { openedAfter, socketRoomMap, userRoom, userSocketMap } from "../game/gameRoom.ts";
import { realClock } from "../http/clock.ts";
import { safeTimer } from "../game/gamePersistence.ts";
import { announceRoomChanged, handleSeatRelease } from "./socketTable.ts";
import { payload } from "../shared/payload.ts";

let _rt: TableRuntime | null = null;

/** Called once by `setupSocket`; every accessor below is a no-op until it is. */
export function bindSocketRuntime(rt: TableRuntime) {
  _rt = rt;
}

export function emitToUser<E extends Exclude<keyof ServerToClientEvents, "game:state">>(
  userId: string,
  event: E,
  ...data: Parameters<ServerToClientEvents[E]>
) {
  _rt?.out.user(userId).emit(event, ...data);
}

/** Whether this account has a socket anywhere in the cluster. Never throws. */
export async function isUserOnline(userId: string): Promise<boolean> {
  return _rt ? _rt.presence.isOnline(userId) : userSocketMap.has(userId);
}

/**
 * Every account with a socket anywhere in the cluster, in one round trip — a
 * friends list filtered with `isUserOnline` would ask once per friend. Only this
 * instance's own when the cluster did not answer: a friend elsewhere shown
 * offline is the smaller wrong.
 */
export async function onlineUserIds(): Promise<Set<string>> {
  return (await _rt?.presence.connectedUserIds()) ?? new Set(userSocketMap.keys());
}

/**
 * Ends an account's sockets on every instance: a socket authenticates once, so
 * a credential that stops being valid does not end the sockets it opened.
 * `onlySid` cuts the sockets one session opened, `exceptSid` spares them.
 *
 * Call only after the write that revoked the credential has committed. Never
 * throws: that write has already happened, and a caller cannot undo it.
 */
export async function revokeAccountSockets(userId: string, which: Revoked = {}): Promise<void> {
  const rt = _rt;
  if (!rt) return;
  // Real time, not the installed clock: it is compared with socket.io's handshake stamps. Every
  // pass, retries included, spares a socket opened after it.
  const revoked = { ...which, at: realClock.now() };
  // This instance's own first: they need no cluster, and an outage must not leave them live.
  try {
    cut(await rt.transport.local.in(userRoom(userId)).fetchSockets(), revoked);
  } catch (err) {
    logger.error({ err, userId }, "Failed to revoke an account's sockets on this instance");
  }
  await revokeAcrossCluster(rt, userId, revoked, 0);
}

interface Revoked {
  onlySid?: string;
  exceptSid?: string;
}

const retries = new Set<ReturnType<typeof setTimeout>>();

/** Drops the cluster passes still waiting to retry; for shutdown, which ends the links they need. */
export function cancelRevocationRetries(): void {
  for (const retry of retries) clearTimeout(retry);
  retries.clear();
}

/** After a failed cluster pass, the instance's peers are asked again at these delays. */
const REVOKE_RETRY_MS = [2_000, 10_000];

async function revokeAcrossCluster(
  rt: TableRuntime,
  userId: string,
  which: Revoked & { at: number },
  attempt: number
): Promise<void> {
  try {
    cut(await rt.transport.in(userRoom(userId)).fetchSockets(), which);
  } catch (err) {
    const delay = REVOKE_RETRY_MS[attempt];
    if (delay === undefined) {
      logger.error({ err, userId }, "Failed to revoke an account's sockets on the other instances");
      return;
    }
    const retry = setTimeout(() => {
      retries.delete(retry);
      void revokeAcrossCluster(rt, userId, which, attempt + 1);
    }, delay);
    retries.add(retry);
    (retry as unknown as { unref?: () => void }).unref?.();
  }
}

type FoundSockets = Awaited<ReturnType<ReturnType<TableRuntime["transport"]["in"]>["fetchSockets"]>>;

function cut(sockets: FoundSockets, { onlySid, exceptSid, at }: Revoked & { at: number }): void {
  for (const socket of sockets) {
    if (openedAfter(socket, at)) continue;
    const sid = socket.data?.sid as string | undefined;
    if (onlySid !== undefined && sid !== onlySid) continue;
    if (exceptSid !== undefined && sid === exceptSid) continue;
    socket.emit("socket:error", payload("SESSION_REVOKED"));
    socket.disconnect(true);
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
  const rt = _rt;
  if (!rt) return;
  const roomIds = new Set(seatedRoomIds);
  const socketId = userSocketMap.get(userId);
  userSocketMap.delete(userId);
  const socket = socketId ? rt.transport.sockets.sockets.get(socketId) : undefined;
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
      const vacated = await rt.route({ kind: "vacate", roomId, userId });
      if (!vacated.ok) {
        await handleSeatRelease(rt, roomId, userId, { socket, source: "leave" });
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
 * `announceRoomChanged` for a caller with no runtime of its own: the one path from
 * an HTTP handler to a room broadcast, so a row-deleting endpoint has somewhere
 * to route through instead of reaching for the socket server directly.
 */
export async function announceRoom(roomId: string): Promise<void> {
  if (!_rt) return;
  await announceRoomChanged(_rt, roomId);
}

/**
 * The one internal a test cannot reach any other way: `_rt` is private to this
 * module, and the containment property needs a timer body that throws on demand.
 */
export const __testables = {
  runTimerBody: (label: string, roomId: string, fn: () => void) => {
    if (_rt) safeTimer(_rt, label, roomId, fn);
  },
};
