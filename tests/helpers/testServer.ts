import pg from "pg";
import { is, SQL, StringChunk } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../shared/schema.ts";

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Integration tests need a real Postgres. Someone checking out the repo
 * without one must still be able to run `npm test`, so integration suites
 * should skip (via this message) rather than fail.
 */
export function skipMessage(): string {
  return "DATABASE_URL not set — skipping integration tests (unit tests still run)";
}

export interface TestServer {
  url: string;
  port: number;
  schema: string;
  stop(): Promise<void>;
}

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
      `generateSchemaDdl: column "${tableName}.${col.name}" has a client-side ` +
        `default (e.g. $defaultFn) with no DB-side default, which can't be ` +
        `expressed as DDL — update generateSchemaDdl() in tests/helpers/testServer.ts.`
    );
  }
  if (is(col.default, SQL)) {
    const chunks = (col.default as SQL).queryChunks;
    const text = chunks
      .map((chunk) => {
        if (!is(chunk, StringChunk)) {
          throw new Error(
            `generateSchemaDdl: column "${tableName}.${col.name}" has a ` +
              `parameterized SQL default, which is not supported — update ` +
              `generateSchemaDdl() in tests/helpers/testServer.ts.`
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
    `generateSchemaDdl: column "${tableName}.${col.name}" has a default of an ` +
      `unsupported type (${typeof value}) — update generateSchemaDdl() in ` +
      `tests/helpers/testServer.ts.`
  );
}

type TableConfig = ReturnType<typeof getTableConfig>;

function foreignKeysByColumn(
  cfg: TableConfig
): Map<string, { table: string; column: string; onDelete: string | undefined }> {
  const map = new Map<string, { table: string; column: string; onDelete: string | undefined }>();
  for (const fk of cfg.foreignKeys) {
    const ref = fk.reference();
    if (ref.columns.length !== 1) {
      throw new Error(
        `generateSchemaDdl: table "${cfg.name}" has a composite foreign key, ` +
          `which is not supported — update generateSchemaDdl() in tests/helpers/testServer.ts.`
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
 * Generates the throwaway test schema's DDL directly from `shared/schema.ts`
 * via `getTableConfig()` (drizzle-orm/pg-core), instead of hand-maintaining a
 * parallel copy. This makes drift between the two structurally impossible:
 * add a column/table/index to `shared/schema.ts` and this DDL picks it up
 * automatically the next time tests run.
 *
 * Why generation instead of `drizzle-kit push`: `drizzle-kit push` has no
 * non-interactive mode for targeting an arbitrary/ephemeral schema (it
 * prompts for confirmation and always targets whatever schema is in the
 * connection string, with no programmatic API to drive it from a test
 * harness), and there is no migrations directory to replay (`drizzle.config.ts`
 * has no migrations committed).
 *
 * Deliberately narrow: it understands exactly the schema features
 * `shared/schema.ts` currently uses (enums, varchar/text/integer/boolean/
 * jsonb/timestamp columns, single-column foreign keys with `onDelete`,
 * simple + composite primary keys, plain-column indexes/unique indexes,
 * `.unique()` columns) and throws a descriptive error for anything else
 * (check constraints, RLS, non-default schemas, expression indexes,
 * parameterized SQL defaults, composite foreign keys) rather than silently
 * emitting incomplete DDL.
 */
export function generateSchemaDdl(): string {
  const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
  const configs = tables.map((table) => ({ table, cfg: getTableConfig(table as PgTable<any>) }));

  for (const { cfg } of configs) {
    if (cfg.checks.length > 0) {
      throw new Error(
        `generateSchemaDdl: table "${cfg.name}" has CHECK constraints, which ` +
          `are not supported — update generateSchemaDdl() in tests/helpers/testServer.ts.`
      );
    }
    if (cfg.uniqueConstraints.length > 0) {
      throw new Error(
        `generateSchemaDdl: table "${cfg.name}" has table-level unique ` +
          `constraints, which are not supported — update generateSchemaDdl() ` +
          `in tests/helpers/testServer.ts.`
      );
    }
    if (cfg.policies.length > 0 || cfg.enableRLS) {
      throw new Error(
        `generateSchemaDdl: table "${cfg.name}" uses row-level security, ` +
          `which is not supported — update generateSchemaDdl() in tests/helpers/testServer.ts.`
      );
    }
    if (cfg.schema !== undefined) {
      throw new Error(
        `generateSchemaDdl: table "${cfg.name}" declares a non-default ` +
          `Postgres schema, which is not supported — update generateSchemaDdl() ` +
          `in tests/helpers/testServer.ts.`
      );
    }
  }

  // --- enum types (CREATE TYPE ... AS ENUM), deduped by Postgres type name ---
  const enums = new Map<string, readonly string[]>();
  for (const { cfg } of configs) {
    for (const col of cfg.columns) {
      if (col.columnType !== "PgEnumColumn") continue;
      const enumName = col.getSQLType();
      const values = col.enumValues;
      if (!values) {
        throw new Error(
          `generateSchemaDdl: enum column "${cfg.name}.${col.name}" has no ` +
            `enumValues — update generateSchemaDdl() in tests/helpers/testServer.ts.`
        );
      }
      const existing = enums.get(enumName);
      if (existing && (existing.length !== values.length || existing.some((v, i) => v !== values[i]))) {
        throw new Error(
          `generateSchemaDdl: enum "${enumName}" has inconsistent values across ` +
            `its usages in shared/schema.ts.`
        );
      }
      enums.set(enumName, values);
    }
  }
  const enumStatements = [...enums.keys()].sort().map((name) => {
    const values = enums.get(name)!;
    return `CREATE TYPE ${quoteIdent(name)} AS ENUM (${values.map(sqlStringLiteral).join(", ")});`;
  });

  // --- tables, in FK dependency order so REFERENCES always target an
  // already-created table ---
  const byPgName = new Map(configs.map((c) => [c.cfg.name, c] as const));
  const sortedConfigs: typeof configs = [];
  const done = new Set<string>();

  function visit(entry: (typeof configs)[number], stack: Set<string>): void {
    if (done.has(entry.cfg.name)) return;
    if (stack.has(entry.cfg.name)) {
      throw new Error(
        `generateSchemaDdl: circular foreign key dependency involving table ` +
          `"${entry.cfg.name}" — update generateSchemaDdl() in tests/helpers/testServer.ts.`
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
    sortedConfigs.push(entry);
  }
  for (const entry of configs) visit(entry, new Set());

  const tableStatements: string[] = [];
  for (const { cfg } of sortedConfigs) {
    const fkByColumn = foreignKeysByColumn(cfg);
    const columnLines = cfg.columns.map((col) => {
      const parts = [quoteIdent(col.name), col.getSQLType()];
      if (col.notNull) parts.push("NOT NULL");
      const defaultClause = formatDefaultClause(col, cfg.name);
      if (defaultClause) parts.push(defaultClause);
      if (col.primary) parts.push("PRIMARY KEY");
      if (col.isUnique) parts.push("UNIQUE");
      const fk = fkByColumn.get(col.name);
      if (fk) {
        let clause = `REFERENCES ${quoteIdent(fk.table)}(${quoteIdent(fk.column)})`;
        if (fk.onDelete && fk.onDelete !== "no action") {
          clause += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
        }
        parts.push(clause);
      }
      return "  " + parts.join(" ");
    });
    const pkLines = cfg.primaryKeys.map(
      (pk) => `  PRIMARY KEY (${pk.columns.map((c) => quoteIdent(c.name)).join(", ")})`
    );
    const body = [...columnLines, ...pkLines].join(",\n");
    tableStatements.push(`CREATE TABLE ${quoteIdent(cfg.name)} (\n${body}\n);`);

    for (const idx of cfg.indexes) {
      const kind = idx.config.unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
      const indexName = idx.config.name;
      if (!indexName) {
        throw new Error(
          `generateSchemaDdl: table "${cfg.name}" has an unnamed index — ` +
            `update generateSchemaDdl() in tests/helpers/testServer.ts.`
        );
      }
      const cols = idx.config.columns.map((c) => {
        const colName = (c as { name?: string }).name;
        if (!colName) {
          throw new Error(
            `generateSchemaDdl: index "${indexName}" on table "${cfg.name}" ` +
              `indexes an expression, not a plain column — update ` +
              `generateSchemaDdl() in tests/helpers/testServer.ts.`
          );
        }
        return quoteIdent(colName);
      });
      tableStatements.push(
        `${kind} ${quoteIdent(indexName)} ON ${quoteIdent(cfg.name)} (${cols.join(", ")});`
      );
    }
  }

  return [...enumStatements, ...tableStatements].join("\n\n");
}

/**
 * connect-pg-simple, table "session", createTableIfMissing: false (see
 * server/session.ts). This table is NOT in `shared/schema.ts` — Drizzle
 * doesn't manage it, connect-pg-simple creates it by its own convention. The
 * developer's real "session" table is pre-created once and deliberately
 * never dropped/recreated by app code; the throwaway schema does not inherit
 * it, so it must be created here too, matching connect-pg-simple's own
 * default DDL. This one legitimately stays hand-written: there is no Drizzle
 * schema for it to be generated from.
 */
const SESSION_TABLE_DDL = `
  CREATE TABLE session (
    sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
    sess json NOT NULL,
    expire timestamp(6) NOT NULL
  );
  CREATE INDEX "IDX_session_expire" ON session (expire);
`;

function buildSchemaDdl(): string {
  return `${generateSchemaDdl()}\n\n${SESSION_TABLE_DDL}`;
}

async function dropSchema(baseUrl: string, schema: string): Promise<void> {
  const cleanup = new pg.Pool({ connectionString: baseUrl });
  try {
    await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
  } finally {
    await cleanup.end();
  }
}

/**
 * Test-only escape hatch so a test can force a failure *after* the schema
 * has been created, to prove startTestServer()'s cleanup-on-failure path
 * actually runs (see tests/integration/testServerCleanup.test.ts). Not part
 * of the documented public contract — real callers never pass this.
 */
export interface StartTestServerOptions {
  ddlOverride?: string;
}

/**
 * Boots the real Express + Socket.io app against a throwaway Postgres schema
 * so tests never touch development data. The schema is created here (DDL
 * above) and dropped on stop() — or, if anything after schema creation
 * throws (a stale `SCHEMA_DDL` after a `shared/schema.ts` change is the
 * realistic trigger), dropped and `DATABASE_URL` restored before rethrowing,
 * so a failed boot never leaks a schema or leaves the env var pointed at a
 * connection string that no longer resolves to anything valid.
 */
export async function startTestServer(
  opts: StartTestServerOptions = {}
): Promise<TestServer> {
  const schema = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const admin = new pg.Pool({ connectionString: baseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  try {
    // Point every connection at the throwaway schema via search_path, and at
    // an ephemeral port, before importing the server (module scope reads
    // these — see server/db.ts, which builds its Pool at import time).
    const scopedUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
    process.env.DATABASE_URL = scopedUrl;
    process.env.PORT = "0";
    process.env.SESSION_SECRET ??= "test-secret-not-for-production";

    const ddl = new pg.Pool({ connectionString: scopedUrl });
    try {
      await ddl.query(opts.ddlOverride ?? buildSchemaDdl());
    } finally {
      await ddl.end();
    }

    // Dynamic import of testApp.ts (not index.ts): index.ts calls listen()
    // on the real PORT and installs SIGTERM/SIGINT handlers as a side
    // effect of being imported — importing it would start (and never stop)
    // a second, unwanted server. testApp.ts only builds the app and its
    // http.Server (with Socket.io already attached via server/socket.ts's
    // setupSocket); nothing binds a port until this harness explicitly
    // listens below.
    const { createApp } = await import("../../server/testApp.ts");
    // Same module identity as whatever createApp()'s import chain (session
    // store, storage) resolved — Node's ESM cache is keyed by specifier, so
    // this is the one live `pg.Pool` the running app holds open, not a new
    // one.
    const { pool: appPool } = await import("../../server/db.ts");
    const { server, io } = await createApp();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    return {
      url: `http://127.0.0.1:${port}`,
      port,
      schema,
      async stop() {
        try {
          io.close();
          await new Promise<void>((resolve) => server.close(() => resolve()));
          // The app's own pool (session store + storage) is a module-level
          // singleton that nothing else closes — server/index.ts only does
          // so in its SIGTERM/SIGINT handler, which this harness never goes
          // through. Left open it both leaks a connection and keeps the
          // test process alive indefinitely.
          await appPool.end();
        } finally {
          // Always run, even if closing the server/pool above threw: a
          // failed shutdown must not also leak the schema or leave
          // DATABASE_URL pointed at the throwaway connection string.
          try {
            await dropSchema(baseUrl, schema);
          } finally {
            process.env.DATABASE_URL = baseUrl;
          }
        }
      },
    };
  } catch (err) {
    // Nothing was returned to the caller, so there is no stop() to call —
    // this is the only chance to undo the CREATE SCHEMA above and the
    // DATABASE_URL mutation.
    process.env.DATABASE_URL = baseUrl;
    try {
      await dropSchema(baseUrl, schema);
    } catch (cleanupErr) {
      // Best-effort: don't let a cleanup failure mask the original error
      // that made startTestServer() fail in the first place.
      console.error(
        `startTestServer: failed to drop schema "${schema}" after startup error`,
        cleanupErr
      );
    }
    throw err;
  }
}
