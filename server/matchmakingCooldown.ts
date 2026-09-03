// Server-side edge of the abandonment cooldown (lib/abandonCooldown.ts):
// reads the rows `server/stats.ts` wrote and turns them into a gate. The gate
// itself is a plain read of match_history — no cooldown state of its own —
// so a match already recorded there is the only source of truth, per
// CLAUDE.md's storage ordering (derive from existing rows before adding
// storage).
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "./db.ts";
import { matchHistory } from "../shared/schema.ts";
import {
  abandonCooldown,
  ABANDON_COOLDOWN_THRESHOLD,
  ABANDON_COOLDOWN_WINDOW_MS,
  type CooldownState,
} from "../lib/abandonCooldown.ts";

export async function matchmakingCooldownFor(
  userId: string,
  now: Date = new Date()
): Promise<CooldownState> {
  const windowStart = new Date(now.getTime() - ABANDON_COOLDOWN_WINDOW_MS);
  const rows = await db
    .select({ finishedAt: matchHistory.finishedAt })
    .from(matchHistory)
    .where(
      and(
        eq(matchHistory.userId, userId),
        eq(matchHistory.abandoned, true),
        gt(matchHistory.finishedAt, windowStart)
      )
    )
    .orderBy(desc(matchHistory.finishedAt))
    .limit(ABANDON_COOLDOWN_THRESHOLD);
  return abandonCooldown(
    rows.map((r) => r.finishedAt),
    now
  );
}
