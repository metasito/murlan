// Pure, dependency-free helpers pulled out of server/socket.ts specifically
// so they can be unit-tested directly. server/socket.ts itself transitively
// imports storage/db/session/etc, whose own relative imports lack the
// explicit `.ts` extensions Node's native TS loader requires — so it cannot
// be imported by the plain `node --test` runner used in tests/. This module
// has no runtime imports at all, so it can be.
//
// server/socket.ts imports these rather than re-implementing them, so the
// tests exercise the exact code path the server runs.

/**
 * seat -> userId from the persisted map, falling back to the legacy positional
 * array. The array loses the seat association as soon as a seat is vacated,
 * which is how a rejoining player used to be dealt someone else's hand.
 */
export function readPersistedPlayerMap(
  storedMap: unknown,
  storedIds: unknown
): Record<number, string> {
  const map: Record<number, string> = {};
  if (storedMap && typeof storedMap === "object" && !Array.isArray(storedMap)) {
    for (const [key, value] of Object.entries(storedMap as Record<string, unknown>)) {
      const seat = Number(key);
      if (Number.isInteger(seat) && seat >= 0 && typeof value === "string") {
        map[seat] = value;
      }
    }
  }
  if (Object.keys(map).length > 0) return map;

  if (Array.isArray(storedIds)) {
    storedIds.forEach((id, idx) => {
      if (typeof id === "string") map[idx] = id;
    });
  }
  return map;
}

/** The seat a given user occupies, or null if they are not seated at all. */
export function seatOfUser(
  playerMap: Record<number, string>,
  userId: string
): number | null {
  const entry = Object.entries(playerMap).find(([, uid]) => uid === userId);
  return entry ? Number(entry[0]) : null;
}

/**
 * The key a seat's score accumulates under: the seated userId, or the
 * `bot:<seat>` sentinel for a seat vacated to AI takeover.
 */
export function scoreKeyForSeat(
  playerMap: Record<number, string>,
  seat: number
): string {
  return playerMap[seat] ?? `bot:${seat}`;
}

/**
 * The seat a viewer should see as "mine". Server-authoritative — this is
 * what sanitizeStateForPlayer stamps onto every game:state as
 * `viewerSeatIndex`, so the client never has to guess (and never falls back
 * to seat 0 when it doesn't know).
 */
export function findViewerSeat(
  playerMap: Record<number, string>,
  viewerUserId: string
): number | null {
  return seatOfUser(playerMap, viewerUserId);
}

/**
 * Strips vacated (`bot:<seat>`) entries out of a per-hand score breakdown
 * before it is merged into a match's cumulative scores. A bot-controlled
 * seat must never accumulate match points or become eligible to win the
 * match under the departed human's username.
 */
export function excludeBotSeats(
  handByKey: Record<string, number>
): Record<string, number> {
  const scorable: Record<string, number> = {};
  for (const [key, points] of Object.entries(handByKey)) {
    if (key.startsWith("bot:")) continue;
    scorable[key] = points;
  }
  return scorable;
}

/**
 * Bumped whenever the persisted shape of `gameState` stops being safe to
 * restore verbatim (e.g. the deal changed from 13 cards/player to the full
 * deck). A row written under an older version holds hands that no longer
 * match the current rules — rehydrating it deals a silently corrupt game
 * instead of crashing, so it must be rejected, not restored.
 */
export const GAME_SCHEMA_VERSION = 1;

/** True when a persisted row's schema is missing or does not match the current one. */
export function isStaleSchema(
  persisted: { schemaVersion?: number } | null | undefined
): boolean {
  return !persisted || persisted.schemaVersion !== GAME_SCHEMA_VERSION;
}

export interface SeatEntry {
  seatIndex: number;
  userId: string;      // for bots, a synthetic "bot:<seat>" id
  username: string;
  isBot: boolean;
  difficulty?: "easy" | "medium" | "hard";
}

/**
 * The full seat roster a game starts with: the seated humans, plus — when
 * `fillWithBots` is requested — a bot seat for every gap up to `maxPlayers`.
 *
 * Pure function so room:start's seat-assignment logic (which of the humans
 * plus bots occupies which engine seat) is unit-testable without spinning up
 * a socket server. server/socket.ts imports this rather than reimplementing
 * it, so tests exercise the exact code path the server runs.
 */
export function buildSeatRoster(
  humans: { seatIndex: number; userId: string; username: string }[],
  maxPlayers: number,
  opts: { fillWithBots?: boolean; botDifficulty?: "easy" | "medium" | "hard" }
): SeatEntry[] {
  const roster: SeatEntry[] = humans
    .map((h) => ({ ...h, isBot: false }))
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (!opts.fillWithBots) return roster;

  const taken = new Set(roster.map((r) => r.seatIndex));
  const difficulty = opts.botDifficulty ?? "medium";
  for (let seat = 0; seat < maxPlayers; seat++) {
    if (taken.has(seat)) continue;
    roster.push({
      seatIndex: seat,
      // Synthetic id: bot seats must never collide with a real user id, and the
      // scoring path already excludes ids with this prefix.
      userId: `bot:${seat}`,
      username: `Bot ${seat + 1}`,
      isBot: true,
      difficulty,
    });
  }
  return roster.sort((a, b) => a.seatIndex - b.seatIndex);
}
