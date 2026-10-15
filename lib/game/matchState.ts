// What a match has decided, in the one shape both modes report it in.
//
// Relative imports and no `react-native`: the server bundles this unresolved, and
// `node --test` loads it the same way — docs/agents/checks.md, "Node's TypeScript loader".
import { aggregateTeamScores } from "./gameEngine.ts";
import type { MatchLength, PlayerType } from "./gameEngine.ts";
import type { BotPersonalityId } from "./botPersonalities.ts";

export interface MatchVerdict {
  length: MatchLength;
  /** Current point target. Escalates 21 → 31 → 41 → 51 on a tie at the target. */
  target: number;
  over: boolean;
  /** Engine player ids (`player_0`). Empty until the match ends. */
  winners: string[];
  isDraw: boolean;
}

export interface PlayerSetupConfig {
  name: string;
  type: PlayerType;
  personality?: BotPersonalityId;
  team?: "A" | "B";
}

/** One played-out round, keyed by engine player id (`player_0`). */
export interface RoundResult {
  finishingOrder: string[];
  pointsAwarded: Record<string, number>;
}

/**
 * The offline match the rounds belong to, folded forward by the same
 * `lib/game/gameEngine` function as the server's, so the two modes cannot drift apart.
 */
export interface MatchState extends MatchVerdict {
  /** Engine player id -> cumulative match points. */
  scores: Record<string, number>;
  hands: RoundResult[];
}

/**
 * Whether `viewerId` is the first seat named by `candidates` (or, in team
 * mode, its teammate). `candidates` is ordered best-first, and one naming no
 * seat is passed over: a client that rejoins a finished table never receives
 * `game:round_over`, and a winner id can outlive the seat it named. False for a
 * viewer holding no seat.
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
 * Whether a just-played round paid every team the same total (GAME-RULES.md §11):
 * first-and-fourth pays 3+0, second-and-third pays 2+1, both 3.
 */
export function isDrawnRound(
  players: readonly { id: string; team?: string }[],
  roundScores: Record<string, number>
): boolean {
  const teamOfKey: Record<string, string> = {};
  for (const p of players) {
    if (p.team !== undefined) teamOfKey[p.id] = p.team;
  }
  // An absent or incomplete score set is not known yet, and "not known" must
  // never collapse into "drawn": with no entries at all, aggregateTeamScores
  // totals every team to zero and zero equals zero.
  if (Object.keys(teamOfKey).some((id) => !(id in roundScores))) return false;
  const totals = aggregateTeamScores(roundScores, teamOfKey);
  const values = Object.values(totals);
  return values.length > 1 && values.every((v) => v === values[0]);
}

export type RoundOutcome = "won" | "lost" | "neutral" | "draw" | "pending";

/**
 * What the round that just ended did to `viewerId` — the decision the
 * table's own win/lose sting reads (`components/useTableFeedback.ts`).
 * `roundScores` is a parameter rather than recomputed here, so the round is
 * scored from the one value its caller already holds (the server's
 * `game:round_over` payload online, the played hand's own `pointsAwarded` offline)
 * instead of a second call to `scoreRound` that happens to agree today.
 *
 * `"pending"` is an answer of its own, not a stand-in for `"draw"`: online, a
 * finished hand's `finishingOrder` reach the client (`game:state`, `roundOver:
 * true`) before its scores do (the separate, unawaited `game:round_over`), and a
 * genuine draw is indistinguishable from "not scored yet" without them —
 * both leave every team's known total at zero. This is the caller's signal
 * to wait for the render the scores arrive on rather than decide without
 * them, the same way `isDrawnRound` itself refuses to call an incomplete
 * score set a draw.
 */
export function roundOutcomeFor(
  players: readonly { id: string; team?: string }[],
  finishingOrder: readonly string[],
  roundScores: Record<string, number>,
  viewerId: string | undefined,
  isTeamMode: boolean
): RoundOutcome {
  if (viewerId === undefined || finishingOrder.length === 0) return "neutral";
  if (isTeamMode && finishingOrder.some((id) => !(id in roundScores))) return "pending";
  if (isTeamMode && isDrawnRound(players, roundScores)) return "draw";
  if (celebratesViewer(players, [finishingOrder[0]], viewerId, isTeamMode)) return "won";
  if (celebratesViewer(players, [finishingOrder[finishingOrder.length - 1]], viewerId, isTeamMode)) {
    return "lost";
  }
  return "neutral";
}

/**
 * What a finished match did to `viewerId`: `"pending"` until its winners are known, `"neutral"` for a spectator,
 * `"draw"` for a co-winner of a match tied at the last target (GAME-RULES.md §12, tie escalation).
 */
export function matchOutcomeFor(
  players: readonly { id: string; team?: string }[],
  matchWinners: readonly string[],
  viewerId: string | undefined,
  isTeamMode: boolean
): RoundOutcome {
  if (matchWinners.length === 0) return "pending";
  if (viewerId === undefined) return "neutral";
  const celebrated = matchWinners.map((id) => celebratesViewer(players, [id], viewerId, isTeamMode));
  if (!celebrated.includes(true)) return "lost";
  return celebrated.includes(false) ? "draw" : "won";
}

/** One seat's line on the end-of-round scoreboard, in every identity it is indexed by. */
export interface ScoreLine {
  seatIndex: number;
  /** The engine player id the finishingOrder and the match winners are stated in. */
  engineId: string;
  userId: string | null;
  username: string;
  points: number;
  total: number;
  /**
   * The seat is a human's that left, played on by the engine. `username` is
   * still the person's real name — the client renders the departed label
   * itself, through `t()`, rather than reading it off the wire as text.
   */
  vacated: boolean;
}

export interface RatingAfter {
  rating: number;
  rounds: number;
}

/**
 * `game:round_over`, as the server states it and the client reads it.
 *
 * Declared once and with no optional field: both halves were writing their own
 * copy, and the client's had every field optional, which makes a server that
 * stops sending one indistinguishable from one that never did.
 */
export interface RoundOverPayload {
  /** Finish order, as engine player ids. */
  finishingOrder: string[];
  scores: ScoreLine[];
  matchTarget: number;
  matchLength: MatchLength;
  roundsPlayed: number;
  matchOver: boolean;
  matchWinnerIds: string[];
  matchContinues: boolean;
  isDraw: boolean;
  /**
   * By user id, and empty for a hand that earns no rating. The server reads
   * this before it writes the ladder, because the inputs stop existing once
   * that write lands (server/game/ratings.ts).
   */
  ratingDeltas: Record<string, number>;
  /**
   * Each rated seat's standing once this hand is written, keyed as
   * `ratingDeltas`. Sent rather than fetched: the ladder write lands after
   * `game:round_over`, so `/api/ratings/me` read on it can still be the old rating.
   */
  ratingsAfter: Record<string, RatingAfter>;
  /**
   * Whether this hand wrote a `/api/stats/history` row — a bot-majority
   * table writes none. Wider than `ratingDeltas` being empty: a teams hand
   * is recorded and unrated.
   */
  recorded: boolean;
  /**
   * The match ended before its first point, on an abandonment
   * (docs/GAME-RULES.md § Decisions) — nothing earned, nothing taken, rated for nobody.
   * `finishingOrder` and `scores` are empty and `recorded` is false alongside it;
   * false for every other hand, voided or not.
   */
  voided: boolean;
}
