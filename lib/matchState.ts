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
 * What the results board calls the seat it celebrates.
 *
 * `candidates` is ordered best-first, and one naming no seat is passed over
 * rather than accepted empty: a match can be over with no winners, because a
 * client that rejoins a finished table never receives `game:over`, and a
 * winner id can outlive the seat it named. The empty string where none of them
 * names a seat — never an id, which reaches the screen as `player_0`.
 */
export function celebration(
  players: readonly { id: string; name: string; team?: string }[],
  candidates: readonly (string | undefined)[],
  teamLabel: ((team: string) => string) | null
): string {
  for (const id of candidates) {
    const seat = id === undefined ? undefined : players.find((p) => p.id === id);
    if (!seat) continue;
    return teamLabel && seat.team ? teamLabel(seat.team) : seat.name;
  }
  return "";
}
