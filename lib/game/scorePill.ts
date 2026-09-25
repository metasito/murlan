// The score pill's standings (#1265): one row per seat, or per pair in teams mode.
//
// Free of runtime `@/` imports, so `node --test` can load it — docs/agents/checks.md,
// "Node's TypeScript loader".
import { aggregateTeamScores } from "./gameEngine.ts";
import { standings } from "./standings.ts";

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
}

export interface PillStandings {
  rows: PillRow[];
  mine: { total: number; place: number } | null;
}

export function scorePillStandings({
  players,
  teams,
  scores,
  handScores,
  rankings,
  viewerId,
}: {
  players: readonly { id: string; name: string; team?: string }[];
  teams: boolean;
  scores: Record<string, number>;
  handScores: Record<string, number>;
  rankings: readonly string[];
  viewerId: string | undefined;
}): PillStandings {
  const finishedAt = (id: string) => {
    const at = rankings.indexOf(id);
    return at === -1 ? rankings.length : at;
  };
  const viewerTeam = players.find((p) => p.id === viewerId)?.team;

  let entries: (Omit<PillRow, "place"> & { finishedAt: number })[];
  if (teams) {
    const teamOf = Object.fromEntries(players.map((p) => [p.id, p.team ?? ""]));
    const totals = aggregateTeamScores(scores, teamOf);
    const gains = aggregateTeamScores(handScores, teamOf);
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
      gain: handScores[p.id] ?? 0,
      mine: p.id === viewerId,
      finishedAt: finishedAt(p.id),
    }));
  }

  const rows = standings(entries.map((e) => ({ ...e, points: e.gain }))).map(
    ({ finishedAt: _f, points: _p, ...row }, _i, all): PillRow => ({
      ...row,
      place: 1 + all.filter((other) => other.total > row.total).length,
    })
  );
  const mine = rows.find((r) => r.mine);
  return { rows, mine: mine ? { total: mine.total, place: mine.place } : null };
}
