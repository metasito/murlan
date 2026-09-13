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

/**
 * The one statement shape allowed to delete: the dedupe that clears the way
 * for a unique index added over live rows, without which `CREATE UNIQUE INDEX`
 * fails and the server does not start.
 *
 * The exemption is earned, not declared, and what earns it is the
 * correspondence — the delete must carry the *same* key and the same filter as
 * the index standing immediately behind it, which is what makes it delete only
 * what that index rejects and nothing on a second run. A delete that groups by
 * anything else is judged by the guards below like any other.
 */
function dedupeTableFor(list: string[], index: number): string | undefined {
  const statement = list[index] ?? "";
  if (!/^DELETE FROM /.test(statement)) return undefined;
  const guarded =
    /^CREATE UNIQUE INDEX IF NOT EXISTS "[^"]+" ON ("[^"]+")(?: USING "[^"]+")? \((.*)\)(?: WHERE (.*))?;$/.exec(
      list[index + 1] ?? ""
    );
  if (!guarded) return undefined;
  const [, table, key, predicate] = guarded;
  if (!statement.startsWith(`DELETE FROM ${table} `)) return undefined;
  if (!statement.includes(`PARTITION BY ${key} `)) return undefined;
  if (predicate && !statement.includes(predicate)) return undefined;
  return table;
}

test("a delete that does not group by its index's key is not exempt", () => {
  const index = `CREATE UNIQUE INDEX IF NOT EXISTS "friends_accepted_uq" ON "friends" ("user_id", "friend_user_id") WHERE "status" = 'accepted';`;
  const decoy = `DELETE FROM "friends" WHERE "ctid" IN (SELECT "ctid" FROM (SELECT "ctid", row_number() OVER (PARTITION BY "id" ORDER BY "ctid") AS "dup" FROM "friends" WHERE "id" IS NOT NULL) AS "d" WHERE "d"."dup" > 1);`;
  assert.equal(dedupeTableFor([decoy, index], 0), undefined);
});

test("every statement is idempotent", () => {
  for (const [i, statement] of statements.entries()) {
    const idempotent =
      /IF NOT EXISTS/i.test(statement) ||
      // CREATE TYPE has no IF NOT EXISTS, so enums are created inside a block
      // that swallows only duplicate_object.
      /EXCEPTION WHEN duplicate_object/i.test(statement) ||
      // A dedupe's second run finds nothing, because the index it precedes
      // forbids exactly what it deletes.
      dedupeTableFor(statements, i) !== undefined;
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
  for (const [i, statement] of statements.entries()) {
    const dedupe = dedupeTableFor(statements, i);
    for (const pattern of forbidden) {
      if (dedupe && pattern.source.includes("DELETE")) continue;
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
  // (server/replays.ts, server/deleteAccount.ts). Containment is not a btree
  // predicate, so the access method has to survive into the DDL — an index
  // created under the same name as a btree would be dead weight the planner
  // never touches.
  const statement = statements.find((s) => /match_replays_player_ids_idx/.test(s));
  assert.ok(statement, "no index on match_replays.player_ids");
  assert.match(statement, /USING "gin" \("player_ids"\)/);
});

test("the email uniqueness index is partial, not unconditional (#897)", () => {
  // An unverified email is a claim, not a possession — any number of
  // accounts may share one unverified, so the constraint has to name the
  // condition rather than the bare column, or two such accounts could never
  // both be created.
  const create = statements.find((s) => /users_email_verified_lower_uq/.test(s));
  assert.ok(create, "no users_email_verified_lower_uq statement");
  assert.match(create, /ON "users" \(\(lower\("email"\)\)\)/);
  assert.match(create, /WHERE "email_verified_at" is not null;$/);

  // The index this one replaces must never come back unconditional — that
  // silently drops the "unverified accounts may share an address" property
  // this partial index exists to grant.
  assert.ok(
    !statements.some((s) => /users_email_lower_uq/.test(s)),
    "the old unconditional email index must not be re-declared in shared/schema.ts " +
      "(dropping it from a database that already has it is docs/DEPLOY-RUNBOOK.md's job, not this module's)"
  );
});

test("getUserByEmail's unconditional lookup has an index it can use (#894 review, finding 5)", () => {
  // Once docs/DEPLOY-RUNBOOK.md's step drops the old unconditional unique
  // index, the only other lower(email) index is the partial, verified-only
  // one above — which Postgres cannot use for a predicate that does not
  // imply "verified". getUserByEmail's `lower(email) = lower($1)` needs its
  // own, non-unique index.
  const create = statements.find((s) => /"users_email_lower_idx"/.test(s));
  assert.ok(create, "no users_email_lower_idx statement");
  assert.match(create, /^CREATE INDEX/);
  assert.match(create, /ON "users" \(\(lower\("email"\)\)\)/);
});

test("events and auth_tokens have an index the retention sweep can use", () => {
  // Both predicates (events.occurredAt, auth_tokens.expiresAt) had no index
  // before #895 — server/retention.ts's scheduled DELETE would otherwise be
  // the same full-table seq scan the write-path prune was.
  assert.ok(
    statements.some((s) => /"events_occurred_idx"/.test(s) && /ON "events" \("occurred_at"\)/.test(s)),
    "events.occurred_at needs an index for the retention sweep"
  );
  assert.ok(
    statements.some(
      (s) => /"auth_tokens_expires_idx"/.test(s) && /ON "auth_tokens" \("expires_at"\)/.test(s)
    ),
    "auth_tokens.expires_at needs an index for the retention sweep"
  );
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

test("the friends uniqueness indexes forbid every duplicate add/accept can race into (#959)", () => {
  const accepted = statements.findIndex((s) => /friends_accepted_uq/.test(s));
  assert.ok(accepted >= 0, "no friends_accepted_uq statement");
  // Deliberately *not* symmetric: an accepted friendship is stored as one row
  // per direction, so both directions of a pair have to be able to exist.
  assert.match(statements[accepted], /ON "friends" \("user_id", "friend_user_id"\)/);
  assert.match(statements[accepted], /WHERE "status" = 'accepted';$/);

  const pending = statements.findIndex((s) => /friends_pending_pair_uq/.test(s));
  assert.ok(pending >= 0, "no friends_pending_pair_uq statement");
  // Symmetric, so a repeated request and a crossed pair are the same row to it:
  // A→B and B→A cannot both be pending.
  assert.match(
    statements[pending],
    /\(\(least\("user_id", "friend_user_id"\)\), \(greatest\("user_id", "friend_user_id"\)\)\)/
  );
  assert.match(statements[pending], /WHERE "status" = 'pending';$/);

  // Each is added over a table that may already hold what it forbids, and a
  // failed CREATE UNIQUE INDEX at boot is a server that does not start.
  for (const at of [accepted, pending]) {
    assert.equal(
      dedupeTableFor(statements, at - 1),
      '"friends"',
      `${statements[at]}\nis not preceded by a dedupe that lets it succeed against live rows`
    );
  }
});
