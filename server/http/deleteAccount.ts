import { eq, or, sql } from "drizzle-orm";
import { transaction } from "../store/db.ts";
import { roomStore } from "../store/roomStore.ts";
import { deleteInBatches } from "../game/retention.ts";
import { logger } from "../shared/logger.ts";
import {
  users,
  rooms,
  roomPlayers,
  friends,
  roundReplays,
  serverErrors,
} from "../../shared/schema.ts";
import { track } from "../shared/inFlight.ts";

/**
 * Apple requires in-app account deletion to actually work. Every row that
 * references users.id has to go, or the final DELETE trips a foreign key and
 * the endpoint 500s: friends (both directions), room_players, the rooms this
 * user hosts (plus their players and any persisted game), and the sessions.
 *
 * All of it in one transaction, which is why it writes the rows itself or hands
 * the store its `tx`, rather than calling a store method that opens its own.
 * The one exception is `server_errors`, a log no foreign key ties to the
 * account: it is purged after the commit, and a purge that fails leaves the
 * deletion standing and its rows to age out.
 */
export async function deleteUser(userId: string): Promise<string[]> {
  const seatedRoomIds = await transaction(async (tx) => {
    await tx
      .delete(friends)
      .where(or(eq(friends.userId, userId), eq(friends.friendUserId, userId)));

    const seated = await tx
      .delete(roomPlayers)
      .where(eq(roomPlayers.userId, userId))
      .returning({ roomId: roomPlayers.roomId });

    const hosted = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.hostUserId, userId));

    await roomStore.purgeRooms(tx, hosted.map((r) => r.id));

    // Every other table that names a user carries a cascading foreign key.
    // round_replays cannot: a replay belongs to up to four players, so it
    // holds their ids and display names inside jsonb instead. Deleting the
    // rows outright would take other players' replays with it, so a replay
    // nobody else is left to open is removed, and the departing player is
    // erased from the rest — id out of the ownership filter, name out of the
    // seat.
    const own = JSON.stringify([userId]);
    // A seat left mid-match keeps the person's name without their id ever
    // reaching `player_ids`, so the ownership filter alone never finds it.
    const named = sql`(${roundReplays.playerIds} @> ${own}::jsonb
      OR ${roundReplays.seats} @> ${JSON.stringify([{ vacatedBy: userId }])}::jsonb)`;

    await tx.delete(roundReplays).where(sql`${named} AND ${roundReplays.playerIds} <@ ${own}::jsonb`);
    // An empty name is the signal to the client to render its own localized
    // "deleted player" label — the row itself keeps no wording.
    await tx
      .update(roundReplays)
      .set({
        playerIds: sql`${roundReplays.playerIds} - ${userId}::text`,
        seats: sql`(SELECT coalesce(jsonb_agg(
            CASE WHEN seat->>'userId' = ${userId} OR seat->>'vacatedBy' = ${userId}
              THEN seat || '{"userId": null, "vacatedBy": null, "name": ""}'::jsonb
              ELSE seat END
            ORDER BY position), '[]'::jsonb)
          FROM jsonb_array_elements(${roundReplays.seats}) WITH ORDINALITY AS s(seat, position))`,
      })
      .where(named);

    await tx.execute(
      sql`DELETE FROM session WHERE sess->>'userId' = ${userId}`
    );

    await tx.delete(users).where(eq(users.id, userId));
    return seated.map((r) => r.roomId);
  });
  void track(purgeServerErrors(userId).catch((err: unknown) =>
    logger.error({ err, userId }, "Could not purge a deleted account's server errors")
  ));
  return seatedRoomIds;
}

/** `context` is free-form, so the only way to find the id in it is to read every row's text. */
function purgeServerErrors(userId: string): Promise<number> {
  return deleteInBatches(serverErrors, sql`${serverErrors.context}::text LIKE ${"%" + userId + "%"}`);
}
