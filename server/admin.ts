// The seven questions #103 established are worth answering, each a SELECT over
// rows the game already keeps for its own reasons.
//
// Nothing here records anything new. Every figure is aggregated at read time,
// so no per-user tracking is introduced and the store's privacy answers do not
// change.
//
// Every query is bounded — by an aggregate, a date window, or a LIMIT. This
// database has tables that grow with every match played, and a dashboard that
// gets slower the more the game is used is a dashboard that stops being opened.
import { sql } from "drizzle-orm";
import { db } from "./db.ts";
import { funnel, type FunnelStep } from "./events.ts";
import { recentClientErrorGroups, topFrame, type ClientErrorGroup } from "./clientErrors.ts";
import { recentBugReports } from "./bugReports.ts";
import { symbolicate } from "./sourceMaps.ts";

/** How far back the time series look. One screen, not an analytics product. */
export const WINDOW_DAYS = 30;
/** The longest list any panel will render. */
export const ROW_LIMIT = 30;

export interface DayCount {
  day: string;
  n: number;
}

export interface AdminSnapshot {
  generatedAt: string;
  signups: DayCount[];
  totalUsers: number;
  activeToday: number;
  activeThisWeek: number;
  retention: { cohort: string; joined: number; played: number }[];
  aroundNotPlaying: number;
  ratings: { bucket: string; n: number }[];
  provisionalPlayers: number;
  matchBalance: { playerCount: number; matches: number; averagePoints: number }[];
  placements: { placement: number; n: number }[];
  unfinished: { status: string; n: number }[];
  staleGames: number;
  crashesThisWeek: number;
  crashGroups: { message: string; count: number; lastSeen: string; location: string }[];
  bugReports: { at: string; who: string; description: string; where: string; build: string }[];
  funnel: FunnelStep[];
}

/** 1. Signups over time — users.created_at, one row per day in the window. */
async function signups(): Promise<DayCount[]> {
  const rows = await db.execute<{ day: string; n: number }>(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
           count(*)::int AS n
    FROM users
    WHERE created_at >= now() - make_interval(days => ${WINDOW_DAYS})
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT ${ROW_LIMIT}
  `);
  return rows.rows;
}

/** 2. Played today / this week — distinct players with a finished match. */
async function activePlayers(days: number): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT user_id)::int AS n
    FROM match_history
    WHERE finished_at >= now() - make_interval(days => ${days})
  `);
  return rows.rows[0]?.n ?? 0;
}

/**
 * 3. Retention cohorts — of the players who joined in a given week, how many
 * ever finished a match. Bounded to the recent weeks, not the whole history.
 */
async function retention(): Promise<{ cohort: string; joined: number; played: number }[]> {
  const rows = await db.execute<{ cohort: string; joined: number; played: number }>(sql`
    SELECT to_char(date_trunc('week', u.created_at), 'YYYY-MM-DD') AS cohort,
           count(*)::int AS joined,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM match_history m WHERE m.user_id = u.id
           ))::int AS played
    FROM users u
    WHERE u.created_at >= now() - make_interval(days => ${WINDOW_DAYS * 2})
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT ${ROW_LIMIT}
  `);
  return rows.rows;
}

/** 4. Around but not playing — seen this week, no finished match this week. */
async function aroundNotPlaying(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM users u
    WHERE u.last_seen >= now() - make_interval(days => 7)
      AND NOT EXISTS (
        SELECT 1 FROM match_history m
        WHERE m.user_id = u.id
          AND m.finished_at >= now() - make_interval(days => 7)
      )
  `);
  return rows.rows[0]?.n ?? 0;
}

/**
 * 5. Ladder health — the rating spread for the current season, in buckets.
 * `user_ratings_season_idx` on (season, rating) covers this.
 */
async function ratingSpread(): Promise<{ bucket: string; n: number }[]> {
  const rows = await db.execute<{ bucket: string; n: number }>(sql`
    SELECT (floor(rating / 100) * 100)::int || '–' || ((floor(rating / 100) * 100) + 99)::int AS bucket,
           count(*)::int AS n
    FROM user_ratings
    WHERE season = to_char(now(), 'YYYY-MM')
    GROUP BY floor(rating / 100)
    ORDER BY floor(rating / 100)
    LIMIT ${ROW_LIMIT}
  `);
  return rows.rows;
}

async function provisionalPlayers(provisionalGames: number): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM user_ratings
    WHERE season = to_char(now(), 'YYYY-MM') AND games < ${provisionalGames}
  `);
  return rows.rows[0]?.n ?? 0;
}

/** 6. Match balance — how tables of each size actually play out. */
async function matchBalance(): Promise<{ playerCount: number; matches: number; averagePoints: number }[]> {
  const rows = await db.execute<{ playerCount: number; matches: number; averagePoints: number }>(sql`
    SELECT player_count AS "playerCount",
           count(*)::int AS matches,
           round(avg(points)::numeric, 1)::float8 AS "averagePoints"
    FROM match_history
    WHERE finished_at >= now() - make_interval(days => ${WINDOW_DAYS})
    GROUP BY 1
    ORDER BY 1
    LIMIT ${ROW_LIMIT}
  `);
  return rows.rows;
}

async function placements(): Promise<{ placement: number; n: number }[]> {
  const rows = await db.execute<{ placement: number; n: number }>(sql`
    SELECT placement, count(*)::int AS n
    FROM match_history
    WHERE finished_at >= now() - make_interval(days => ${WINDOW_DAYS})
    GROUP BY 1
    ORDER BY 1
    LIMIT ${ROW_LIMIT}
  `);
  return rows.rows;
}

/** 7. Started but never finished — rooms by status, and games left mid-hand. */
async function unfinished(): Promise<{ status: string; n: number }[]> {
  const rows = await db.execute<{ status: string; n: number }>(sql`
    SELECT status::text AS status, count(*)::int AS n
    FROM rooms
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT ${ROW_LIMIT}
  `);
  return rows.rows;
}

async function staleGames(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM active_games
    WHERE updated_at < now() - make_interval(days => 1)
  `);
  return rows.rows[0]?.n ?? 0;
}

async function totalUsers(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM users`);
  return rows.rows[0]?.n ?? 0;
}

async function crashesThisWeek(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM client_errors
    WHERE occurred_at >= now() - make_interval(days => 7)
  `);
  return rows.rows[0]?.n ?? 0;
}

async function forDisplay(groups: ClientErrorGroup[]): Promise<AdminSnapshot["crashGroups"]> {
  return Promise.all(
    groups.map(async (g) => ({
      message: g.message,
      count: g.count,
      // db.execute() is untyped raw SQL — node-postgres hands back a Date for
      // a timestamp column, but nothing here guarantees drizzle won't; going
      // through the constructor handles either.
      lastSeen: new Date(g.lastSeen).toISOString(),
      location: (await symbolicate(topFrame(g.stack ?? undefined))) ?? "—",
    }))
  );
}

/** Every panel on the page, gathered concurrently. */
export async function adminSnapshot(provisionalGames: number): Promise<AdminSnapshot> {
  const [
    signupRows,
    users,
    today,
    week,
    retentionRows,
    idle,
    ratingRows,
    provisional,
    balance,
    placementRows,
    unfinishedRows,
    stale,
    crashes,
    crashGroupRows,
    funnelRows,
    bugReportRows,
  ] = await Promise.all([
    signups(),
    totalUsers(),
    activePlayers(1),
    activePlayers(7),
    retention(),
    aroundNotPlaying(),
    ratingSpread(),
    provisionalPlayers(provisionalGames),
    matchBalance(),
    placements(),
    unfinished(),
    staleGames(),
    crashesThisWeek(),
    recentClientErrorGroups(ROW_LIMIT),
    funnel(WINDOW_DAYS),
    recentBugReports(ROW_LIMIT),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    signups: signupRows,
    totalUsers: users,
    activeToday: today,
    activeThisWeek: week,
    retention: retentionRows,
    aroundNotPlaying: idle,
    ratings: ratingRows,
    provisionalPlayers: provisional,
    matchBalance: balance,
    placements: placementRows,
    unfinished: unfinishedRows,
    staleGames: stale,
    crashesThisWeek: crashes,
    crashGroups: await forDisplay(crashGroupRows),
    funnel: funnelRows,
    bugReports: bugReportRows.map((r) => ({
      at: r.createdAt.toISOString(),
      who: r.username ?? "(deleted)",
      description: r.description,
      where: r.screen ?? "",
      build: [r.appVersion, r.platform, r.locale].filter(Boolean).join(" · "),
    })),
  };
}
