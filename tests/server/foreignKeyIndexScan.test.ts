// tests/server/foreignKeyIndexScan.test.ts — deleting a referenced row looks up every column that
// references it, once per foreign key: one that leads no index is a sequential scan of its table
// inside the delete's transaction, which is how account deletion outgrew its statement timeout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { is, sql, SQL } from "drizzle-orm";
import { getTableConfig, pgTable, PgTable, varchar, index } from "drizzle-orm/pg-core";
import * as schema from "../../shared/schema.ts";

type TableConfig = ReturnType<typeof getTableConfig>;

function leadingColumns(cfg: TableConfig): Set<string> {
  const leads = new Set<string>();
  for (const col of cfg.columns) if (col.primary || col.isUnique) leads.add(col.name);
  for (const pk of cfg.primaryKeys) if (pk.columns[0]) leads.add(pk.columns[0].name);
  for (const idx of cfg.indexes) {
    const first = idx.config.columns[0];
    if (first && !is(first, SQL)) leads.add((first as { name: string }).name);
  }
  return leads;
}

/** `table.column` for every foreign-key column that leads no index and no primary key. */
function unindexedForeignKeys(tables: PgTable[]): string[] {
  const configs = tables.map((t) => getTableConfig(t));
  const keys = configs.flatMap((cfg) => cfg.foreignKeys.map((fk) => ({ cfg, column: fk.reference().columns[0]!.name })));
  if (keys.length === 0) throw new Error("no foreign key was read: the scan inspected nothing");
  return keys.filter(({ cfg, column }) => !leadingColumns(cfg).has(column)).map(({ cfg, column }) => `${cfg.name}.${column}`);
}

const declared = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];

test("every foreign-key column in shared/schema.ts leads an index or a primary key", () => {
  assert.ok(declared.length > 10, `${declared.length} tables read`);
  assert.deepEqual(unindexedForeignKeys(declared), []);
});

test("the scan names a planted unindexed foreign key, and refuses to read nothing", () => {
  const planted = pgTable("planted", {
    userId: varchar("user_id").references(() => schema.users.id),
    roomId: varchar("room_id").references(() => schema.rooms.id),
  }, (t) => [index("planted_room_lower_idx").on(sql`lower(${t.roomId})`), index("planted_pair_idx").on(t.userId, t.roomId)]);
  assert.deepEqual(unindexedForeignKeys([...declared, planted]), ["planted.room_id"]);
  assert.throws(() => unindexedForeignKeys([]), /inspected nothing/);
  assert.throws(() => unindexedForeignKeys([schema.activeGames]), /inspected nothing/);
});
