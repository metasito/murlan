// tests/schemaDdl.test.ts — the boot-time schema DDL must stay additive.
//
// `ensureSchema()` runs on every server start, against databases that may
// already hold data. Its whole safety argument is that every statement it
// emits is idempotent and additive: a statement that could drop, retype or
// rename anything would silently destroy a live database on the next restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { schemaStatements, assertRenamesApplied } from "../server/schemaDdl.ts";

const statements = schemaStatements();

test("every statement is idempotent", () => {
  for (const statement of statements) {
    const idempotent =
      /IF NOT EXISTS/i.test(statement) ||
      // CREATE TYPE has no IF NOT EXISTS, so enums are created inside a block
      // that swallows only duplicate_object.
      /EXCEPTION WHEN duplicate_object/i.test(statement);
    assert.ok(
      idempotent,
      `not idempotent, so a second boot would fail:\n${statement}`
    );
  }
});

test("no statement can destroy or rewrite existing data", () => {
  // `ON DELETE CASCADE` is a foreign key's behaviour, not a statement that
  // destroys anything, so these match the destructive verbs specifically.
  const forbidden = [
    /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|SCHEMA|DEFAULT|NOT\s+NULL)\b/i,
    /\bTRUNCATE\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bRENAME\b/i,
    /\bALTER\s+COLUMN\b/i,
  ];
  for (const statement of statements) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        statement,
        pattern,
        `ensureSchema() must never emit this — destructive changes stay \`drizzle-kit push\`'s job:\n${statement}`
      );
    }
  }
});

test("the session table is part of the bootstrap", () => {
  // The reported bug: nothing created it, so `drizzle-kit push` (which
  // excludes it) and connect-pg-simple (createTableIfMissing: false) both
  // left a fresh database unable to log anyone in.
  assert.ok(
    statements.some((s) => /CREATE TABLE IF NOT EXISTS "session"/i.test(s)),
    "the session table must be created at boot"
  );
  assert.ok(
    statements.some((s) => /IDX_session_expire/i.test(s)),
    "connect-pg-simple's expiry index must be created at boot"
  );
});

test("the socket adapter's spill table is part of the bootstrap", () => {
  // `@socket.io/postgres-adapter` will happily issue its own CREATE TABLE. It
  // must not: a second creator is how a table comes to exist on one database
  // and nowhere else, and the failure that follows is a silently undelivered
  // broadcast rather than an error.
  const create = statements.find((s) =>
    /CREATE TABLE IF NOT EXISTS "socket_io_attachments"/i.test(s)
  );
  assert.ok(create, "the adapter's attachment table must be created at boot");
  // The adapter reads and writes exactly these.
  assert.match(create, /"payload" bytea/i);
  assert.match(create, /"created_at" timestamp with time zone/i);
  assert.ok(
    statements.some((s) => /socket_io_attachments_created_at_idx/.test(s)),
    "the adapter deletes by created_at on a timer from every instance, so that " +
      "column needs an index"
  );
});

test("a serial column carries no separate default", () => {
  // A serial type *is* its own default. Drizzle reports `hasDefault` for one
  // with nothing to render, which is the same shape as a `$defaultFn` that
  // cannot become DDL — emitting `DEFAULT undefined` or throwing are both
  // wrong, and the throw is what a new bigserial column hit.
  const create = statements.find((s) =>
    /CREATE TABLE IF NOT EXISTS "socket_io_attachments"/i.test(s)
  );
  assert.ok(create);
  const idLine = create.split("\n").find((l) => l.includes('"id"'));
  assert.ok(idLine, "the table must declare an id column");
  assert.match(idLine, /bigserial/i);
  assert.doesNotMatch(idLine, /DEFAULT/i);
});

test("columns are added before the indexes that may target them", () => {
  const lastAddColumn = statements.findLastIndex((s) => /ADD COLUMN/i.test(s));
  const firstIndex = statements.findIndex((s) => /CREATE (UNIQUE )?INDEX/i.test(s));
  assert.ok(lastAddColumn >= 0, "expected ADD COLUMN statements");
  assert.ok(firstIndex >= 0, "expected CREATE INDEX statements");
  assert.ok(
    lastAddColumn < firstIndex,
    "an index on a newly added column would fail if the index ran first"
  );
});

test("the replay ownership predicate has an index it can use", () => {
  // Both readers of match_replays filter on `player_ids @> '["<uid>"]'`
  // (server/replays.ts, server/storage.ts). Containment is not a btree
  // predicate, so the access method has to survive into the DDL — an index
  // created under the same name as a btree would be dead weight the planner
  // never touches.
  const statement = statements.find((s) => /match_replays_player_ids_idx/.test(s));
  assert.ok(statement, "no index on match_replays.player_ids");
  assert.match(statement, /USING "gin" \("player_ids"\)/);
});

test("a table is created before anything references it", () => {
  const createdAt = new Map<string, number>();
  statements.forEach((s, i) => {
    const m = /CREATE TABLE IF NOT EXISTS "([^"]+)"/i.exec(s);
    if (m) createdAt.set(m[1], i);
  });
  statements.forEach((s, i) => {
    for (const m of s.matchAll(/REFERENCES "([^"]+)"/gi)) {
      const target = m[1];
      const created = createdAt.get(target);
      assert.ok(created !== undefined, `unknown REFERENCES target "${target}"`);
      assert.ok(
        created <= i,
        `"${target}" is referenced at statement ${i} but created at ${created}`
      );
    }
  });
});

// The other half of "additive only": the changes it refuses to make still have
// to happen, and the database it cannot make them to must not be served.
test("boot refuses a database still holding a renamed column", async () => {
  const asked: { sql: string; params: unknown }[] = [];
  const legacy = {
    query: async (sql: string, params: unknown) => {
      asked.push({ sql, params });
      return { rows: [{ "?column?": 1 }] };
    },
  } as unknown as Pick<Pool, "query">;
  await assert.rejects(assertRenamesApplied(legacy), (err: Error) => {
    assert.match(err.message, /room_code/);
    assert.match(err.message, /room_id/);
    assert.match(err.message, /db:push/, "the message has to name the fix");
    return true;
  });

  assert.deepEqual(
    asked.map((q) => q.params),
    [["active_games", "room_code"]],
    "the guard stops at the first column it finds, and asks about a real rename"
  );
  assert.match(asked[0].sql, /information_schema\.columns/);
  assert.match(asked[0].sql, /table_name = \$1 AND column_name = \$2/);
});

test("every renamed column is asked about, not just the first", async () => {
  const asked: [string, string][] = [];
  const current = {
    query: async (_sql: string, params: [string, string]) => {
      asked.push(params);
      return { rows: [] };
    },
  } as unknown as Pick<Pool, "query">;
  await assertRenamesApplied(current);

  assert.deepEqual(asked, [
    ["active_games", "room_code"],
    ["match_replays", "room_code"],
  ]);
});

test("boot proceeds once the rename has been applied", async () => {
  const current = { query: async () => ({ rows: [] }) } as unknown as Pick<Pool, "query">;
  await assertRenamesApplied(current);
});
