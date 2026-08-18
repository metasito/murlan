// tests/schemaDdl.test.ts — the boot-time schema DDL must stay additive.
//
// `ensureSchema()` runs on every server start, against databases that may
// already hold data. Its whole safety argument is that every statement it
// emits is idempotent and additive: a statement that could drop, retype or
// rename anything would silently destroy a live database on the next restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaStatements } from "../server/schemaDdl.ts";

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
