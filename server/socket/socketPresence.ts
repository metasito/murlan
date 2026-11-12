// server/socket/socketPresence.ts — who is here.
//
// One account's arrival and departure, and what its friends are told about
// both: the invite it can send, the online list it is given, the notice its
// friends receive, and the grace its seat is held under when it drops.
//
// `registerDisconnect` registers synchronously, before `announcePresence`'s
// own awaits (server/socket/socket.ts): a socket that closes while those are still
// running has no other listener that will ever see it.
import { now } from "../http/clock.ts";
import type { DisconnectReason } from "socket.io";
import type { HandlerContext, SocketServer, GameSocket as Socket } from "./socketTypes.ts";
import type { TableRuntime } from "../game/tableRuntime.ts";
import { friendStore } from "../store/friendStore.ts";
import { roomStore } from "../store/roomStore.ts";
import { userStore } from "../store/userStore.ts";
import { logger } from "../shared/logger.ts";
import { friendships, type InviteRefusal } from "./friendships.ts";
import { trackEvent } from "../shared/events.ts";
import { track } from "../shared/inFlight.ts";
import { onEvent } from "./socketSafety.ts";
import {
  isShuttingDown,
  openedAfter,
  userRoom,
  userSocketMap,
} from "../game/gameRoom.ts";
import { clearDisconnectGrace } from "../game/gameTimers.ts";
import { heldRoundFor } from "../game/gameTurn.ts";
import { announceRejoin, armLobbyGrace } from "./socketTable.ts";
import { seatSocket, stopSpectating, unseatSocket } from "./seating.ts";
import { NoPayloadSchema, FriendInviteSchema } from "../../shared/socketSchemas.ts";
import { isShownOnline, shownOnlineAmong } from "./socketRegistry.ts";
import { forgetPresence, onPresenceLost, onPresenceRestored, socialVersion, type LostHandler } from "../store/presence.ts";
import type { OnlineList } from "../../shared/protocol.ts";
import { payload } from "../shared/payload.ts";
import { OK, refuse } from "../shared/refusal.ts";

const INVITE_REFUSAL_CODE = {
  NOT_FRIENDS: "NOT_FRIENDS",
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  NOT_IN_ROOM: "NOT_IN_ROOM",
} as const satisfies { [C in InviteRefusal]: C };

export function registerFriendHandlers({ socket, userId }: HandlerContext) {

    onEvent(
      socket,
      "friend:invite",
      FriendInviteSchema,
      async ({ friendUserId, roomCode }) => {
        const result = await friendships.invite(userId, friendUserId, roomCode);
        return result.ok ? OK : refuse(INVITE_REFUSAL_CODE[result.code]);
      },
      // An invite is a broadcast to another account: only a few per minute.
      { limit: 5, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "friend:get_online_list",
      NoPayloadSchema,
      async () => {
        socket.emit("friend:online_list", await onlineList(userId, await friendStore.getFriends(userId)));
        return OK;
      },
      { limit: 20, windowMs: 60_000 }
    );
}

/**
 * The connect notice: a round still held under the disconnect grace is resumed,
 * and the account's friends learn it is here.
 *
 * Deliberately after every listener is registered — these awaits are exactly
 * the window in which a packet arriving with no listener would be dropped.
 */
export async function announcePresence({ rt, socket, userId }: HandlerContext) {

    const held = clearDisconnectGrace(userId) ? heldRoundFor(userId) : null;
    if (held) {
      const { roomId, game } = held;
      await seatSocket(rt, socket, userId, roomId);
      try {
        await announceRejoin(rt, userId, roomId, game);
        logger.info(
          { userId, roomId },
          "Player reconnected within grace period"
        );
      } catch (err) {
        logger.error({ err, userId, roomId }, "grace rejoin failed");
      }
    }

    try {
      // One read for both halves of the connect notice: the friends who must
      // be told this account came online, and the online list this socket is
      // sent, are the same rows.
      const friends = await friendStore.getFriends(userId);
      await announceOnlineToFriends(userId, friends);
      socket.emit("friend:online_list", await onlineList(userId, friends));
    } catch (err) {
      // Swallowing this silently leaves a connected account with no friends
      // list and no way to notice: the client is waiting for a push that is
      // never coming, and only a reconnect asks again.
      logger.warn({ err, userId }, "friend list read failed; this socket gets no online list");
    }
}

type FriendRows = Awaited<ReturnType<typeof friendStore.getFriends>>;

/**
 * Which friends are online, when each of the others was last seen, and the account's social
 * version: what a client that was away needs, so it refetches its lists only when they changed.
 */
async function onlineList(userId: string, friends: FriendRows): Promise<OnlineList> {
  const ids = friends.map((f) => f.friend.id);
  const [online, social] = await Promise.all([
    shownOnlineAmong(ids),
    socialVersion(userId).catch((err: unknown) => {
      logger.warn({ err, userId }, "Could not read the social version; the client refetches its lists");
      return null;
    }),
  ]);
  const lastSeen: Record<string, string> = {};
  for (const { friend } of friends) if (!online.has(friend.id) && friend.lastSeen) lastSeen[friend.id] = friend.lastSeen.toISOString();
  return { onlineIds: ids.filter((id) => online.has(id)), lastSeen, ...(social !== null && { social }) };
}

interface LostDeps {
  userStore: Pick<typeof userStore, "updateLastSeen" | "settleLastSeen">;
  friendStore: Pick<typeof friendStore, "getFriends">;
  tellStatus: typeof friendships.tellStatus;
  isShownOnline: (userId: string) => Promise<boolean>;
}

/** What a sweep's report of lost accounts does: their last_seen, then their friends' notice. */
export function lostPresenceHandler(deps: LostDeps): LostHandler {
  return (userIds, leftAt, connectedAt) => {
    for (const userId of userIds) {
      const at = leftAt ?? new Date(now());
      const since = connectedAt.get(userId);
      const written: Promise<Date | null> =
        leftAt === null && since !== undefined
          ? deps.userStore.settleLastSeen(userId, since, at)
          : deps.userStore.updateLastSeen(userId, at).then(() => at);
      void track(
        written
          .catch((err: unknown) => {
            logger.debug({ err, userId }, "Failed to update users.last_seen for a lost account");
            return at;
          })
          .then(async (seen) => {
            const friends = await deps.friendStore.getFriends(userId);
            // A reconnect elsewhere while those were read was told to them as online.
            if (await deps.isShownOnline(userId)) return;
            deps.tellStatus(userId, friends.map((f) => f.friend.id), { online: false, lastSeen: (seen ?? at).toISOString() });
          })
          .catch((err: unknown) => logger.warn({ err, userId }, "Could not tell a lost account's friends it went offline"))
      );
    }
  };
}

/** The friends of accounts a sweep cleared, from a crashed instance or a left one, are told once, by the instance whose sweep it was. */
export function registerLostPresence(): void {
  onPresenceLost(lostPresenceHandler({ userStore, friendStore, tellStatus: friendships.tellStatus, isShownOnline }));
}

/** A peer that swept this instance during a lapse told these accounts' friends they went offline. */
export function registerRestoredPresence(): void {
  onPresenceRestored((userIds) => {
    for (const userId of userIds) {
      void track(
        friendStore
          .getFriends(userId)
          .then((friends) => announceOnlineToFriends(userId, friends))
          .catch((err: unknown) => logger.warn({ err, userId }, "Could not tell a restored account's friends it is online"))
      );
    }
  });
}

export function registerDisconnect({ rt, socket, userId }: HandlerContext) {

    socket.on("disconnect", (reason: DisconnectReason) => {
      const swept = forgetPresence(userId, socket.id);
      trackEvent("socket.closed", userId, { reason });
      void track((async () => {
        let offlineNotice: Promise<void> | undefined;
        try {
          // A spectator holds no seat, so none of the grace/AFK machinery below
          // applies to them; they are simply dropped.
          await stopSpectating(rt, socket, userId);
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

          const lastSeen = new Date(now()).toISOString();
          if (!swept) offlineNotice = emitFriendStatusOffline(userId, lastSeen);

          const currentRoomId = unseatSocket(socket.id);
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

          // Whether this is a round in progress, a finished table or a waiting
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
            : await rt.route({
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
          await armLobbyGrace(rt, currentRoomId, userId);
        } catch (err) {
          logger.error({ err, userId }, "disconnect handler failed");
        } finally {
          await offlineNotice;
        }
      })());
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
 * Not gated on there being more than one instance: the adapter's count of its
 * peers can lag a second instance's first moments, exactly when a player is
 * most likely to be handed to it. One Redis publish per connection is far below
 * the queries this handler already runs.
 */
export function evictRemoteSessions(io: SocketServer, userId: string, keep: Socket) {
  const eviction: Eviction = { userId, keepSocketId: keep.id, connectedAt: keep.handshake.issued };
  evictOlderSessions(io, eviction);
  io.serverSideEmit(SESSION_EVICTION_EVENT, eviction);
}

const SESSION_EVICTION_EVENT = "murlan:evict-session";

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
    // Two instances stamping the same millisecond each receive the other's eviction; the id breaks the tie so exactly one closes.
    if (openedAfter(socket, connectedAt) || (socket.handshake.issued === connectedAt && id > keepSocketId)) continue;
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
 * it retries every other close, so two tabs would evict each other indefinitely.
 */
export function evictReplacedSession(
  io: SocketServer,
  rt: TableRuntime,
  userId: string,
  replacedSocketId: string,
  replacement: Socket
) {
  const replaced = io.sockets.sockets.get(replacedSocketId);
  if (!replaced) return;

  const roomId = unseatSocket(replacedSocketId);
  if (roomId) void track(seatSocket(rt, replacement, userId, roomId));

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
  userId: string,
  friends: Awaited<ReturnType<typeof friendStore.getFriends>>
) {
  // The read the caller did is awaited, so the socket may already be gone.
  if (!(await isShownOnline(userId))) return;
  friendships.tellStatus(userId, friends.map((f) => f.friend.id), { online: true });
}

async function emitFriendStatusOffline(userId: string, lastSeen: string) {
  // Debounced, and re-checked after every await: a reconnect inside any of
  // these windows must cancel the offline notice rather than race it.
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (await isShownOnline(userId)) return;
  const friends = await friendStore.getFriends(userId).catch(() => []);
  if (await isShownOnline(userId)) return;
  friendships.tellStatus(userId, friends.map((f) => f.friend.id), { online: false, lastSeen });
}
