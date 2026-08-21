/**
 * Read-only: dumps the whole database to a file, for the pre-deploy backup
 * `docs/DEPLOY-RUNBOOK.md` and `replit.md` § Rolling back a deploy both ask for.
 *
 * The `session` table IS included, deliberately. It is absent from
 * `shared/schema.ts` and excluded from drizzle-kit by `tablesFilter`, so a
 * schema-driven dump would miss it — but the documented restore is
 * `DROP SCHEMA public CASCADE` followed by this file, and connect-pg-simple
 * runs with `createTableIfMissing:false`. A dump without `session` therefore
 * restores into a server that cannot store a login. Dumping the whole database
 * rather than a table list is what keeps that true when a table is added.
 *
 * Usage:  node scripts/backup-db.mjs [outfile]
 *         npm run db:backup
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Run this on Replit, or in a shell that has it.\n" +
      "Nothing was written."
  );
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const outfile = path.resolve(process.argv[2] ?? `backups/murlan-${stamp}.sql`);

mkdirSync(path.dirname(outfile), { recursive: true });

const { error, status } = spawnSync(
  "pg_dump",
  [process.env.DATABASE_URL, "--no-owner", "--no-privileges", "-f", outfile],
  { stdio: ["ignore", "inherit", "inherit"] }
);

if (error?.code === "ENOENT") {
  console.error(
    "pg_dump is not on PATH. Replit's postgresql-16 module provides it (.replit `modules`);\n" +
      "a local shell may not. Nothing was written."
  );
  process.exit(1);
}
if (error || status !== 0) {
  console.error(`\npg_dump failed (${error?.message ?? `exit ${status}`}). Do not deploy.`);
  process.exit(1);
}

// pg_dump exits 0 having written nothing if the connection dies mid-stream, and
// the runbook is about to trust this file.
const { size } = statSync(outfile, { throwIfNoEntry: false }) ?? {};
if (!size) {
  console.error(`\npg_dump reported success but ${outfile} is empty. Do not deploy.`);
  process.exit(1);
}

console.log(`\nWrote ${outfile} (${(size / 1024).toFixed(0)} KB), session table included.`);
console.log("Restore: replit.md § Rolling back a deploy.");
