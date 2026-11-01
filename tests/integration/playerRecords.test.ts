// tests/integration/playerRecords.test.ts — what a player reads back about themselves: rating,
// ladders, stats, achievements and a replay, each as the database holds it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { getRating, getLeaderboard, getCircleLeaderboard } from "../../server/game/ratings.ts";
import { recordGameResult, getUserStats, getUserAchievements } from "../../server/game/stats.ts";
import { saveReplay, getReplayForUser } from "../../server/game/replays.ts";
import { placementPoints } from "../../lib/game/gameEngine.ts";
import { PROVISIONAL_ROUNDS, START_RATING, seasonKey, seedRating } from "../../lib/game/rating.ts";
import type { GameResult } from "../../lib/achievements.ts";
import { now } from "../../server/http/clock.ts";

const SEASON_DAY = new Date("2031-05-15T12:00:00Z");
const SEASON = seasonKey(SEASON_DAY);
const PREVIOUS_SEASON = seasonKey(new Date("2031-04-15T12:00:00Z"));
const LADDER_DAY = new Date("2031-08-15T12:00:00Z");
const LADDER_SEASON = seasonKey(LADDER_DAY);

describe("player records read back", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let codes = 0;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  async function user(username: string): Promise<string> {
    const rows = await server.query<{ id: string }>(
      `INSERT INTO users (username, password, friend_code) VALUES ($1, 'x', $2) RETURNING id`,
      [username, `PR${String(++codes).padStart(4, "0")}`]
    );
    return rows[0]!.id;
  }

  async function rated(userId: string, season: string, rating: number, rounds: number) {
    await server.query(
      `INSERT INTO user_ratings (user_id, season, rating, rounds) VALUES ($1, $2, $3, $4)`,
      [userId, season, rating, rounds]
    );
  }

  const result = (userId: string, over: Partial<GameResult> = {}): GameResult => ({
    userId,
    placement: 2,
    playerCount: 4,
    playedBomb: false,
    playedJoker: false,
    matchWon: false,
    opponentsFinished: 1,
    ...over,
  });

  test("a rating reports its season, a seed for an unplayed season, and whether it is provisional", async () => {
    const fresh = await user("rating_fresh");
    const returning = await user("rating_returning");
    const settled = await user("rating_settled");
    await rated(returning, PREVIOUS_SEASON, 1400, 30);
    await rated(settled, SEASON, 1234, PROVISIONAL_ROUNDS);

    assert.deepEqual(await getRating(fresh, SEASON_DAY), {
      season: SEASON, rating: START_RATING, rounds: 0, provisional: true,
    });
    assert.deepEqual(await getRating(returning, SEASON_DAY), {
      season: SEASON, rating: seedRating(1400), rounds: 0, provisional: true,
    });
    assert.deepEqual(await getRating(settled, SEASON_DAY), {
      season: SEASON, rating: 1234, rounds: PROVISIONAL_ROUNDS, provisional: false,
    });
  });

  test("the public ladder ranks settled records of this season by rating and leaves provisional ones out", async () => {
    const second = await user("ladder_second");
    const first = await user("ladder_first");
    const provisional = await user("ladder_provisional");
    await rated(second, LADDER_SEASON, 1100, PROVISIONAL_ROUNDS + 3);
    await rated(first, LADDER_SEASON, 1300, PROVISIONAL_ROUNDS);
    await rated(provisional, LADDER_SEASON, 1500, PROVISIONAL_ROUNDS - 1);
    await rated(provisional, SEASON, 1600, PROVISIONAL_ROUNDS + 1);

    assert.deepEqual(
      await getLeaderboard(LADDER_DAY),
      [
        { userId: first, username: "ladder_first", rating: 1300, rounds: PROVISIONAL_ROUNDS, rank: 1 },
        { userId: second, username: "ladder_second", rating: 1100, rounds: PROVISIONAL_ROUNDS + 3, rank: 2 },
      ]
    );
  });

  test("a circle ladder lists every member once, by rating, a tie in name order", async () => {
    const low = await user("circ_low");
    const tieB = await user("circ_tie_b");
    const tieA = await user("circ_tie_a");
    const unplayed = await user("circ_unplayed");
    const high = await user("circ_high");
    const tieC = await user("circ_tie_c");
    const tieD = await user("circ_tie_d");
    await rated(low, SEASON, 900, 2);
    await rated(tieB, SEASON, 1100, 9);
    await rated(tieA, SEASON, 1100, 1);
    await rated(high, SEASON, 1300, 7);
    await rated(tieC, SEASON, 1200, 3);
    await rated(tieD, SEASON, 1200, 4);

    const ladder = await getCircleLeaderboard([low, tieB, tieA, unplayed, high, tieC, tieD, low], SEASON_DAY);

    assert.deepEqual(
      ladder.map(({ username, rating, rounds, rank }) => ({ username, rating, rounds, rank })),
      [
        { username: "circ_high", rating: 1300, rounds: 7, rank: 1 },
        { username: "circ_tie_c", rating: 1200, rounds: 3, rank: 2 },
        { username: "circ_tie_d", rating: 1200, rounds: 4, rank: 3 },
        { username: "circ_tie_a", rating: 1100, rounds: 1, rank: 4 },
        { username: "circ_tie_b", rating: 1100, rounds: 9, rank: 5 },
        { username: "circ_unplayed", rating: START_RATING, rounds: 0, rank: 6 },
        { username: "circ_low", rating: 900, rounds: 2, rank: 7 },
      ]
    );
    assert.equal(ladder[0]!.userId, high);
  });

  test("a round is stored with its points, its rating delta and whether it was abandoned", async () => {
    const delta = await user("history_delta");
    const unrated = await user("history_unrated");

    await recordGameResult(
      [result(delta), result(unrated, { placement: 3 }), result("bot:2", { placement: 1 })],
      "free_for_all",
      new Date(now()),
      new Map([[delta, 17]])
    );

    const rows = await server.query<{ user_id: string; points: number; rating_delta: number | null; abandoned: boolean }>(
      `SELECT user_id, points, rating_delta, abandoned FROM round_history WHERE user_id = ANY($1) ORDER BY points DESC`,
      [[delta, unrated]]
    );
    assert.deepEqual(
      rows.map((r) => ({ ...r, points: Number(r.points) })),
      [
        { user_id: delta, points: placementPoints(1, 4), rating_delta: 17, abandoned: false },
        { user_id: unrated, points: placementPoints(2, 4), rating_delta: null, abandoned: false },
      ]
    );
  });

  test("stats read back the player's own row, played today, and zeroes for a player who never finished", async () => {
    const played = await user("stats_played");
    const other = await user("stats_other");
    const never = await user("stats_never");
    await recordGameResult([result(other, { placement: 2 })], "free_for_all", new Date(now()));
    await recordGameResult([result(other, { placement: 2 })], "free_for_all", new Date(now()));
    await recordGameResult([result(played, { placement: 1 })], "free_for_all", new Date(now()));

    const mine = await getUserStats(played);
    assert.equal(mine.userId, played);
    assert.equal(mine.roundsPlayed, 1);
    assert.equal(mine.roundsWon, 1);
    assert.equal(mine.currentStreak, 1);
    assert.equal(mine.dailyStreak, 1);

    assert.deepEqual(await getUserStats(never), {
      userId: never,
      roundsPlayed: 0,
      roundsWon: 0,
      matchesWon: 0,
      currentStreak: 0,
      bestStreak: 0,
      bombsPlayed: 0,
      updatedAt: new Date(0),
      dailyStreak: 0,
    });
  });

  test("an unlocked achievement says when it was unlocked", async () => {
    const winner = await user("achiever");
    await recordGameResult([result(winner, { placement: 1 })], "free_for_all", new Date(now()));

    const firstWin = (await getUserAchievements(winner)).find((a) => a.id === "first_win")!;
    assert.equal(firstWin.unlocked, true);
    assert.match(firstWin.unlockedAt ?? "", /^\d{4}-\d\d-\d\dT/);
  });

  test("an all-bot table stores no replay", async () => {
    await saveReplay({
      roomId: "room-all-bots",
      finishedAt: new Date(now()),
      gameMode: "free_for_all",
      seats: [
        { seatIndex: 0, userId: null, vacatedBy: null, name: "Bot 1" },
        { seatIndex: 1, userId: null, vacatedBy: null, name: "Bot 2" },
      ],
      moves: [],
      opening: null,
      finishingOrder: [],
    });

    assert.deepEqual(await server.query("SELECT 1 FROM round_replays WHERE room_id = 'room-all-bots'"), []);
  });

  test("a replay read back names its seats as they are called now", async () => {
    const player = await user("replay_before");
    const finishedAt = new Date(now());
    await saveReplay({
      roomId: "room-replay-read",
      finishedAt,
      gameMode: "free_for_all",
      seats: [
        { seatIndex: 0, userId: player, vacatedBy: null, name: "replay_before" },
        { seatIndex: 1, userId: null, vacatedBy: null, name: "Bot 2" },
      ],
      moves: [{ seat: 1, combo: null, handCounts: [3, 4] }],
      opening: null,
      finishingOrder: ["player_0", "player_1"],
    });
    const [{ id }] = await server.query<{ id: string }>(
      "SELECT id FROM round_replays WHERE room_id = 'room-replay-read'"
    );
    await server.query("UPDATE users SET username = 'replay_after' WHERE id = $1", [player]);

    assert.deepEqual(await getReplayForUser(id, player), {
      id,
      finishedAt: finishedAt.toISOString(),
      gameMode: "free_for_all",
      seats: [
        { seatIndex: 0, userId: player, vacatedBy: null, name: "replay_after" },
        { seatIndex: 1, userId: null, vacatedBy: null, name: "Bot 2" },
      ],
      moves: [{ seat: 1, combo: null, handCounts: [3, 4] }],
      opening: null,
      finishingOrder: ["player_0", "player_1"],
    });
  });
});
