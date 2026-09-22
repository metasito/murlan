export type LadderScope = "global" | "friends";

/** Prefix of every ladder board's key: invalidate this and each scope refetches. */
export const LADDER_KEY = ["/api/ratings/leaderboard"] as const;

export function ladderKey(scope: LadderScope): readonly string[] {
  return scope === "global" ? LADDER_KEY : [...LADDER_KEY, scope];
}
