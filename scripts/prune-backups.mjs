/**
 * Deletes dumps `scripts/backup-db.mjs` wrote once they are older than a
 * retention window — `backup-db.mjs` itself never prunes, so nothing else
 * does either. See `docs/DEPLOY-RUNBOOK.md` § Backups.
 *
 * Never deletes the most recent dump, however old it is: a paused schedule
 * or a retention window shorter than the gap since the last successful
 * backup must not leave zero dumps behind.
 *
 * Age is read from the filename's own timestamp, not the file's mtime — a
 * dump copied onto a Replit Volume after the fact would otherwise look
 * freshly made.
 *
 * Usage:  node scripts/prune-backups.mjs [dir]
 *         npm run db:backup:prune
 * Retention window (days): BACKUP_RETENTION_DAYS, default 14.
 */
import { readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DUMP_NAME } from "./backupNaming.mjs";

const dir = path.resolve(process.argv[2] ?? "backups");

const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "14");
if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
  console.error(
    `BACKUP_RETENTION_DAYS must be a positive number, got ${JSON.stringify(
      process.env.BACKUP_RETENTION_DAYS
    )}. Nothing was pruned.`
  );
  process.exit(1);
}

// This naming sorts chronologically as plain text, so listing "the most
// recent dump" below needs no parsing.
function dumpTimestamp(name) {
  const m = DUMP_NAME.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
}

let entries;
try {
  entries = readdirSync(dir);
} catch (err) {
  if (err.code === "ENOENT") {
    console.log(`${dir} does not exist yet — nothing to prune.`);
    process.exit(0);
  }
  throw err;
}

const dumps = entries.filter((name) => DUMP_NAME.test(name)).sort();

if (dumps.length === 0) {
  console.log(`No dumps in ${dir} — nothing to prune.`);
  process.exit(0);
}

const mostRecent = dumps[dumps.length - 1];
const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

let deleted = 0;
for (const name of dumps.slice(0, -1)) {
  if (dumpTimestamp(name) < cutoff) {
    unlinkSync(path.join(dir, name));
    deleted++;
    console.log(`Deleted ${name} (past the ${retentionDays}-day retention window).`);
  }
}

console.log(
  `Kept ${dumps.length - deleted} of ${dumps.length} dump(s) in ${dir}. ` +
    `${mostRecent} kept unconditionally, as the most recent.`
);
