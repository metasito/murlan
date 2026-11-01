// P3b: the same race between separate processes, each running sim/ensure-schema.ts (the real
// createPool + ensureSchema), started together on a fresh empty database; then one more boot on
// the database the race left behind.
import pg from "pg";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { directUrl, REPRO_DB, PG_PORT } from "./proxy.ts";

const script = fileURLToPath(new URL("../../ensure-schema.ts", import.meta.url));
const reps = Number(process.argv[2] ?? 5);
const admin = new pg.Client({ connectionString: `postgres://postgres@localhost:${PG_PORT}/postgres` });
await admin.connect();
const boot = () =>
  new Promise<{ code: number | null; err: string }>((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", script], {
      env: { ...process.env, DATABASE_URL: directUrl },
    });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (out += b));
    child.on("exit", (code) => {
      const m = out.match(/(duplicate key[^"\\]*"[^"\\]*"|type "[^"\\]*" already exists|relation "[^"\\]*" already exists)/);
      resolve({ code, err: m ? m[1] : code ? out.slice(0, 200) : "" });
    });
  });
for (let rep = 1; rep <= reps; rep++) {
  await admin.query(`DROP DATABASE IF EXISTS ${REPRO_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${REPRO_DB} ENCODING 'UTF8' TEMPLATE template0`);
  const r = await Promise.all([boot(), boot()]);
  console.log(`rep ${rep}: exits ${r.map((x) => x.code).join(",")} ${r.map((x) => x.err).filter(Boolean).join(" | ")}`);
}
const again = await boot();
console.log(`one more boot on the raced database: exit ${again.code} ${again.err}`);
await admin.end();
