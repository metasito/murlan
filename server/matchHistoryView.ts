// The profile's one card of recent hands: every row named, and watchable where
// its replay survives.
//
// Its own module rather than part of stats.ts, which owns `match_history` and
// nothing else. This reads three tables that belong to three different owners
// — history, replays, and accounts — so putting it in any one of them would
// spread that one's imports across every caller and test of it.
import { and, inArray, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { matchReplays, users } from "../shared/schema.ts";
import type { MatchHistory } from "../shared/schema.ts";
import type { ReplaySeat } from "../lib/replay.ts";
import { botSeatIndex, isBotSeatKey } from "./botSeat.ts";
import { getMatchHistory } from "./stats.ts";

/** One of the other seats at a hand the reader played. */
export interface HistoryParticipant {
  /**
   * Null where nothing stored can name the seat: a bot at a hand whose replay
   * has expired, or an account deleted since. The two are different sentences
   * to a reader, which is what `bot` is for — the server picks neither,
   * because it does not know the reader's language.
   */
  name: string | null;
  bot: boolean;
}

export interface MatchHistoryRow extends MatchHistory {
  /** The other seats, in the order `opponents` holds them. */
  participants: HistoryParticipant[];
  /** This hand's replay, while one still exists to watch. */
  replayId: string | null;
}

interface PairedReplay {
  id: string;
  seats: ReplaySeat[];
}

/**
 * The reader's replays by the instant they finished, and only where that
 * instant names one hand.
 *
 * A seated player is at one table at a time, so two of their own hands sharing
 * a millisecond should not arise — but "should not" is not a key. An instant
 * that names two replays pairs with neither, which costs a play button rather
 * than offering the wrong hand under the right one's row.
 */
function replaysByInstant(
  replays: { id: string; finishedAt: Date; seats: ReplaySeat[] }[]
): Map<number, PairedReplay | null> {
  const byInstant = new Map<number, PairedReplay | null>();
  for (const replay of replays) {
    const instant = replay.finishedAt.getTime();
    byInstant.set(instant, byInstant.has(instant) ? null : replay);
  }
  return byInstant;
}

/** Display names for the account ids given, skipping any that no longer exist. */
async function namesOf(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.username]));
}

/**
 * `match_history` and `match_replays` share no key. They do share the hand's
 * one `finishedAt`, written by both since #739, so `(userId, finishedAt)` pairs
 * them — rows written before that carry no replay, which is what an expired
 * replay looks like anyway.
 *
 * A bot's stored id is `bot:<seat>` and holds no personality, so its name can
 * only come from the replay's own seats. That makes a bot nameable for exactly
 * as long as its hand is watchable, and anonymous afterwards.
 */
export async function getMatchHistoryView(userId: string): Promise<MatchHistoryRow[]> {
  const rows = await getMatchHistory(userId);
  if (rows.length === 0) return [];

  const [replays, humans] = await Promise.all([
    db
      .select({
        id: matchReplays.id,
        finishedAt: matchReplays.finishedAt,
        seats: matchReplays.seats,
      })
      .from(matchReplays)
      .where(
        and(
          sql`${matchReplays.playerIds} @> ${JSON.stringify([userId])}::jsonb`,
          inArray(
            matchReplays.finishedAt,
            rows.map((r) => r.finishedAt)
          )
        )
      ),
    namesOf(
      rows.flatMap((r) => (r.opponents as string[]).filter((id) => !isBotSeatKey(id)))
    ),
  ]);

  const byInstant = replaysByInstant(replays);

  return rows.map((row) => {
    const replay = byInstant.get(row.finishedAt.getTime()) ?? null;
    const participants = (row.opponents as string[]).map((id) => {
      if (!isBotSeatKey(id)) return { name: humans.get(id) ?? null, bot: false };
      const seat = botSeatIndex(id);
      const named = replay?.seats.find((s) => s.seatIndex === seat);
      return { name: named?.name ?? null, bot: true };
    });
    return { ...row, participants, replayId: replay?.id ?? null };
  });
}
