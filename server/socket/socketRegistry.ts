// server/socket/socketRegistry.ts — the table runtime, late-bound for the HTTP
// layer, and the questions the rest of the app asks about an account rather
// than about a socket.
//
// `mountApi` runs before `setupSocket` builds the runtime, so this binding
// is the one setter that stays.
import type { ServerToClientEvents } from "../../shared/protocol.ts";
import type { TableRuntime } from "../game/tableRuntime.ts";
import { createHash } from "node:crypto";
import { logger } from "../shared/logger.ts";
import { openedAfter, userRoom, userSocketMap } from "../game/gameRoom.ts";
import { unseatSocket } from "./seating.ts";
import { realClock } from "../http/clock.ts";
import { safeTimer } from "../game/gamePersistence.ts";
import { announceRoomChanged, handleSeatRelease } from "./socketTable.ts";
import { payload } from "../shared/payload.ts";
import { track } from "../shared/inFlight.ts";
import { storePresence } from "./socketOutbox.ts";

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

/** The runtime's, once bound; until then the same port over the store, for the HTTP layer. */
const unbound = storePresence();
const presence = () => _rt?.presence ?? unbound;

/** Friend-facing: lists, notices and the status a new friendship shows. Never rejects. */
export function shownOnlineAmong(userIds: readonly string[]): Promise<Set<string>> {
  return presence().shownAmong(userIds);
}

export async function isShownOnline(userId: string): Promise<boolean> {
  return (await presence().shownAmong([userId])).has(userId);
}

/** Connected now, so a live socket will see what is emitted to it. Never rejects. */
export function isOnline(userId: string): Promise<boolean> {
  return presence().isOnline(userId);
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
  // pass, retries included, spares a socket opened after it. A session id is a credential, so
  // only its digest leaves this instance.
  const revocation: Revocation = {
    userId,
    at: realClock.now(),
    ...(which.onlySid !== undefined && { only: sidDigest(which.onlySid) }),
    ...(which.exceptSid !== undefined && { except: sidDigest(which.exceptSid) }),
  };
  // This instance's own first: they need no cluster, and an outage must not leave them live.
  cutHere(rt, revocation);
  await revokeAcrossCluster(rt, revocation, 0);
}

interface Revoked {
  onlySid?: string;
  exceptSid?: string;
}

interface Revocation {
  userId: string;
  at: number;
  only?: string;
  except?: string;
}

const REVOKE_EVENT = "murlan:revoke-sockets";

const sidDigest = (sid: string) => createHash("sha256").update(sid).digest("base64url");

/** Each instance cuts its own sockets; registered before the first connection. */
export function registerRevocation(rt: TableRuntime): void {
  rt.transport.on(REVOKE_EVENT, (revocation: Revocation, reply?: () => void) => {
    cutHere(rt, revocation);
    reply?.();
  });
}

const retries = new Set<ReturnType<typeof setTimeout>>();

/** Drops the cluster passes still waiting to retry; for shutdown, which ends the links they need. */
export function cancelRevocationRetries(): void {
  for (const retry of retries) clearTimeout(retry);
  retries.clear();
}

/** After a cluster pass some instance did not answer, it is sent again at these delays. */
const REVOKE_RETRY_MS = [2_000, 10_000];

/** Resolves once the first pass is answered or has failed; a retry runs on its own. */
function revokeAcrossCluster(rt: TableRuntime, revocation: Revocation, attempt: number): Promise<void> {
  return new Promise((resolve) => {
    rt.transport.serverSideEmit(REVOKE_EVENT, revocation, (err: unknown) => {
      resolve();
      if (!err) return;
      const delay = REVOKE_RETRY_MS[attempt];
      if (delay === undefined) {
        logger.error({ err, userId: revocation.userId }, "Failed to revoke an account's sockets on the other instances");
        return;
      }
      const retry = setTimeout(() => {
        retries.delete(retry);
        void track(revokeAcrossCluster(rt, revocation, attempt + 1));
      }, delay);
      retries.add(retry);
      (retry as unknown as { unref?: () => void }).unref?.();
    });
  });
}

function cutHere(rt: TableRuntime, { userId, at, only, except }: Revocation): void {
  const io = rt.transport;
  for (const id of [...(io.sockets.adapter.rooms.get(userRoom(userId)) ?? [])]) {
    const socket = io.sockets.sockets.get(id);
    if (!socket || openedAfter(socket, at)) continue;
    const sid = socket.data?.sid as string | undefined;
    const digest = sid === undefined ? undefined : sidDigest(sid);
    if (only !== undefined && digest !== only) continue;
    if (except !== undefined && digest === except) continue;
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
    const roomId = unseatSocket(socket.id);
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
