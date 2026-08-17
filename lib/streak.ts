// Consecutive-days-played streak.
//
// Pure and dependency-free so it can be unit-tested without a database, and so
// the server and any future client display cannot disagree about what a streak
// is.
//
// Days are UTC. The server is the only party that sees the timestamps and it
// has no record of a player's timezone, so a UTC boundary is the only honest
// one available — a player near midnight in their own zone may see the day
// turn over early or late. Storing a timezone per user would fix it and is not
// worth a column for a decoration.

/** A UTC calendar day, as `YYYY-MM-DD`. */
export type UtcDay = string;

export function utcDay(when: Date | string): UtcDay {
  const d = typeof when === "string" ? new Date(when) : when;
  return d.toISOString().slice(0, 10);
}

function dayBefore(day: UtcDay): UtcDay {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * How many days in a row the player has played, counting back from today.
 *
 * A streak survives until a whole day is missed: playing yesterday but not yet
 * today still counts, otherwise every streak would appear broken every morning
 * until the first game. Playing neither today nor yesterday is a streak of 0.
 */
export function dailyStreak(playedOn: Iterable<Date | string>, today: UtcDay): number {
  const days = new Set<UtcDay>();
  for (const when of playedOn) days.add(utcDay(when));
  if (days.size === 0) return 0;

  let cursor = days.has(today) ? today : dayBefore(today);
  if (!days.has(cursor)) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = dayBefore(cursor);
  }
  return streak;
}
