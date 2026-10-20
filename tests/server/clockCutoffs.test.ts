// A cutoff and the column it is compared with read one clock. A column the
// server writes is written from server/http/clock.ts and judged against it; a column
// Postgres stamps (defaultNow) is judged against Postgres' now().
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import { db } from "../../server/store/db.ts";
import { installClock } from "../../server/http/clock.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { adminSnapshot } from "../../server/http/admin.ts";
import { ABANDONED_GAME_MAX_AGE_MS, sweepRetention } from "../../server/game/retention.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { roundReplays, rooms } from "../../shared/schema.ts";
import { seasonKey } from "../../lib/game/rating.ts";
import { REPLAY_RETENTION_DAYS } from "../../lib/game/replay.ts";
import { skewedClock } from "../helpers/fakeClock.ts";

const DAY_MS = 24 * 60 * 60_000;

const dialect = new PgDialect();

function ahead(t: { after: (fn: () => void) => void }) {
  const clock = skewedClock();
  clock.skip(40 * DAY_MS);
  t.after(installClock(clock));
  return clock;
}

const near = (p: unknown, at: number, slackMs: number) =>
  Math.abs((p instanceof Date ? p.getTime() : Date.parse(String(p))) - at) <= slackMs;

/** Resolves every builder chain to no rows. */
function emptyChain(): unknown {
  const chain: unknown = new Proxy(() => {}, {
    get: (_t, key) => (key === "then" ? (ok: (rows: unknown[]) => void) => ok([]) : chain),
    apply: () => chain,
  });
  return chain;
}

describe("a cutoff reads the clock its column was written on", () => {
  test("a room is stamped from the installed clock, the clock its stale-room sweep reads", async (t) => {
    const clock = ahead(t);
    let values: Record<string, unknown> | undefined;
    const tx = {
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table === rooms) values = v;
          return { returning: async () => [{ id: "r", ...v }] };
        },
      }),
    };
    t.mock.method(db, "transaction", (run: (t: typeof tx) => unknown) => run(tx));
    await roomStore.createRoom("host", { gameMode: "teams", maxPlayers: 4 });
    assert.ok(values?.createdAt instanceof Date, "created_at is left to Postgres' defaultNow()");
    assert.ok(near(values.createdAt, clock.now(), 1_000));
  });

  test("the replay sweep judges server-written finished_at on the installed clock", async (t) => {
    const clock = ahead(t);
    const statements: SQL[] = [];
    t.mock.method(db, "execute", async (q: SQL) => {
      statements.push(q);
      return { rows: [], rowCount: 0 };
    });
    await sweepRetention();
    const replayTable = `"${getTableName(roundReplays)}"`;
    const prune = statements
      .map((q) => dialect.sqlToQuery(q))
      .find((q) => q.sql.startsWith(`DELETE FROM ${replayTable}`));
    assert.ok(prune, "the sweep no longer prunes round_replays");
    const { sql: text, params } = prune;
    assert.doesNotMatch(text, /now\(\)/i);
    assert.ok(params.some((p) => near(p, clock.now() - REPLAY_RETENTION_DAYS * DAY_MS, 1_000)));
  });

  test("the admin page judges server-written columns on the installed clock, Postgres-stamped ones on Postgres'", async (t) => {
    const clock = ahead(t);
    const seen: string[] = [];
    const paramsOf = new Map<string, unknown[]>();
    t.mock.method(db, "execute", async (q: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      seen.push(text);
      paramsOf.set(text, params);
      return { rows: [] };
    });
    t.mock.method(db, "select", () => emptyChain());
    const staleCutoffs: Date[] = [];
    t.mock.method(activeGameStore, "countUntouchedSince", async (cutoff: Date) => {
      staleCutoffs.push(cutoff);
      return 0;
    });
    await adminSnapshot(10);
    assert.equal(staleCutoffs.length, 1);
    assert.ok(near(staleCutoffs[0], clock.now() - ABANDONED_GAME_MAX_AGE_MS, 1_000), "active_games.updated_at is server-written");

    const SERVER_WRITTEN = /\b(finished_at|last_seen|season|updated_at)\b/;
    const judged = seen.filter((q) => SERVER_WRITTEN.test(q) && /WHERE/i.test(q));
    assert.ok(judged.length >= 5, `expected the server-written windows, saw ${judged.length}`);
    for (const q of judged) {
      assert.doesNotMatch(q, /now\(\)/i, `judged on Postgres' clock:\n${q}`);
      const expected = (p: unknown) =>
        /\bseason\b/.test(q) ? p === seasonKey(new Date(clock.now())) : near(p, clock.now(), 1_000);
      assert.ok(paramsOf.get(q)!.some(expected), `no server-clock time in:\n${q}`);
    }
    const signups = seen.find((q) => /FROM users\s+WHERE created_at/i.test(q));
    assert.match(signups ?? "", /now\(\)/i, "users.created_at is stamped by Postgres, so Postgres' now() judges it");
  });
});
