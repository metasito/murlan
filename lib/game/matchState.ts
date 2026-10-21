// What a match has decided, in the one shape both modes report it in.
//
// Relative imports and no `react-native`: the server bundles this unresolved, and
// `node --test` loads it the same way — docs/agents/checks.md, "Node's TypeScript loader".
import { aggregateTeamScores } from "./gameEngine.ts";
import type { MatchLength, SeatSetup } from "./gameEngine.ts";

export interface MatchVerdict {
  length: MatchLength;
  /** Current point target. Escalates 21 → 31 → 41 → 51 on a tie at the target. */
  target: number;
  over: boolean;
  /** Engine player ids (`player_0`). Empty until the match ends. */
  winners: string[];
  isDraw: boolean;
}

export type PlayerSetupConfig = SeatSetup;

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
  rounds: RoundResult[];
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
  placementPoints: Record<string, number>
): boolean {
  const teamOfKey: Record<string, string> = {};
  for (const p of players) {
    if (p.team !== undefined) teamOfKey[p.id] = p.team;
  }
  // An absent or incomplete score set is not known yet, and "not known" must
  // never collapse into "drawn": with no entries at all, aggregateTeamScores
  // totals every team to zero and zero equals zero.
  if (Object.keys(teamOfKey).some((id) => !(id in placementPoints))) return false;
  const totals = aggregateTeamScores(placementPoints, teamOfKey);
  const values = Object.values(totals);
  return values.length > 1 && values.every((v) => v === values[0]);
}

export type RoundOutcome = "won" | "lost" | "neutral" | "draw" | "pending";

/**
 * What the round that just ended did to `viewerId` — the decision the
 * table's own win/lose sting reads (`components/useTableFeedback.ts`).
 * `placementPoints` is a parameter rather than recomputed here, so the round is
 * scored from the one value its caller already holds (the server's
 * `game:round_over` payload online, the played round's own `pointsAwarded` offline)
 * instead of a second call to `placementPoints` that happens to agree today.
 *
 * `"pending"` is an answer of its own, not a stand-in for `"draw"`: online, a
 * finished round's `finishingOrder` reach the client (`game:state`, `roundOver:
 * true`) before its scores do (the separate, unawaited `game:round_over`), and a
 * genuine draw is indistinguishable from "not scored yet" without them —
 * both leave every team's known total at zero. This is the caller's signal
 * to wait for the render the scores arrive on rather than decide without
 * them, the same way `isDrawnRound` itself refuses to call an incomplete
 * score set a draw. Free-for-all never returns it, so a caller that latches its
 * decision waits on `scoredOutcome` instead.
 */
export function roundOutcomeFor(
  players: readonly { id: string; team?: string }[],
  finishingOrder: readonly string[],
  placementPoints: Record<string, number>,
  viewerId: string | undefined,
  isTeamMode: boolean
): RoundOutcome {
  if (viewerId === undefined || finishingOrder.length === 0) return "neutral";
  if (isTeamMode && finishingOrder.some((id) => !(id in placementPoints))) return "pending";
  if (isTeamMode && isDrawnRound(players, placementPoints)) return "draw";
  if (celebratesViewer(players, [finishingOrder[0]], viewerId, isTeamMode)) return "won";
  if (celebratesViewer(players, [finishingOrder[finishingOrder.length - 1]], viewerId, isTeamMode)) {
    return "lost";
  }
  return "neutral";
}

/**
 * `outcome`, held at `"pending"` until every ranked id carries a score, in every mode. For a decision made
 * once and latched (the round's sting): online the scores arrive after `roundOver`, together with a
 * match's winners. `roundOutcomeFor` itself stays decided without scores in free-for-all, where a replay
 * has none to give.
 */
export function scoredOutcome(
  outcome: RoundOutcome,
  finishingOrder: readonly string[],
  placementPoints: Record<string, number>
): RoundOutcome {
  return finishingOrder.every((id) => id in placementPoints) ? outcome : "pending";
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
