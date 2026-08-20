// The order an end-of-manche scoreboard is listed in.
//
// Kept free of runtime `@/` imports for the same reason lib/cardNames.ts is:
// Node's built-in TypeScript loader (`node --test`) type-strips plain .ts but
// cannot resolve the `@/` bundler alias at runtime.

/**
 * One row of a scoreboard, however the screen showing it keys its players.
 * Callers extend this with whatever else their row renders.
 */
export interface StandingRow {
  /** Running match points — what the standings are ranked by. */
  total: number;
  /** What the manche just played earned this row. */
  points: number;
  /** Placement in the manche just played, best first. */
  finishedAt: number;
}

/**
 * Standings, best first: match points descending, a tie broken by the manche
 * just played.
 *
 * Presentation order, not a rule — who actually wins the match is decided by
 * `resolveMatchFor` in lib/gameEngine.ts (docs/RULES.md §12). This is the one
 * place the *listing* order is decided, so the two end-of-manche screens
 * cannot rank the same table differently.
 */
export function standings<T extends StandingRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.total - a.total || a.finishedAt - b.finishedAt);
}
