// The score pill's standings (#1265): one row per seat, or per team in teams mode.
//
// Free of runtime `@/` imports, so `node --test` can load it — docs/agents/checks.md,
// "Node's TypeScript loader".
import { aggregateTeamScores } from "./gameEngine.ts";
import { standings } from "./standings.ts";
import type { TranslationKey, TranslationParams } from "../../shared/i18n.ts";

export interface PillRow {
  /** Engine player id, or the team letter in teams mode. */
  key: string;
  name: string;
  initial: string;
  total: number;
  gain: number;
  /** Shared by rows level on points. */
  place: number;
  mine: boolean;
  /** The total before the round just played. */
  before: number;
  beforePlace: number;
  /** The row's index in the standings before the round, a tie kept in today's order. */
  beforePos: number;
  /** When its gain counts in: its place in the round's finishing order. */
  order: number;
}

export interface PillStandings {
  teams: boolean;
  rows: PillRow[];
  mine: { total: number; place: number } | null;
}

export function scorePillStandings({
  players,
  teams,
  scores,
  placementPoints,
  finishingOrder,
  viewerId,
}: {
  players: readonly { id: string; name: string; team?: string }[];
  teams: boolean;
  scores: Record<string, number>;
  placementPoints: Record<string, number>;
  finishingOrder: readonly string[];
  viewerId: string | undefined;
}): PillStandings {
  const finishedAt = (id: string) => {
    const at = finishingOrder.indexOf(id);
    return at === -1 ? finishingOrder.length : at;
  };
  const viewerTeam = players.find((p) => p.id === viewerId)?.team;

  let entries: (Omit<PillRow, "place" | "before" | "beforePlace" | "beforePos" | "order"> & { finishedAt: number })[];
  if (teams) {
    const teamOf = Object.fromEntries(players.map((p) => [p.id, p.team ?? ""]));
    const totals = aggregateTeamScores(scores, teamOf);
    const gains = aggregateTeamScores(placementPoints, teamOf);
    entries = Object.keys(totals).map((team) => ({
      key: team,
      name: team,
      initial: team,
      total: totals[team],
      gain: gains[team] ?? 0,
      mine: team === viewerTeam,
      finishedAt: Math.min(...players.filter((p) => p.team === team).map((p) => finishedAt(p.id))),
    }));
  } else {
    entries = players.map((p) => ({
      key: p.id,
      name: p.name,
      initial: p.name.slice(0, 1).toUpperCase(),
      total: scores[p.id] ?? 0,
      gain: placementPoints[p.id] ?? 0,
      mine: p.id === viewerId,
      finishedAt: finishedAt(p.id),
    }));
  }

  const ranked = standings(entries.map((e) => ({ ...e, points: e.gain, before: e.total - e.gain })));
  const beforeOrder = ranked.map((_, i) => i).sort((a, b) => ranked[b].before - ranked[a].before || a - b);
  const finishOrder = ranked.map((_, i) => i).sort((a, b) => ranked[a].finishedAt - ranked[b].finishedAt || a - b);
  const rows = ranked.map(
    ({ finishedAt: _f, points: _p, ...row }, i, all): PillRow => ({
      ...row,
      place: 1 + all.filter((other) => other.total > row.total).length,
      beforePlace: 1 + all.filter((other) => other.before > row.before).length,
      beforePos: beforeOrder.indexOf(i),
      order: finishOrder.indexOf(i),
    })
  );
  const mine = rows.find((r) => r.mine);
  return { teams, rows, mine: mine ? { total: mine.total, place: mine.place } : null };
}

/** What the pill shows once it becomes the match's board; the actions and the rating pass through untouched. */
export interface MatchBoard<Actions, Rating> {
  winnerKeys: string[];
  actions: Actions;
  winner: { name: string; mine: boolean; draw: boolean; line: string; rating?: Rating };
}

export function matchBoardFor<Actions, Rating>(i: {
  standings: PillStandings;
  players: readonly { id: string; team?: string }[];
  winners: readonly string[];
  score: { target: number; single?: boolean };
  actions: Actions;
  rating?: Rating;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}): MatchBoard<Actions, Rating> {
  const { standings: pill, t } = i;
  const teamOf: Record<string, string | undefined> = Object.fromEntries(i.players.map((p) => [p.id, p.team]));
  const winnerKeys = i.winners.map((id) => (pill.teams ? (teamOf[id] ?? id) : id));
  const won = pill.rows.filter((row) => winnerKeys.includes(row.key));
  const race = i.score.single ? t("result.singleRoundFormat") : t("scorePill.race", { target: i.score.target });
  return {
    winnerKeys,
    actions: i.actions,
    winner: {
      name: won.map((row) => (pill.teams ? t("lobby.team", { team: row.name }) : row.name)).join(" · "),
      mine: won.length === 1 && won[0].mine,
      draw: won.length > 1,
      line: won.length === 1 ? `${race} · ${won[0].total}` : race,
      rating: i.rating,
    },
  };
}
