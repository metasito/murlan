import type { Express } from "express";
import { onSignedIn } from "../mount.ts";
import { now } from "../clock.ts";
import { getRoundHistoryView } from "../roundHistoryView.ts";
import { getUserAchievements, getUserStats } from "../../game/stats.ts";
import { getCircleLeaderboard, getLeaderboard, getRating } from "../../game/ratings.ts";
import { friendStore } from "../../store/friendStore.ts";

export function mountProfile(app: Express): void {
  onSignedIn(app, "GET /api/stats/me", async (_req, res, userId) => {
    const stats = await getUserStats(userId);
    res.json(stats);
  });

  onSignedIn(app, "GET /api/stats/history", async (_req, res, userId) => {
    const history = await getRoundHistoryView(userId);
    res.json(history);
  });

  onSignedIn(app, "GET /api/stats/achievements", async (_req, res, userId) => {
    const achievements = await getUserAchievements(userId);
    res.json(achievements);
  });

  // ── Ranked ladder ─────────────────────────────────────────────────────────
  //
  // The season is derived from the clock on every read, so a month boundary
  // needs no job to cross: `getRating` seeds the new season from the previous
  // one and only writes when a rated round actually finishes.
  onSignedIn(app, "GET /api/ratings/me", async (_req, res, userId) => {
    res.json(await getRating(userId, new Date(now())));
  });

  onSignedIn(app, "GET /api/ratings/leaderboard", async (_req, res) => {
    res.json(await getLeaderboard(new Date(now())));
  });

  onSignedIn(app, "GET /api/ratings/leaderboard/friends", async (_req, res, viewerId) => {
    const friends = await friendStore.getFriends(viewerId);
    res.json(await getCircleLeaderboard([viewerId, ...friends.map((f) => f.friendUserId)], new Date(now())));
  });
}
