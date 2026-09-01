// The one sentinel a vacated seat scores under, and the one predicate that
// recognises it.
//
// A leaf on purpose: the scoring path, the stats writer and the profile's read
// path all need this check, and reaching for it through any of them would drag
// that one's whole graph — the engine, the personalities, the ceremony —
// behind a string comparison.

/** The scoring key a seat with no `playerMap` entry takes. */
export function botSeatKey(seat: number): string {
  return `bot:${seat}`;
}

/**
 * Whether a scoring key names a bot seat rather than a real account. Nothing
 * keyed by `users.id` may accept one: there is no row behind it, so every
 * foreign key would fail.
 */
export function isBotSeatKey(key: string): boolean {
  return key.startsWith("bot:");
}

/** The seat a `bot:<seat>` key names, or null if it names no seat. */
export function botSeatIndex(key: string): number | null {
  const seat = Number(key.slice("bot:".length));
  return Number.isInteger(seat) ? seat : null;
}
