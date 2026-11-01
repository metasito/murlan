// tests/integration/accountDeletion.test.ts — deleting an account costs the same at any table size:
// every lookup it makes, its own and its foreign keys' cascades, is served by an index, its
// replay erasure is a fixed number of statements, and the log purge runs after it commits.
import { test, before, after, describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";
import { saveReplay } from "../../server/game/replays.ts";
import { deleteUser } from "../../server/http/deleteAccount.ts";
import { db, pool } from "../../server/store/db.ts";
import type { ReplaySeat } from "../../lib/game/replay.ts";

type Statement = { client: pg.Client; text: string; values: unknown[] };

function recordStatements(t: TestContext): Statement[] {
  const seen: Statement[] = [];
  const original = pg.Client.prototype.query as (...args: unknown[]) => unknown;
  t.mock.method(pg.Client.prototype, "query", function (this: pg.Client, ...args: unknown[]) {
    const [q, v] = args as [string | { text?: string; values?: unknown[] }, unknown];
    const text = typeof q === "string" ? q : (q?.text ?? "");
    seen.push({ client: this, text, values: Array.isArray(v) ? v : typeof q === "string" ? [] : (q?.values ?? []) });
    return original.apply(this, args);
  });
  return seen;
}

/** What the delete's transaction sent, between its BEGIN and its COMMIT. */
function insideTransaction(seen: Statement[]): Statement[] {
  const begin = seen.findIndex((s) => s.text === "BEGIN");
  assert.ok(begin >= 0, "no transaction was recorded");
  const client = seen[begin]!.client;
  const commit = seen.findIndex((s, i) => i > begin && s.client === client && s.text === "COMMIT");
  assert.ok(commit > begin, "the transaction never committed");
  return seen.slice(begin + 1, commit).filter((s) => s.client === client);
}

function indexesUsed(plan: unknown): string[] {
  if (Array.isArray(plan)) return plan.flatMap(indexesUsed);
  if (!plan || typeof plan !== "object") return [];
  const node = plan as Record<string, unknown>;
  return [
    ...(typeof node["Index Name"] === "string" ? [node["Index Name"]] : []),
    ...Object.values(node).flatMap(indexesUsed),
  ];
}

async function until(what: string, check: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const seat = (seatIndex: number, userId: string | null, name: string, vacatedBy: string | null = null): ReplaySeat => ({
  seatIndex,
  userId,
  vacatedBy,
  name,
});

describe("account deletion at any size", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  async function replay(roomId: string, seats: ReplaySeat[]) {
    await saveReplay({ roomId, finishedAt: new Date(), gameMode: "free_for_all", seats, moves: [], opening: null, finishingOrder: [] });
  }

  test("every index the deletion and the admin page read exists", async () => {
    const rows = await server.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1`,
      [server.schema]
    );
    const def = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    const expected: [string, RegExp][] = [
      ["events_user_id_idx", /ON \S*events USING btree \(user_id\)$/],
      ["client_errors_user_id_idx", /ON \S*client_errors USING btree \(user_id\)$/],
      ["bug_reports_user_id_idx", /ON \S*bug_reports USING btree \(user_id\)$/],
      ["game_invites_inviter_id_idx", /ON \S*game_invites USING btree \(inviter_id\)$/],
      ["round_replays_seats_idx", /ON \S*round_replays USING gin \(seats\)$/],
      ["session_user_id_idx", /ON \S*session USING btree \(\(\(sess ->> 'userId'::text\)\)\)$/],
      ["round_history_finished_idx", /ON \S*round_history USING brin \(finished_at\)$/],
    ];
    assert.deepEqual(expected.filter(([name]) => !def.has(name)).map(([name]) => name), []);
    for (const [name, shape] of expected) assert.match(def.get(name)!, shape, name);
  });

  test("every lookup the deletion makes is planned on an index", async (t) => {
    const { user: leaver } = await register(server, "plan_leaver");
    const { user: stayer } = await register(server, "plan_stayer");
    await replay("plan-room", [seat(0, stayer.id, stayer.username), seat(1, null, leaver.username, leaver.id)]);

    const seen = recordStatements(t);
    await deleteUser(leaver.id);
    t.mock.restoreAll();

    const own = insideTransaction(seen).filter((s) => /\b(round_replays|session)\b/.test(s.text));
    const cascades: Statement[] = [
      ["events", "user_id"],
      ["client_errors", "user_id"],
      ["bug_reports", "user_id"],
      ["game_invites", "inviter_id"],
    ].map(([table, column]) => ({
      client: seen[0]!.client,
      // The statement Postgres' own ON DELETE CASCADE trigger runs (ri_triggers.c).
      text: `DELETE FROM ONLY "${table}" WHERE $1 OPERATOR(pg_catalog.=) "${column}"`,
      values: [leaver.id],
    }));
    assert.ok(own.some((s) => /round_replays/.test(s.text)) && own.some((s) => /\bsession\b/.test(s.text)), own.map((s) => s.text).join("\n"));

    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const expected = (text: string) =>
        /round_replays/.test(text) ? ["round_replays_player_ids_idx", "round_replays_seats_idx"]
        : /\bsession\b/.test(text) ? ["session_user_id_idx"]
        : [`${/"(\w+)"/.exec(text)![1]}_${/"(\w+)"$/.exec(text)![1]}_idx`];
      for (const s of [...own, ...cascades]) {
        const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${s.text}`, s.values);
        const used = indexesUsed(rows[0]);
        for (const name of expected(s.text)) assert.ok(used.includes(name), `${s.text}\nuses ${used.join(", ") || "no index"}, not ${name}`);
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  test("a player's replays are erased in two statements however many there are", async (t) => {
    const { user: leaver } = await register(server, "many_leaver");
    const { user: stayer } = await register(server, "many_stayer");
    for (let i = 0; i < 10; i++) {
      await replay(`alone-${i}`, [seat(0, leaver.id, leaver.username), seat(1, null, "Bot")]);
      await replay(`shared-${i}`, [seat(0, stayer.id, stayer.username), seat(1, leaver.id, leaver.username), seat(2, null, "Bot")]);
      await replay(`vacated-${i}`, [seat(0, stayer.id, stayer.username), seat(1, null, leaver.username, leaver.id)]);
    }
    await replay("untouched", [seat(0, stayer.id, stayer.username)]);

    const seen = recordStatements(t);
    await deleteUser(leaver.id);
    t.mock.restoreAll();

    const replayStatements = insideTransaction(seen).filter((s) => /round_replays/.test(s.text)).map((s) => s.text.trim().split(/\s/)[0]!.toUpperCase());
    assert.deepEqual(replayStatements.sort(), ["DELETE", "UPDATE"]);

    const rows = await server.query<{ room_id: string; player_ids: string[]; seats: ReplaySeat[] }>(
      `SELECT room_id, player_ids, seats FROM round_replays WHERE room_id ~ '^(alone|shared|vacated)-|^untouched$' ORDER BY room_id`
    );
    const byRoom = new Map(rows.map((r) => [r.room_id, r]));
    assert.equal(rows.filter((r) => r.room_id.startsWith("alone-")).length, 0, "a replay naming only the leaver survived");
    assert.equal(rows.length, 21);
    for (let i = 0; i < 10; i++) {
      assert.deepEqual(byRoom.get(`shared-${i}`), {
        room_id: `shared-${i}`,
        player_ids: [stayer.id],
        seats: [seat(0, stayer.id, stayer.username), seat(1, null, ""), seat(2, null, "Bot")],
      });
      assert.deepEqual(byRoom.get(`vacated-${i}`), {
        room_id: `vacated-${i}`,
        player_ids: [stayer.id],
        seats: [seat(0, stayer.id, stayer.username), seat(1, null, "")],
      });
    }
    assert.deepEqual(byRoom.get("untouched")!.seats, [seat(0, stayer.id, stayer.username)]);
  });

  test("the server_errors purge runs after the deletion commits, in batches", async (t) => {
    const { user } = await register(server, "purge_target");
    await server.query(
      `INSERT INTO server_errors (level, message, context) SELECT 50, 'm', jsonb_build_object('roomHost', $1::text) FROM generate_series(1, 3)`,
      [user.id]
    );
    await server.query(`INSERT INTO server_errors (level, message, context) VALUES (50, 'kept', '{"roomHost": "someone-else"}')`);
    const named = async () =>
      (await server.query<{ n: number }>(`SELECT count(*)::int AS n FROM server_errors WHERE context::text LIKE $1`, [`%${user.id}%`]))[0]!.n;
    assert.equal(await named(), 3);

    const seen = recordStatements(t);
    await deleteUser(user.id);
    assert.deepEqual(insideTransaction(seen).filter((s) => /server_errors/.test(s.text)).map((s) => s.text), []);

    await until("the purge", async () => (await named()) === 0);
    const purge = seen.filter((s) => /^DELETE FROM "server_errors" WHERE ctid IN \(SELECT ctid FROM "server_errors" WHERE .* LIMIT \$\d+\)$/s.test(s.text));
    assert.equal(purge.length, 1, seen.map((s) => s.text).join("\n"));
    assert.ok(seen.indexOf(purge[0]!) > seen.findIndex((s) => s.text === "COMMIT"));
    assert.equal((await server.query(`SELECT 1 FROM server_errors WHERE message = 'kept'`)).length, 1);
  });

  test("a purge that fails leaves the 200 and the committed deletion", async (t) => {
    const { user, cookie } = await register(server, "purge_fails");
    await server.query(`INSERT INTO server_errors (level, message, context) VALUES (50, 'm', jsonb_build_object('roomHost', $1::text))`, [user.id]);
    const dialect = new PgDialect();
    const execute = db().execute.bind(db());
    let refused = 0;
    t.mock.method(db(), "execute", (q: SQL) => {
      if (/server_errors/.test(dialect.sqlToQuery(q).sql)) {
        refused += 1;
        return Promise.reject(new Error("purge refused by the test"));
      }
      return execute(q);
    });

    const res = await fetch(`${server.url}/api/users/me`, { method: "DELETE", headers: { cookie } });
    assert.equal(res.status, 200, await res.text());
    assert.deepEqual(await server.query(`SELECT 1 FROM users WHERE id = $1`, [user.id]), []);
    await until("the purge to be attempted", async () => refused > 0);
    await until("the failure to be logged", async () =>
      (await server.query(`SELECT 1 FROM server_errors WHERE context::text LIKE '%purge refused by the test%'`)).length > 0
    );
  });
});
