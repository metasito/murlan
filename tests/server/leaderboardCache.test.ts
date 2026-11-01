import { test } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { leaderboardMemo } from "../../server/game/ratings.ts";
import { installClock } from "../../server/http/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import type { LeaderboardEntryDto } from "../../shared/http.ts";

const MID_MAY = Date.UTC(2026, 4, 15, 12);

function counted(t: TestContext, failFirst = false) {
  const clock = fakeClock(MID_MAY);
  t.after(installClock(clock));
  const loads: string[] = [];
  const memo = leaderboardMemo(async (asOf: Date): Promise<LeaderboardEntryDto[]> => {
    loads.push(asOf.toISOString());
    if (failFirst && loads.length === 1) throw new Error("pool exhausted");
    return [{ rank: 1, userId: `u${loads.length}`, username: "ana", rating: 1600, rounds: 30 }];
  });
  const ask = () => memo(new Date(clock.now()));
  return { clock, loads, memo, ask };
}

test("two reads inside 30 s run one query; one 31 s later runs another", async (t) => {
  const { clock, loads, ask } = counted(t);
  const first = await ask();
  clock.advance(29_000);
  assert.deepEqual(await ask(), first);
  assert.equal(loads.length, 1);
  clock.advance(2_000);
  const fresh = await ask();
  assert.equal(loads.length, 2);
  assert.notDeepEqual(fresh, first);
});

test("concurrent misses share one query", async (t) => {
  const { loads, ask } = counted(t);
  const [a, b] = await Promise.all([ask(), ask()]);
  assert.equal(loads.length, 1);
  assert.deepEqual(a, b);
});

test("a new month is a new season's entry, never the last month's ladder", async (t) => {
  const { loads, memo } = counted(t);
  await memo(new Date(MID_MAY));
  await memo(new Date(Date.UTC(2026, 5, 1, 0, 0, 1)));
  assert.equal(loads.length, 2);
});

test("a failed query is not cached: the next read asks again", async (t) => {
  const { loads, ask } = counted(t, true);
  await assert.rejects(ask(), /pool exhausted/);
  const rows = await ask();
  assert.equal(loads.length, 2);
  assert.equal(rows[0]?.userId, "u2");
});
