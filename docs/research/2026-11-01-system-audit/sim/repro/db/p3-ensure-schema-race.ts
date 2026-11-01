// P3a: concurrent boots on an empty database, each running the real ensureSchema. (Recorded
// against the version that ran on the app pool; ensureSchema now opens its own DDL client.)
// Usage: p3-ensure-schema-race.ts <boots> <reps>
import pg from "pg";
import { directUrl, REPRO_DB, PG_PORT } from "./proxy.ts";

const boots = Number(process.argv[2] ?? 3);
const reps = Number(process.argv[3] ?? 10);
process.env.DATABASE_URL = directUrl;
process.env.LOG_LEVEL = "silent";
const { ensureSchema } = await import("../../../../../../server/store/schemaDdl.ts");

const admin = new pg.Client({ connectionString: `postgres://postgres@localhost:${PG_PORT}/postgres` });
await admin.connect();
const tally = new Map<string, number>();
let repsWithFailure = 0;
for (let rep = 1; rep <= reps; rep++) {
  await admin.query(`DROP DATABASE IF EXISTS ${REPRO_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${REPRO_DB} ENCODING 'UTF8' TEMPLATE template0`);
  const t = Date.now();
  const results = await Promise.allSettled(Array.from({ length: boots }, () => ensureSchema()));
  const failures = results.flatMap((r, i) => {
    if (r.status === "fulfilled") return [];
    const e = r.reason as { code?: string; constraint?: string; message: string };
    const key = `${e.code ?? "?"} ${e.constraint ?? ""} :: ${e.message.split("\n")[0]}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    return [`boot ${i}: ${key}`];
  });
  if (failures.length) repsWithFailure++;
  console.log(`rep ${rep}: ${boots - failures.length}/${boots} boots ok in ${Date.now() - t}ms${failures.length ? "\n  " + failures.join("\n  ") : ""}`);
}
console.log(`\n${boots} concurrent boots x ${reps} reps: ${repsWithFailure} reps had a failed boot`);
for (const [k, n] of tally) console.log(`  ${n} x ${k}`);
await admin.end();
process.exit(0);
