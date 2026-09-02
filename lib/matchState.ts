// What a match has decided, in the one shape both modes report it in.
//
// Relative imports and no `react-native`, for the same reason
// lib/exchangeCeremony.ts has none: the server bundles this with no alias
// resolution, and `node --test` type-strips plain .ts without resolving `@/`.
import { aggregateTeamScores } from "./gameEngine.ts";
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

/**
 * Whether `viewerId` is the seat (or, in team mode, teammate of the seat)
 * `celebration` would name from the same `candidates`. Gated on `isTeamMode`
 * rather than on `seat.team` alone, to stay in step with `celebration`'s own
 * `teamLabel` gate. Undefined for a viewer holding no seat.
 */
export function celebratesViewer(
  players: readonly { id: string; team?: string }[],
  candidates: readonly (string | undefined)[],
  viewerId: string | undefined,
  isTeamMode: boolean
): boolean {
  if (viewerId === undefined) return false;
  const viewerTeam = players.find((p) => p.id === viewerId)?.team;
  for (const id of candidates) {
    const seat = id === undefined ? undefined : players.find((p) => p.id === id);
    if (!seat) continue;
    return isTeamMode && seat.team !== undefined
      ? seat.team === viewerTeam
      : seat.id === viewerId;
  }
  return false;
}

/**
 * Whether a just-played manche paid every team the same total (RULES.md §11):
 * first-and-fourth pays 3+0, second-and-third pays 2+1, both 3. A draw this
 * way has no candidate to celebrate, so the caller must drop the manche's own
 * placement (`rankings[0]`, the standings' own first row) from `celebration`'s
 * candidates rather than let it fall through to the seat that went out first.
 */
export function isDrawnHand(
  players: readonly { id: string; team?: string }[],
  handScores: Record<string, number>
): boolean {
  const teamOfKey: Record<string, string> = {};
  for (const p of players) {
    if (p.team !== undefined) teamOfKey[p.id] = p.team;
  }
  const totals = aggregateTeamScores(handScores, teamOfKey);
  const values = Object.values(totals);
  return values.length > 1 && values.every((v) => v === values[0]);
}

/** One seat's line on the end-of-manche scoreboard, in every identity it is indexed by. */
export interface ScoreLine {
  seatIndex: number;
  /** The engine player id the rankings and the match winners are stated in. */
  engineId: string;
  userId: string | null;
  username: string;
  points: number;
  total: number;
}

/**
 * `game:over`, as the server states it and the client reads it.
 *
 * Declared once and with no optional field: both halves were writing their own
 * copy, and the client's had every field optional, which makes a server that
 * stops sending one indistinguishable from one that never did.
 */
export interface GameOverPayload {
  /** Finish order, as engine player ids. */
  rankings: string[];
  scores: ScoreLine[];
  matchTarget: number;
  matchLength: MatchLength;
  handsPlayed: number;
  matchOver: boolean;
  matchWinnerIds: string[];
  matchContinues: boolean;
  isDraw: boolean;
  /**
   * By user id, and empty for a hand that earns no rating. The server reads
   * this before it writes the ladder, because the inputs stop existing once
   * that write lands (server/ratings.ts).
   */
  ratingDeltas: Record<string, number>;
  /**
   * Whether this hand wrote a `/api/stats/history` row — a bot-majority
   * table writes none. Wider than `ratingDeltas` being empty: a teams hand
   * is recorded and unrated.
   */
  recorded: boolean;
}
