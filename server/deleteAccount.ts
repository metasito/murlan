import { eq, or, sql, inArray } from "drizzle-orm";
import { db } from "./db.ts";
import {
  users,
  rooms,
  roomPlayers,
  friends,
  activeGames,
  matchReplays,
} from "../shared/schema.ts";

/**
 * Apple requires in-app account deletion to actually work. Every row that
 * references users.id has to go, or the final DELETE trips a foreign key and
 * the endpoint 500s: friends (both directions), room_players, the rooms this
 * user hosts (plus their players and any persisted game), and the sessions.
 *
 * It reaches every domain the stores divide between, and does so in one
 * transaction — which is why it lives in neither of them and writes the rows
 * itself rather than calling across stores that each open their own.
 */
export async function deleteUser(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(friends)
      .where(or(eq(friends.userId, userId), eq(friends.friendUserId, userId)));

    await tx.delete(roomPlayers).where(eq(roomPlayers.userId, userId));

    const hosted = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.hostUserId, userId));
    const hostedIds = hosted.map((r) => r.id);

    if (hostedIds.length > 0) {
      await tx.delete(roomPlayers).where(inArray(roomPlayers.roomId, hostedIds));
      await tx
        .delete(activeGames)
        .where(inArray(activeGames.roomId, hostedIds));
      await tx.delete(rooms).where(inArray(rooms.id, hostedIds));
    }

    // Every other table that names a user carries a cascading foreign key.
    // match_replays cannot: a replay belongs to up to four players, so it
    // holds their ids and display names inside jsonb instead. Deleting the
    // rows outright would take other players' replays with it, so the
    // departing player is erased from them instead — id out of the ownership
    // filter, name out of the seat — and a replay nobody is left to open is
    // then removed.
    const theirReplays = await tx
      .select({ id: matchReplays.id, playerIds: matchReplays.playerIds, seats: matchReplays.seats })
      .from(matchReplays)
      .where(sql`${matchReplays.playerIds} @> ${JSON.stringify([userId])}::jsonb`);

    for (const row of theirReplays) {
      const playerIds = row.playerIds.filter((id) => id !== userId);
      if (playerIds.length === 0) {
        await tx.delete(matchReplays).where(eq(matchReplays.id, row.id));
        continue;
      }
      // An empty name is the signal to the client to render its own
      // localized "deleted player" label — the row itself keeps no wording.
      const seats = row.seats.map((seat) =>
        seat.userId === userId ? { ...seat, userId: null, name: "" } : seat
      );
      await tx
        .update(matchReplays)
        .set({ playerIds, seats })
        .where(eq(matchReplays.id, row.id));
    }

    await tx.execute(
      sql`DELETE FROM session WHERE sess->>'userId' = ${userId}`
    );

    await tx.delete(users).where(eq(users.id, userId));
  });
}
