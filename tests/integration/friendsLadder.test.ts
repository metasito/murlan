import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";
import { START_RATING, seasonKey } from "../../lib/game/rating.ts";

type Account = Awaited<ReturnType<typeof register>>;
type Row = { rank: number; userId: string; username: string; rating: number; games: number };

describe("the friends ladder ranks the viewer among accepted friends only", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;
  let viewer: Account;
  let asked: Account;
  let asker: Account;
  let pendingIn: Account;
  let pendingOut: Account;
  let stranger: Account;

  const call = (who: Account, method: string, path: string, body?: unknown) =>
    fetch(`${server.url}${path}`, {
      method,
      headers: { cookie: who.cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function befriend(from: Account, to: Account, accept: boolean): Promise<void> {
    const add = await call(from, "POST", "/api/friends/add", { username: to.user.username });
    assert.equal(add.status, 200, await add.text());
    if (!accept) return;
    const rows = (await (await call(to, "GET", "/api/friends/requests")).json()) as { id: string; username: string }[];
    const row = rows.find((r) => r.username === from.user.username);
    assert.ok(row, "the request never reached its recipient");
    assert.equal((await call(to, "POST", `/api/friends/accept/${row.id}`)).status, 200);
  }

  const rate = (who: Account, rating: number, games: number) =>
    dbPool.query("INSERT INTO user_ratings (user_id, season, rating, games) VALUES ($1, $2, $3, $4)", [
      who.user.id,
      seasonKey(new Date()),
      rating,
      games,
    ]);

  const friendsLadder = async (who: Account): Promise<Row[]> => {
    const res = await call(who, "GET", "/api/ratings/leaderboard?scope=friends");
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()) as Row[];
  };

  before(async () => {
    server = await startTestServer();
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    viewer = await register(server, "fl_viewer");
    asked = await register(server, "fl_asked");
    asker = await register(server, "fl_asker");
    pendingIn = await register(server, "fl_pending_in");
    pendingOut = await register(server, "fl_pending_out");
    stranger = await register(server, "fl_stranger");
  });
  after(async () => {
    await dbPool?.end();
    await server?.stop();
  });

  test("a viewer with no friends and no games still sees themself", async () => {
    const rows = await friendsLadder(viewer);
    assert.deepEqual(
      rows.map((r) => [r.rank, r.userId, r.rating, r.games]),
      [[1, viewer.user.id, START_RATING, 0]],
    );
  });

  test("accepted friends in either direction are ranked; pending and strangers are not", async () => {
    await befriend(viewer, asked, true);
    await befriend(asker, viewer, true);
    await befriend(pendingIn, viewer, false);
    await befriend(viewer, pendingOut, false);
    await rate(asked, START_RATING + 200, 12);
    await rate(stranger, START_RATING + 500, 30);
    await rate(pendingIn, START_RATING + 400, 30);

    const rows = await friendsLadder(viewer);
    const tied = [viewer, asker].sort((a, b) => (a.user.username < b.user.username ? -1 : 1));
    assert.deepEqual(
      rows.map((r) => [r.rank, r.userId]),
      [[1, asked.user.id], [2, tied[0].user.id], [3, tied[1].user.id]],
    );
    assert.deepEqual(await friendsLadder(viewer), rows, "a tie resolved differently on a second read");
  });

  test("the global ladder is unchanged by the parameter's absence", async () => {
    const res = await call(viewer, "GET", "/api/ratings/leaderboard");
    const rows = (await res.json()) as Row[];
    assert.ok(rows.some((r) => r.userId === stranger.user.id), "the global ladder lost a listed player");
    assert.ok(!rows.some((r) => r.userId === viewer.user.id), "the global ladder listed a provisional player");
  });
});
