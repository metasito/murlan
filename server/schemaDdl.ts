/**
 * Derives the database's DDL from `shared/schema.ts` and applies it at boot.
 *
 * Every statement is idempotent, so `ensureSchema()` runs on every start: a
 * fresh database gets the whole schema, an existing one gets only what it is
 * missing, and nothing is ever dropped, retyped or renamed. That is the whole
 * contract — a change that removes a column, narrows a type or renames
 * anything is still `drizzle-kit push`'s job, and this module will not do it.
 *
 * The `session` table is included here because nothing else can create it:
 * `drizzle.config.ts` excludes it from push, and `server/session.ts` runs
 * connect-pg-simple with `createTableIfMissing: false`.
 */
import type { Pool } from "pg";
import { is, SQL, StringChunk } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema.ts";
import { logger } from "./logger.ts";

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Renders a column's DEFAULT clause (or undefined if it has none). Handles
 * the two shapes `shared/schema.ts` actually uses: a raw SQL default (e.g.
 * `sql\`gen_random_uuid()\``, `.defaultNow()`) and a plain JS literal
 * (string/number/boolean/plain object|array, the last rendered as `jsonb`).
 * Throws on anything else (a client-side `$defaultFn`, a parameterized SQL
 * default) rather than silently emitting DDL that doesn't match the schema.
 */
function formatDefaultClause(
  col: { name: string; hasDefault: boolean; default: unknown },
  tableName: string
): string | undefined {
  if (!col.hasDefault) return undefined;
  if (col.default === undefined) {
    throw new Error(
      `schemaStatements: column "${tableName}.${col.name}" has a client-side ` +
        `default (e.g. $defaultFn) with no DB-side default, which can't be ` +
        `expressed as DDL — update schemaStatements() in server/schemaDdl.ts.`
    );
  }
  if (is(col.default, SQL)) {
    const chunks = (col.default as SQL).queryChunks;
    const text = chunks
      .map((chunk) => {
        if (!is(chunk, StringChunk)) {
          throw new Error(
            `schemaStatements: column "${tableName}.${col.name}" has a ` +
              `parameterized SQL default, which is not supported — update ` +
              `schemaStatements() in server/schemaDdl.ts.`
          );
        }
        return chunk.value.join("");
      })
      .join("");
    return `DEFAULT ${text}`;
  }
  const value = col.default;
  if (typeof value === "string") return `DEFAULT ${sqlStringLiteral(value)}`;
  if (typeof value === "boolean" || typeof value === "number") return `DEFAULT ${value}`;
  if (typeof value === "object" && value !== null) {
    return `DEFAULT ${sqlStringLiteral(JSON.stringify(value))}::jsonb`;
  }
  throw new Error(
    `schemaStatements: column "${tableName}.${col.name}" has a default of an ` +
      `unsupported type (${typeof value}) — update schemaStatements() in ` +
      `server/schemaDdl.ts.`
  );
}

type TableConfig = ReturnType<typeof getTableConfig>;
type ForeignKeyRef = { table: string; column: string; onDelete: string | undefined };

function foreignKeysByColumn(cfg: TableConfig): Map<string, ForeignKeyRef> {
  const map = new Map<string, ForeignKeyRef>();
  for (const fk of cfg.foreignKeys) {
    const ref = fk.reference();
    if (ref.columns.length !== 1) {
      throw new Error(
        `schemaStatements: table "${cfg.name}" has a composite foreign key, ` +
          `which is not supported — update schemaStatements() in server/schemaDdl.ts.`
      );
    }
    const foreignCfg = getTableConfig(ref.foreignTable);
    map.set(ref.columns[0].name, {
      table: foreignCfg.name,
      column: ref.foreignColumns[0].name,
      onDelete: fk.onDelete,
    });
  }
  return map;
}

/**
 * The column's definition as it appears in `CREATE TABLE`, and — with
 * `includePrimaryKey: false` — in `ADD COLUMN`. A column added to a table that
 * already exists is by definition not that table's primary key, so dropping
 * the clause there is exact rather than approximate.
 */
function columnDefinition(
  col: TableConfig["columns"][number],
  cfg: TableConfig,
  fkByColumn: Map<string, ForeignKeyRef>,
  includePrimaryKey: boolean
): string {
  const parts = [quoteIdent(col.name), col.getSQLType()];
  if (col.notNull) parts.push("NOT NULL");
  const defaultClause = formatDefaultClause(col, cfg.name);
  if (defaultClause) parts.push(defaultClause);
  if (col.primary && includePrimaryKey) parts.push("PRIMARY KEY");
  if (col.isUnique) parts.push("UNIQUE");
  const fk = fkByColumn.get(col.name);
  if (fk) {
    let clause = `REFERENCES ${quoteIdent(fk.table)}(${quoteIdent(fk.column)})`;
    if (fk.onDelete && fk.onDelete !== "no action") {
      clause += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
    }
    parts.push(clause);
  }
  return parts.join(" ");
}

function assertSupported(configs: { cfg: TableConfig }[]): void {
  for (const { cfg } of configs) {
    if (cfg.checks.length > 0) {
      throw new Error(
        `schemaStatements: table "${cfg.name}" has CHECK constraints, which ` +
          `are not supported — update schemaStatements() in server/schemaDdl.ts.`
      );
    }
    if (cfg.uniqueConstraints.length > 0) {
      throw new Error(
        `schemaStatements: table "${cfg.name}" has table-level unique ` +
          `constraints, which are not supported — update schemaStatements() ` +
          `in server/schemaDdl.ts.`
      );
    }
    if (cfg.policies.length > 0 || cfg.enableRLS) {
      throw new Error(
        `schemaStatements: table "${cfg.name}" uses row-level security, ` +
          `which is not supported — update schemaStatements() in server/schemaDdl.ts.`
      );
    }
    if (cfg.schema !== undefined) {
      throw new Error(
        `schemaStatements: table "${cfg.name}" declares a non-default ` +
          `Postgres schema, which is not supported — update schemaStatements() ` +
          `in server/schemaDdl.ts.`
      );
    }
  }
}

/** Enum types, deduped by Postgres type name, with their declared values. */
function collectEnums(configs: { cfg: TableConfig }[]): Map<string, readonly string[]> {
  const enums = new Map<string, readonly string[]>();
  for (const { cfg } of configs) {
    for (const col of cfg.columns) {
      if (col.columnType !== "PgEnumColumn") continue;
      const enumName = col.getSQLType();
      const values = col.enumValues;
      if (!values) {
        throw new Error(
          `schemaStatements: enum column "${cfg.name}.${col.name}" has no ` +
            `enumValues — update schemaStatements() in server/schemaDdl.ts.`
        );
      }
      const existing = enums.get(enumName);
      if (existing && (existing.length !== values.length || existing.some((v, i) => v !== values[i]))) {
        throw new Error(
          `schemaStatements: enum "${enumName}" has inconsistent values across ` +
            `its usages in shared/schema.ts.`
        );
      }
      enums.set(enumName, values);
    }
  }
  return enums;
}

/** Tables ordered so every REFERENCES target is created before it is referenced. */
function inDependencyOrder<T extends { cfg: TableConfig }>(configs: T[]): T[] {
  const byPgName = new Map(configs.map((c) => [c.cfg.name, c] as const));
  const sorted: T[] = [];
  const done = new Set<string>();

  function visit(entry: T, stack: Set<string>): void {
    if (done.has(entry.cfg.name)) return;
    if (stack.has(entry.cfg.name)) {
      throw new Error(
        `schemaStatements: circular foreign key dependency involving table ` +
          `"${entry.cfg.name}" — update schemaStatements() in server/schemaDdl.ts.`
      );
    }
    stack.add(entry.cfg.name);
    for (const fk of entry.cfg.foreignKeys) {
      const ref = fk.reference();
      const foreignCfg = getTableConfig(ref.foreignTable);
      const dep = byPgName.get(foreignCfg.name);
      if (dep && dep !== entry) visit(dep, stack);
    }
    stack.delete(entry.cfg.name);
    done.add(entry.cfg.name);
    sorted.push(entry);
  }
  for (const entry of configs) visit(entry, new Set());
  return sorted;
}

/**
 * connect-pg-simple's own table, matching the DDL it ships in `table.sql`.
 * This one is hand-written because there is no Drizzle schema to generate it
 * from: `shared/schema.ts` deliberately does not describe it, so drizzle-kit
 * never gains the right to drop or recreate it.
 */
const SESSION_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`,
];

/**
 * Every statement needed to bring an empty or partially-populated database up
 * to `shared/schema.ts`, in application order: enum types, then tables, then
 * columns added to tables that already existed, then indexes (which may target
 * one of those new columns), then the session table.
 *
 * Deliberately narrow: it understands exactly the schema features
 * `shared/schema.ts` currently uses (enums, varchar/text/integer/boolean/
 * jsonb/timestamp columns, single-column foreign keys with `onDelete`, simple +
 * composite primary keys, plain-column indexes/unique indexes in any access
 * method, `.unique()` columns) and throws a descriptive error for anything else
 * (check constraints,
 * RLS, non-default schemas, expression indexes, parameterized SQL defaults,
 * composite foreign keys) rather than silently emitting incomplete DDL.
 */
export function schemaStatements(): string[] {
  const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
  const configs = tables.map((table) => ({ cfg: getTableConfig(table as PgTable<any>) }));
  assertSupported(configs);

  const enumStatements: string[] = [];
  const enums = collectEnums(configs);
  for (const name of [...enums.keys()].sort()) {
    const values = enums.get(name)!;
    // Postgres has no CREATE TYPE IF NOT EXISTS.
    enumStatements.push(
      `DO $$ BEGIN\n` +
        `  CREATE TYPE ${quoteIdent(name)} AS ENUM (${values.map(sqlStringLiteral).join(", ")});\n` +
        `EXCEPTION WHEN duplicate_object THEN NULL;\n` +
        `END $$;`
    );
    for (const value of values) {
      enumStatements.push(
        `ALTER TYPE ${quoteIdent(name)} ADD VALUE IF NOT EXISTS ${sqlStringLiteral(value)};`
      );
    }
  }

  const tableStatements: string[] = [];
  const addColumnStatements: string[] = [];
  const indexStatements: string[] = [];

  for (const { cfg } of inDependencyOrder(configs)) {
    const fkByColumn = foreignKeysByColumn(cfg);
    const columnLines = cfg.columns.map(
      (col) => "  " + columnDefinition(col, cfg, fkByColumn, true)
    );
    const pkLines = cfg.primaryKeys.map(
      (pk) => `  PRIMARY KEY (${pk.columns.map((c) => quoteIdent(c.name)).join(", ")})`
    );
    const body = [...columnLines, ...pkLines].join(",\n");
    tableStatements.push(`CREATE TABLE IF NOT EXISTS ${quoteIdent(cfg.name)} (\n${body}\n);`);

    for (const col of cfg.columns) {
      addColumnStatements.push(
        `ALTER TABLE ${quoteIdent(cfg.name)} ADD COLUMN IF NOT EXISTS ` +
          `${columnDefinition(col, cfg, fkByColumn, false)};`
      );
    }

    for (const idx of cfg.indexes) {
      const kind = idx.config.unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
      const indexName = idx.config.name;
      if (!indexName) {
        throw new Error(
          `schemaStatements: table "${cfg.name}" has an unnamed index — ` +
            `update schemaStatements() in server/schemaDdl.ts.`
        );
      }
      const cols = idx.config.columns.map((c) => {
        const colName = (c as { name?: string }).name;
        if (!colName) {
          throw new Error(
            `schemaStatements: index "${indexName}" on table "${cfg.name}" ` +
              `indexes an expression, not a plain column — update ` +
              `schemaStatements() in server/schemaDdl.ts.`
          );
        }
        return quoteIdent(colName);
      });
      // btree is Postgres' default and the only method the plain `.on(...)`
      // form can mean, so it is left implicit; anything else is named.
      const method = idx.config.method;
      const using = !method || method === "btree" ? "" : ` USING ${quoteIdent(method)}`;
      indexStatements.push(
        `${kind} IF NOT EXISTS ${quoteIdent(indexName)} ON ${quoteIdent(cfg.name)}` +
          `${using} (${cols.join(", ")});`
      );
    }
  }

  return [
    ...enumStatements,
    ...tableStatements,
    ...addColumnStatements,
    ...indexStatements,
    ...SESSION_TABLE_STATEMENTS,
  ];
}

/**
 * Columns `shared/schema.ts` renamed. Only `drizzle-kit push` can carry a
 * rename out; until it has, the old column is still there.
 */
const RENAMED_COLUMNS = [
  { table: "active_games", from: "room_code", to: "room_id" },
  { table: "match_replays", from: "room_code", to: "room_id" },
] as const;

/** Refuses a database still holding a column the code no longer writes. */
export async function assertRenamesApplied(pool: Pick<Pool, "query">): Promise<void> {
  for (const { table, from, to } of RENAMED_COLUMNS) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
      [table, from]
    );
    if (rows.length > 0) {
      throw new Error(
        `Database out of date: "${table}"."${from}" is now "${to}", and ` +
          `ensureSchema() is additive — it cannot rename it. Run ` +
          `\`npm run db:push\` against this database, then start the server again.`
      );
    }
  }
}

/**
 * Brings the connected database up to `shared/schema.ts`. Every statement it
 * emits is idempotent and additive, but running it is not unconditionally
 * safe: it throws against a database that still holds a column
 * `shared/schema.ts` has renamed, which only `npm run db:push` can carry out.
 *
 * Not wrapped in a transaction: `ALTER TYPE ... ADD VALUE` is the one statement
 * here Postgres restricts inside one, and a half-applied additive schema is
 * recoverable by the next boot anyway. A failure is rethrown so the server
 * refuses to start rather than serving requests against a schema it knows is
 * wrong.
 */
export async function ensureSchema(pool: Pool): Promise<void> {
  await assertRenamesApplied(pool);
  const statements = schemaStatements();
  for (const statement of statements) {
    await pool.query(statement);
  }
  logger.info({ statements: statements.length }, "Database schema ensured");
}
