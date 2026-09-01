// Trends over a player's finished matches.
//
// A lifetime average is the least interesting number a player has: it stops
// moving after fifty games and never says whether they are improving. Every
// shape here reads the same bounded `match_history` rows the profile already
// fetches — nothing new is stored, and nothing reads further back than the
// server already sends.

import type { MatchHistoryDto } from "./wire";

/** The three fields of a history row these trends read. */
export type MatchRecord = Pick<MatchHistoryDto, "finishedAt" | "placement" | "playerCount">;

export interface PlacementSlice {
  placement: number;
  played: number;
  /** 0–1 of the matches counted, for a bar to be drawn from. */
  share: number;
}

export interface PlayerCountSlice {
  playerCount: number;
  played: number;
  won: number;
  /** Rounded to one decimal: an average placement of exactly 2 is rare. */
  averagePlacement: number;
}

/** How many results the form strip shows, so a long history cannot grow it. */
export const RECENT_FORM_LIMIT = 12;

/** Newest first. The server orders these already; this does not depend on it. */
function newestFirst(history: MatchRecord[]): MatchRecord[] {
  return [...history].sort(
    (a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()
  );
}

/**
 * The last few placements, newest first. Bounded, because `match_history`
 * grows with every match a player finishes and this strip must not.
 */
export function recentForm(history: MatchRecord[], limit = RECENT_FORM_LIMIT): number[] {
  return newestFirst(history)
    .slice(0, limit)
    .map((match) => match.placement);
}

/**
 * How often each placement was reached, ordered best first, and only for
 * placements that actually occurred — a player who has never come fourth has
 * no fourth row, rather than a zero one.
 */
export function placementDistribution(history: MatchRecord[]): PlacementSlice[] {
  const counts = new Map<number, number>();
  for (const match of history) {
    counts.set(match.placement, (counts.get(match.placement) ?? 0) + 1);
  }
  const total = history.length;
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([placement, played]) => ({
      placement,
      played,
      share: total === 0 ? 0 : played / total,
    }));
}

/**
 * Results split by how many were at the table. A player can be strong at three
 * and weak at four, and a lifetime win rate hides exactly that.
 */
export function byPlayerCount(history: MatchRecord[]): PlayerCountSlice[] {
  const groups = new Map<number, MatchRecord[]>();
  for (const match of history) {
    const group = groups.get(match.playerCount);
    if (group) group.push(match);
    else groups.set(match.playerCount, [match]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([playerCount, matches]) => ({
      playerCount,
      played: matches.length,
      won: matches.filter((m) => m.placement === 1).length,
      averagePlacement:
        Math.round(
          (matches.reduce((sum, m) => sum + m.placement, 0) / matches.length) * 10
        ) / 10,
    }));
}
