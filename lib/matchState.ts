// What a match has decided, in the one shape both modes report it in.
//
// Relative imports and no `react-native`, for the same reason
// lib/exchangeCeremony.ts has none: the server bundles this with no alias
// resolution, and `node --test` type-strips plain .ts without resolving `@/`.
import type { MatchLength } from "./gameEngine.ts";

export interface MatchVerdict {
  length: MatchLength;
  /** Current point target. Escalates 21 → 31 → 41 → 51 on a tie at the target. */
  target: number;
  over: boolean;
  /** Engine player ids (`player_0`). Empty until the match ends. */
  winners: string[];
  isDraw: boolean;
}

/**
 * The name a roster gives an engine player id, or null where it names no seat.
 *
 * Never the id itself. A fallback returning its own input is why a crossed
 * value once printed `player_0` on the celebration rather than failing: given
 * a name it returns the right string, and given anything else a plausible one.
 * A vacated seat, a closed account and a bot are not misses — the engine
 * roster keeps the name in all three.
 */
export function nameOfSeat(
  players: readonly { id: string; name: string }[],
  engineId: string | undefined
): string | null {
  if (engineId === undefined) return null;
  return players.find((p) => p.id === engineId)?.name ?? null;
}
