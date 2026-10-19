// server/socket/friendships.ts — every friendship action: the store write, and
// whoever has to hear about it. Routes and socket handlers only translate the
// result into a status code or an ack.
import { friendStore, type AddFriendRefusal } from "../store/friendStore.ts";
import { userStore } from "../store/userStore.ts";
import { roomStore } from "../store/roomStore.ts";
import { friendRequestRow, friendRow } from "../store/friendRows.ts";
import type { FriendRequestAccepted, FriendRequestIncoming } from "../../shared/http.ts";
import { logger } from "../http/logger.ts";
import { notifyUser } from "./push.ts";
import { announceRoom, emitToUser, isUserOnline } from "./socketRegistry.ts";

export interface FriendshipDeps {
  friendStore: Pick<
    typeof friendStore,
    | "addFriend"
    | "acceptFriend"
    | "declineFriendRequest"
    | "cancelFriendRequest"
    | "declineGameInvite"
    | "removeFriend"
    | "areFriends"
    | "recordGameInvite"
  >;
  userStore: Pick<typeof userStore, "getUser" | "getUserByUsername">;
  roomStore: Pick<typeof roomStore, "getRoomByCode" | "getRoomPlayers">;
  emitToUser: typeof emitToUser;
  isUserOnline: (userId: string) => Promise<boolean>;
  announceRoomChanged: (roomId: string) => Promise<void>;
  notifyUser: typeof notifyUser;
}

type Refused<C extends string> = { ok: false; code: C };

/** An ack the client branches on and never renders, so it has no server.* key. */
type InviteOutcome = "INVITE_SHOWN" | "INVITE_WAITING";

export type InviteRefusal = "NOT_FRIENDS" | "ROOM_NOT_FOUND" | "NOT_IN_ROOM";

/**
 * What each refusal is called to a player. The same three answers whether the
 * store's own checks refused or the constraint did, so a request losing a race
 * reads exactly as one arriving second.
 */
const ADD_FRIEND_REFUSAL = {
  already_friends: "ALREADY_FRIENDS",
  already_sent: "FRIEND_REQUEST_ALREADY_SENT",
  incoming_pending: "FRIEND_REQUEST_INCOMING_PENDING",
} as const satisfies Record<AddFriendRefusal, string>;

export type FriendRequestRefusal =
  | "USER_NOT_FOUND"
  | "CANNOT_ADD_SELF"
  | (typeof ADD_FRIEND_REFUSAL)[AddFriendRefusal];

export function createFriendships(deps: FriendshipDeps) {
  const notFound = { ok: false, code: "FRIEND_REQUEST_NOT_FOUND" } as const;

  function tellStatus(
    userId: string,
    friendIds: readonly string[],
    status: { online: true } | { online: false; lastSeen: string }
  ) {
    for (const friendId of friendIds) {
      deps.emitToUser(friendId, "friend:status", { userId, ...status });
    }
  }

  return {
    tellStatus,

    async request(
      fromId: string,
      username: string
    ): Promise<{ ok: true; username: string } | Refused<FriendRequestRefusal>> {
      const friend = await deps.userStore.getUserByUsername(username);
      if (!friend) return { ok: false, code: "USER_NOT_FOUND" };
      if (friend.id === fromId) return { ok: false, code: "CANNOT_ADD_SELF" };

      const result = await deps.friendStore.addFriend(fromId, friend.id);
      if (!result.ok) return { ok: false, code: ADD_FRIEND_REFUSAL[result.reason] };

      const sender = await deps.userStore.getUser(fromId);
      // The row travels with the announcement: the recipient's cache holds the
      // request on the frame the banner goes up, rather than seconds later when
      // the fetch the invalidation started comes back.
      deps.emitToUser(friend.id, "friend:request_incoming", {
        from: sender?.username ?? "Qualcuno",
        request: sender && result.request ? friendRequestRow(result.request, sender) : undefined,
      } satisfies FriendRequestIncoming);

      logger.info({ fromUserId: fromId, toUserId: friend.id }, "Friend request sent");
      return { ok: true, username: friend.username };
    },

    async accept(id: string, accepterId: string): Promise<{ ok: true } | typeof notFound> {
      // Scoped to the recipient: the sender must not be able to accept their
      // own request by id (IDOR).
      const result = await deps.friendStore.acceptFriend(id, accepterId);
      if (!result) return notFound;
      const accepter = await deps.userStore.getUser(accepterId);
      const { requesterId } = result;

      deps.emitToUser(requesterId, "friend:request_accepted", {
        by: accepter?.username ?? "Qualcuno",
        friend: accepter ? friendRow(accepter) : undefined,
      } satisfies FriendRequestAccepted);

      if (await deps.isUserOnline(accepterId)) tellStatus(accepterId, [requesterId], { online: true });
      if (await deps.isUserOnline(requesterId)) tellStatus(requesterId, [accepterId], { online: true });
      return { ok: true };
    },

    async declineRequest(id: string, recipientId: string): Promise<{ ok: true } | typeof notFound> {
      // Only the recipient can decline (IDOR: any user could destroy any
      // pending request by id).
      return (await deps.friendStore.declineFriendRequest(id, recipientId)) ? { ok: true } : notFound;
    },

    async cancelRequest(id: string, senderId: string): Promise<{ ok: true } | typeof notFound> {
      return (await deps.friendStore.cancelFriendRequest(id, senderId)) ? { ok: true } : notFound;
    },

    /** Declines a game invite, and tells the room whose seat it held. */
    async decline(inviteeId: string, roomCode: string): Promise<{ ok: true }> {
      // Deliberately unguarded: a decline that did not happen must reach the
      // caller as a failure, not as an ok with the invite still standing.
      const roomId = await deps.friendStore.declineGameInvite(inviteeId, roomCode);
      if (roomId) await deps.announceRoomChanged(roomId);
      return { ok: true };
    },

    /** An invite rides the friendship, so ending one frees the seats the other held. */
    async remove(userId: string, friendUserId: string): Promise<{ ok: true }> {
      const roomIds = await deps.friendStore.removeFriend(userId, friendUserId);
      for (const roomId of roomIds) await deps.announceRoomChanged(roomId);
      return { ok: true };
    },

    async invite(
      fromId: string,
      friendUserId: string,
      roomCode: string
    ): Promise<{ ok: true; code: InviteOutcome } | Refused<InviteRefusal>> {
      // Only accepted friends may invite each other — an invite is otherwise
      // an unauthenticated broadcast primitive that would let any user spam
      // any userId.
      if (!(await deps.friendStore.areFriends(fromId, friendUserId))) return { ok: false, code: "NOT_FRIENDS" };

      const room = await deps.roomStore.getRoomByCode(roomCode.toUpperCase());
      if (!room || room.status !== "waiting") return { ok: false, code: "ROOM_NOT_FOUND" };

      // The code comes from the client, and the client is not what decides
      // whether the sender is at that table. Without this, naming any waiting
      // room's code would invite a friend into a stranger's room.
      const seated = await deps.roomStore.getRoomPlayers(room.id);
      if (!seated.some((p) => p.userId === fromId)) return { ok: false, code: "NOT_IN_ROOM" };

      // Written before it is announced. The emit and the push are both ways
      // of saying "look now"; the row is what makes the invite exist, and it
      // is the only one of the three that survives the friend being away.
      await deps.friendStore.recordGameInvite(room.id, fromId, friendUserId);

      // The row is what holds the seat, so the room has to be told the moment
      // it exists — otherwise the seat waiting for this friend reads as an
      // empty one until something else happens to broadcast.
      await deps.announceRoomChanged(room.id);

      // Read now, not at the handshake: a rename in between would send the
      // name a stranger may have registered since.
      const username = (await deps.userStore.getUser(fromId))?.username ?? "";
      const friendIsHere = await deps.isUserOnline(friendUserId);
      if (friendIsHere) {
        deps.emitToUser(friendUserId, "friend:invite", { from: username, roomCode });
      } else {
        // Not awaited: the invite must not be held up by a push, and the row
        // above already means a failed push costs nothing.
        void deps.notifyUser(friendUserId, {
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
  };
}

export const friendships = createFriendships({
  friendStore,
  userStore,
  roomStore,
  emitToUser,
  isUserOnline,
  announceRoomChanged: announceRoom,
  notifyUser,
});
