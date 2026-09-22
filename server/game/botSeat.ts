// `bot:<seat>` — the key a seat with no account scores under.
//
// A leaf module so the read paths that only need the predicate do not pull the
// engine, the personalities and the ceremony in behind it.

export function botSeatKey(seat: number): string {
  return `bot:${seat}`;
}

/**
 * Nothing keyed by `users.id` may accept one of these: there is no row behind
 * it, so every foreign key would fail.
 */
export function isBotSeatKey(key: string): boolean {
  return key.startsWith("bot:");
}

/** The seat the key names, or null if it names no seat. */
export function botSeatIndex(key: string): number | null {
  const seat = Number(key.slice("bot:".length));
  return Number.isInteger(seat) ? seat : null;
}
