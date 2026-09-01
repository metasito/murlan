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
 * Who the results board celebrates, and what it calls them.
 *
 * `candidates` is ordered best-first and holes are skipped: a match can be
 * over with no winners, because a client that rejoins a finished table never
 * receives `game:over`. An id that names no seat yields the empty string —
 * never the id itself, which would read as `player_0` on the celebration.
 */
export function celebration(
  players: readonly { id: string; name: string; team?: string }[],
  candidates: readonly (string | undefined)[],
  teamLabel: ((team: string) => string) | null
): { id: string | undefined; name: string } {
  const id = candidates.find((c) => c !== undefined);
  const seat = players.find((p) => p.id === id);
  if (!seat) return { id, name: "" };
  return { id, name: teamLabel && seat.team ? teamLabel(seat.team) : seat.name };
}
