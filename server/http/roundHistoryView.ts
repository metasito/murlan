// The profile's one card of recent rounds: every row named, and watchable where
// its replay survives.
//
// Its own module rather than part of stats.ts, which owns `round_history` and
// nothing else. This reads three tables that belong to three different owners
// — history, replays, and accounts — so putting it in any one of them would
// spread that one's imports across every caller and test of it.
import { and, inArray, sql } from "drizzle-orm";
import { db } from "../store/db.ts";
import { roundReplays } from "../../shared/schema.ts";
import type { RoundHistory } from "../../shared/schema.ts";
import type { ReplaySeat } from "../../lib/game/replay.ts";
import { botSeatIndex, isBotSeatKey } from "../../lib/game/botSeat.ts";
import { getRoundHistory } from "../game/stats.ts";
import { namesOf } from "../game/userNames.ts";

/** One of the other seats at a round the reader played. */
interface HistoryParticipant {
  /**
   * Null where nothing stored can name the seat: a bot at a round whose replay
   * has expired, or an account deleted since. The two are different sentences
   * to a reader, which is what `bot` is for — the server picks neither,
   * because it does not know the reader's language.
   */
  name: string | null;
  bot: boolean;
}

export interface RoundHistoryRow extends Omit<RoundHistory, "opponents"> {
  opponents: string[];
  /** The other seats, in the order `opponents` holds them. */
  participants: HistoryParticipant[];
  /** This round's replay, while one still exists to watch. */
  replayId: string | null;
}

interface PairedReplay {
  id: string;
  seats: ReplaySeat[];
}

/**
 * The reader's replays by the instant they finished, and only where that
 * instant names one round.
 *
 * A seated player is at one table at a time, so two of their own rounds sharing
 * a millisecond should not arise — but "should not" is not a key. An instant
 * that names two replays pairs with neither, which costs a play button rather
 * than offering the wrong round under the right one's row.
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


/**
 * `round_history` and `round_replays` share no key. They do share the round's
 * one `finishedAt`, written by both since #739, so `(userId, finishedAt)` pairs
 * them — rows written before that carry no replay, which is what an expired
 * replay looks like anyway.
 *
 * A bot's stored id is `bot:<seat>` and holds no personality, so its name can
 * only come from the replay's own seats. That makes a bot nameable for exactly
 * as long as its round is watchable, and anonymous afterwards.
 */
export async function getRoundHistoryView(userId: string): Promise<RoundHistoryRow[]> {
  const rows = await getRoundHistory(userId);
  if (rows.length === 0) return [];

  const [replays, humans] = await Promise.all([
    db
      .select({
        id: roundReplays.id,
        finishedAt: roundReplays.finishedAt,
        seats: roundReplays.seats,
      })
      .from(roundReplays)
      .where(
        and(
          sql`${roundReplays.playerIds} @> ${JSON.stringify([userId])}::jsonb`,
          inArray(
            roundReplays.finishedAt,
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
    const opponents = row.opponents as string[];
    const participants = opponents.map((id) => {
      if (!isBotSeatKey(id)) return { name: humans.get(id) ?? null, bot: false };
      const seat = botSeatIndex(id);
      const named = replay?.seats.find((s) => s.seatIndex === seat);
      return { name: named?.name ?? null, bot: true };
    });
    return { ...row, opponents, participants, replayId: replay?.id ?? null };
  });
}
