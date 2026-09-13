import { eq, and, or, sql, desc, inArray } from "drizzle-orm";
import { db } from "./db.ts";
import { uniqueViolation } from "./userStore.ts";
import { users, rooms, roomPlayers, friends, gameInvites } from "../shared/schema.ts";
import type { User, Friend } from "../shared/schema.ts";

/** `db`, or the handle inside `db.transaction` — the same read surface. */
type Executor = Pick<typeof db, "select">;

/** Why a friend request cannot exist, in the terms the route answers in. */
export type AddFriendRefusal = "already_friends" | "already_sent" | "incoming_pending";

export type AddFriendResult =
  | { ok: true; request: Friend | undefined }
  | { ok: false; reason: AddFriendRefusal };

/**
 * An object rather than bare exported functions:
 * `tests/integration/socketHandshakeLimit.test.ts` replaces `getFriends` with
 * a counting stub to drive the handshake paths, and an ES module's namespace
 * is sealed against exactly that.
 */
export const friendStore = {
  async getFriends(userId: string): Promise<(Friend & { friend: User })[]> {
    const rows = await db
      .select()
      .from(friends)
      .innerJoin(users, eq(friends.friendUserId, users.id))
      .where(and(eq(friends.userId, userId), eq(friends.status, "accepted")));

    return rows.map((r) => ({ ...r.friends, friend: r.users }));
  },

  async getPendingFriendRequests(userId: string): Promise<(Friend & { requester: User })[]> {
    const rows = await db
      .select()
      .from(friends)
      .innerJoin(users, eq(friends.userId, users.id))
      .where(and(eq(friends.friendUserId, userId), eq(friends.status, "pending")));

    return rows.map((r) => ({ ...r.friends, requester: r.users }));
  },

  /**
   * Which way a pending request between these two runs, or null.
   *
   * The direction is the whole answer: told "already sent" for a request that
   * is in fact waiting on *them*, a player has no way to learn that accepting
   * it is what they should do.
   */
  async pendingRequestBetween(
    userId: string,
    friendUserId: string,
    exec: Executor = db
  ): Promise<"sent" | "received" | null> {
    const [row] = await exec
      .select()
      .from(friends)
      .where(
        and(
          or(
            and(eq(friends.userId, userId), eq(friends.friendUserId, friendUserId)),
            and(eq(friends.userId, friendUserId), eq(friends.friendUserId, userId))
          ),
          eq(friends.status, "pending")
        )
      );
    if (!row) return null;
    return row.userId === userId ? "sent" : "received";
  },

  /**
   * Creates the request, or says why it cannot exist. Returns the row it
   * created, so the caller can push it rather than make the recipient ask.
   *
   * The checks and the insert are one transaction, and the two partial unique
   * indexes on `friends` are behind them: the checks answer the ordinary case
   * in the caller's own terms, and the constraint is what two requests
   * arriving at the same moment actually collide on. Without it the checks
   * both pass and both rows land.
   */
  async addFriend(userId: string, friendUserId: string): Promise<AddFriendResult> {
    // A violation means the request that blocked this insert committed while
    // the transaction was deciding, so the retry is what reads it: refusing in
    // the caller's own terms if it is still there, succeeding if it is not.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.transaction(async (tx): Promise<AddFriendResult> => {
          if (await this.areFriends(userId, friendUserId, tx)) {
            return { ok: false, reason: "already_friends" };
          }
          const pending = await this.pendingRequestBetween(userId, friendUserId, tx);
          if (pending) {
            return { ok: false, reason: pending === "sent" ? "already_sent" : "incoming_pending" };
          }
          const [row] = await tx
            .insert(friends)
            .values({ userId, friendUserId, status: "pending" })
            .returning();
          return { ok: true, request: row };
        });
      } catch (err) {
        if (!uniqueViolation(err)?.includes("friends_pending_pair_uq")) throw err;
      }
    }
    // Three lost races running. "Already sent" is the refusal a player can act
    // on if it is wrong — asking again works — where "accept theirs" sends
    // them looking for a request that is not there.
    const direction = await this.pendingRequestBetween(userId, friendUserId);
    if (direction) {
      return { ok: false, reason: direction === "received" ? "incoming_pending" : "already_sent" };
    }
    const friendsAlready = await this.areFriends(userId, friendUserId);
    return { ok: false, reason: friendsAlready ? "already_friends" : "already_sent" };
  },

  /**
   * Only the recipient of a pending request may accept it — otherwise any
   * caller could accept any request by id, including the sender accepting
   * their own (IDOR).
   */
  async acceptFriend(id: string, accepterId: string): Promise<{ requesterId: string } | null> {
    // A violation from the insert means the reverse row landed underneath this
    // transaction, and the retry sees it and only marks the request accepted.
    // One from the update means something no retry can move — resolved after
    // the loop — and either way answering "nothing to accept" on its own
    // leaves a request nobody can ever answer.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.transaction(async (tx) => {
          const [f] = await tx
            .update(friends)
            .set({ status: "accepted" })
            .where(
              and(
                eq(friends.id, id),
                eq(friends.friendUserId, accepterId),
                eq(friends.status, "pending")
              )
            )
            .returning();
          if (!f) return null;

          const exists = await this.areFriends(f.friendUserId, f.userId, tx);
          if (!exists) {
            await tx.insert(friends).values({
              userId: f.friendUserId,
              friendUserId: f.userId,
              status: "accepted",
            });
          }
          return { requesterId: f.userId };
        });
      } catch (err) {
        if (!uniqueViolation(err)?.includes("friends_accepted_uq")) throw err;
      }
    }
    // A request whose own direction is already an accepted friendship: the
    // update can never move it, because that row's key is in the index
    // already. It is a leftover of a request and an accept that crossed, so
    // clearing it is what the accept would have done.
    const [stale] = await db
      .select()
      .from(friends)
      .where(
        and(eq(friends.id, id), eq(friends.friendUserId, accepterId), eq(friends.status, "pending"))
      );
    if (!stale || !(await this.areFriends(stale.userId, accepterId))) return null;
    await db.delete(friends).where(eq(friends.id, id));
    return { requesterId: stale.userId };
  },

  async areFriends(
    userId: string,
    friendUserId: string,
    exec: Executor = db
  ): Promise<boolean> {
    const [row] = await exec
      .select()
      .from(friends)
      .where(
        and(
          eq(friends.userId, userId),
          eq(friends.friendUserId, friendUserId),
          eq(friends.status, "accepted")
        )
      );
    return !!row;
  },

  /**
   * Records that one player asked another to join a room, and returns whether
   * the invite is new. Re-inviting the same person to the same room refreshes
   * who's asking rather than adding a second row — so an impatient host and a
   * retried emit are the same event.
   *
   * `createdAt` is never in the update set: a hold is a cap on the room, not a
   * renewable lease (#840), so the 120s always runs from the first invite no
   * matter how many times the room re-asks.
   */
  async recordGameInvite(
    roomId: string,
    inviterId: string,
    inviteeId: string
  ): Promise<{ created: boolean }> {
    const [row] = await db
      .insert(gameInvites)
      .values({ roomId, inviterId, inviteeId })
      .onConflictDoUpdate({
        target: [gameInvites.roomId, gameInvites.inviteeId],
        set: { inviterId },
      })
      .returning({ createdAt: gameInvites.createdAt, id: gameInvites.id });
    return { created: !!row };
  },

  /**
   * The rooms this player has been asked to join and can still join.
   *
   * Both halves of "can still join" are checked, because `claimRoomSeat`
   * refuses `full` and `not_waiting` separately: a room nobody has started can
   * still have no seat left, and offering that invite sends the player at a
   * door that will not open. Deleting rows is hygiene; this is the guarantee.
   */
  async getGameInvites(
    inviteeId: string
  ): Promise<{ id: string; roomCode: string; fromUsername: string; createdAt: Date }[]> {
    const seatCount = db
      .select({ count: sql<number>`count(*)::int` })
      .from(roomPlayers)
      .where(eq(roomPlayers.roomId, gameInvites.roomId));
    const rows = await db
      .select({
        id: gameInvites.id,
        roomCode: rooms.code,
        fromUsername: users.username,
        createdAt: gameInvites.createdAt,
      })
      .from(gameInvites)
      .innerJoin(rooms, eq(gameInvites.roomId, rooms.id))
      .innerJoin(users, eq(gameInvites.inviterId, users.id))
      .where(
        and(
          eq(gameInvites.inviteeId, inviteeId),
          eq(rooms.status, "waiting"),
          sql`(${seatCount}) < ${rooms.maxPlayers}`
        )
      )
      .orderBy(desc(gameInvites.createdAt));
    return rows;
  },

  /**
   * Drops a room's invites once it can no longer be joined, and says who held
   * them. An invite is a pointer to a room, so it must not outlive one — and
   * the people it has to stop pointing for are exactly the rows just deleted.
   */
  async clearGameInvites(roomId: string): Promise<string[]> {
    const cleared = await db
      .delete(gameInvites)
      .where(eq(gameInvites.roomId, roomId))
      .returning({ inviteeId: gameInvites.inviteeId });
    return cleared.map((row) => row.inviteeId);
  },

  /** Who holds an invite to this room, leaving the rows alone. */
  async getRoomInvitees(roomId: string): Promise<string[]> {
    const held = await db
      .select({ inviteeId: gameInvites.inviteeId })
      .from(gameInvites)
      .where(eq(gameInvites.roomId, roomId));
    return held.map((row) => row.inviteeId);
  },

  /**
   * Turns one invite down. Addressed by room code rather than row id because
   * the unique index makes (invitee, room) name exactly one row, which also
   * makes a repeated decline a no-op instead of an error.
   *
   * Returns the room the freed hold belonged to, or null when there was
   * nothing to decline — the caller's cue for whether the room needs telling.
   */
  async declineGameInvite(inviteeId: string, roomCode: string): Promise<string | null> {
    const [row] = await db
      .delete(gameInvites)
      .where(
        and(
          eq(gameInvites.inviteeId, inviteeId),
          inArray(
            gameInvites.roomId,
            db.select({ id: rooms.id }).from(rooms).where(eq(rooms.code, roomCode))
          )
        )
      )
      .returning({ roomId: gameInvites.roomId });
    return row?.roomId ?? null;
  },

  async removeFriend(userId: string, friendUserId: string): Promise<void> {
    await db.delete(friends).where(
      or(
        and(eq(friends.userId, userId), eq(friends.friendUserId, friendUserId)),
        and(eq(friends.userId, friendUserId), eq(friends.friendUserId, userId))
      )
    );
  },

  /** Only the recipient may decline a pending request. */
  async declineFriendRequest(id: string, recipientId: string): Promise<boolean> {
    const deleted = await db
      .delete(friends)
      .where(
        and(
          eq(friends.id, id),
          eq(friends.friendUserId, recipientId),
          eq(friends.status, "pending")
        )
      )
      .returning({ id: friends.id });
    return deleted.length > 0;
  },

  async getSentFriendRequests(userId: string): Promise<(Friend & { recipient: User })[]> {
    const rows = await db
      .select()
      .from(friends)
      .innerJoin(users, eq(friends.friendUserId, users.id))
      .where(and(eq(friends.userId, userId), eq(friends.status, "pending")));
    return rows.map((r) => ({ ...r.friends, recipient: r.users }));
  },

  /** Only the sender may cancel their own pending request. */
  async cancelFriendRequest(requestId: string, fromUserId: string): Promise<boolean> {
    const deleted = await db
      .delete(friends)
      .where(
        and(eq(friends.id, requestId), eq(friends.userId, fromUserId), eq(friends.status, "pending"))
      )
      .returning({ id: friends.id });
    return deleted.length > 0;
  },
};
