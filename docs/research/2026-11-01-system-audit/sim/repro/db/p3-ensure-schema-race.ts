// P3a: concurrent boots on an empty database. Each "boot" gets its own pool configured exactly as
// server/store/db.ts configures the app pool, and runs the real ensureSchema on it.
// Usage: p3-ensure-schema-race.ts <boots> <reps>
import pg from "pg";
import { directUrl, REPRO_DB, PG_PORT } from "./proxy.ts";

const boots = Number(process.argv[2] ?? 3);
const reps = Number(process.argv[3] ?? 10);
process.env.DATABASE_URL = directUrl;
process.env.LOG_LEVEL = "silent";
const { createPool } = await import("../../../../../../server/store/pool.ts");
const { ensureSchema } = await import("../../../../../../server/store/schemaDdl.ts");

const admin = new pg.Client({ connectionString: `postgres://postgres@localhost:${PG_PORT}/postgres` });
await admin.connect();
const tally = new Map<string, number>();
let repsWithFailure = 0;
for (let rep = 1; rep <= reps; rep++) {
  await admin.query(`DROP DATABASE IF EXISTS ${REPRO_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${REPRO_DB} ENCODING 'UTF8' TEMPLATE template0`);
  const pools = Array.from({ length: boots }, (_, i) =>
    createPool(`boot-${i}`, {
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 5_000,
      query_timeout: 5_000,
    }));
  const t = Date.now();
  const results = await Promise.allSettled(pools.map((p) => ensureSchema(p)));
  const failures = results.flatMap((r, i) => {
    if (r.status === "fulfilled") return [];
    const e = r.reason as { code?: string; constraint?: string; message: string };
    const key = `${e.code ?? "?"} ${e.constraint ?? ""} :: ${e.message.split("\n")[0]}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    return [`boot ${i}: ${key}`];
  });
  if (failures.length) repsWithFailure++;
  console.log(`rep ${rep}: ${boots - failures.length}/${boots} boots ok in ${Date.now() - t}ms${failures.length ? "\n  " + failures.join("\n  ") : ""}`);
  await Promise.all(pools.map((p) => p.end()));
}
console.log(`\n${boots} concurrent boots x ${reps} reps: ${repsWithFailure} reps had a failed boot`);
for (const [k, n] of tally) console.log(`  ${n} x ${k}`);
await admin.end();
process.exit(0);
