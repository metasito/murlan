import { eq, and, or, sql, desc, inArray } from "drizzle-orm";
import { db } from "./db.ts";
import { users, rooms, roomPlayers, friends, gameInvites } from "../shared/schema.ts";
import type { User, Friend } from "../shared/schema.ts";

/**
 * An object rather than bare exported functions: `tests/integration/
 * socketHandshakeLimit.test.ts` replaces `getFriends` with a counting stub to
 * drive the handshake paths, and an ES module's namespace is sealed against
 * exactly that.
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
    friendUserId: string
  ): Promise<"sent" | "received" | null> {
    const [row] = await db
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

  /** Returns the row it created, so the caller can push it rather than make the recipient ask for it. */
  async addFriend(userId: string, friendUserId: string): Promise<Friend | undefined> {
    const [row] = await db
      .insert(friends)
      .values({ userId, friendUserId, status: "pending" })
      .returning();
    return row;
  },

  /**
   * Only the recipient of a pending request may accept it — otherwise any
   * caller could accept any request by id, including the sender accepting
   * their own (IDOR).
   */
  async acceptFriend(id: string, accepterId: string): Promise<{ requesterId: string } | null> {
    const [f] = await db
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

    const exists = await this.areFriends(f.friendUserId, f.userId);
    if (!exists) {
      await db.insert(friends).values({
        userId: f.friendUserId,
        friendUserId: f.userId,
        status: "accepted",
      });
    }
    return { requesterId: f.userId };
  },

  async areFriends(userId: string, friendUserId: string): Promise<boolean> {
    const [row] = await db
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
