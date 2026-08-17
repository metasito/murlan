// Pure, dependency-free helpers used by server/socket.ts. server/socket.ts
// transitively imports storage/db/session/etc, whose own relative imports
// lack the explicit `.ts` extensions Node's native TS loader requires — so it
// cannot be imported by the plain `node --test` runner used in tests/. This
// module imports nothing beyond an equally pure sibling, so it can be, and
// server/socket.ts imports these rather than reimplementing them so tests
// exercise the exact code path the server runs.
import { botSeatNames, getBotPersonality } from "../lib/botPersonalities.ts";
import type { BotPersonalityId } from "../lib/botPersonalities.ts";

/**
 * seat -> userId from the persisted map, falling back to the legacy positional
 * array. The array loses the seat association as soon as a seat is vacated,
 * so relying on it can hand a rejoining player someone else's hand.
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

/** The shape of GameState.exchangePhase, restated so this module keeps its
 * "no imports at all" property (see the header). `cardFromLoser` is `unknown`
 * here on purpose: this helper only decides whether to forward it. */
export interface VisibleExchangePhaseInput {
  active: boolean;
  winnerIdx: number;
  loserIdx: number;
  bothJokersException: boolean;
  cardFromLoser: unknown;
}

/**
 * The part of an exchange phase a given seat is allowed to see.
 *
 * Only the two people in the exchange have any use for `cardFromLoser`: the
 * winner's ExchangeModal shows the card they were handed, and the loser is
 * entitled to see the card taken off them. Every other seat needs the two seat
 * indices and the both-jokers flag — all the announcement banner reads — and
 * once the phase has closed nobody needs the card at all.
 */
export function visibleExchangePhase(
  phase: VisibleExchangePhaseInput | undefined,
  viewerSeatIndex: number | null
): Record<string, unknown> | undefined {
  if (!phase) return undefined;

  const visible: Record<string, unknown> = {
    active: phase.active,
    winnerIdx: phase.winnerIdx,
    loserIdx: phase.loserIdx,
    bothJokersException: phase.bothJokersException,
  };

  const isParticipant =
    viewerSeatIndex !== null &&
    (viewerSeatIndex === phase.winnerIdx || viewerSeatIndex === phase.loserIdx);

  if (phase.active && isParticipant) visible.cardFromLoser = phase.cardFromLoser;
  return visible;
}

/**
 * True when a table was contested by enough real people for its outcome to be
 * worth recording in stats / match history / achievements.
 *
 * A private room of one human plus bots stays fully playable — practice
 * against the AI is a feature — but the human's wins there are guaranteed
 * points, which would trivially unlock `match_champion`, `iron_will` and
 * endless streaks. This is about what gets *recorded*, never about what is
 * allowed.
 *
 * The line is bot *majority*: 1 human + 3 bots and 1 human + 2 bots are out;
 * an even split (1 v 1, 2 v 2) still counts. Seats vacated mid-game count as
 * bots, so "invite three friends, have them all leave" is not a route back to
 * the same free points.
 */
export function isContestedTable(humanSeats: number, botSeats: number): boolean {
  return botSeats <= humanSeats;
}

/**
 * Bumped whenever the persisted shape of `gameState` stops being safe to
 * restore verbatim (e.g. a change to how many cards are dealt per player). A
 * row written under an older version can hold hands that no longer match the
 * current rules — rehydrating it deals a silently corrupt game instead of
 * crashing, so it must be rejected, not restored.
 */
export const GAME_SCHEMA_VERSION = 1;

/** True when a persisted row's schema is missing or does not match the current one. */
export function isStaleSchema(
  persisted: { schemaVersion?: number } | null | undefined
): boolean {
  return !persisted || persisted.schemaVersion !== GAME_SCHEMA_VERSION;
}

export type HandFlags = Record<number, { bomb: boolean; joker: boolean }>;

/** The stored `game_state` blob: the engine's state plus the fields that ride with it. */
export type PersistedEnvelope<S> = S & {
  schemaVersion: number;
  handFlags?: HandFlags;
};

/**
 * Wraps engine state for storage. `handFlags` travels here rather than in its
 * own column because a new column cannot be written until someone runs
 * `db:push` on Replit, and every persist would fail silently until they did.
 */
export function packPersistedState<S extends object>(
  gameState: S,
  handFlags: HandFlags
): PersistedEnvelope<S> {
  return { ...gameState, schemaVersion: GAME_SCHEMA_VERSION, handFlags };
}

/**
 * Splits a stored blob back into engine state and the fields that rode with
 * it. The envelope fields must not survive into the game state: it is
 * broadcast to every client and compared against engine output.
 */
export function unpackPersistedState<S extends object>(
  persisted: PersistedEnvelope<S>
): { gameState: S; handFlags: HandFlags } {
  const { schemaVersion: _schemaVersion, handFlags, ...gameState } = persisted;
  // A row written before handFlags joined the envelope has none; starting that
  // hand's tracking over is the pre-existing behaviour, so no schema bump.
  return { gameState: gameState as unknown as S, handFlags: handFlags ?? {} };
}

export interface SeatEntry {
  seatIndex: number;
  userId: string;      // for bots, a synthetic "bot:<seat>" id
  username: string;
  isBot: boolean;
  personality?: BotPersonalityId;
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
  opts: { fillWithBots?: boolean; botPersonality?: BotPersonalityId }
): SeatEntry[] {
  const roster: SeatEntry[] = humans
    .map((h) => ({ ...h, isBot: false }))
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (!opts.fillWithBots) return roster;

  const taken = new Set(roster.map((r) => r.seatIndex));
  const personality = getBotPersonality(opts.botPersonality).id;
  const emptySeats = Array.from({ length: maxPlayers }, (_, s) => s).filter((s) => !taken.has(s));
  const names = botSeatNames(emptySeats.map(() => personality));

  emptySeats.forEach((seat, i) => {
    roster.push({
      seatIndex: seat,
      // Synthetic id: bot seats must never collide with a real user id, and the
      // scoring path already excludes ids with this prefix.
      userId: `bot:${seat}`,
      username: names[i],
      isBot: true,
      personality,
    });
  });
  return roster.sort((a, b) => a.seatIndex - b.seatIndex);
}
