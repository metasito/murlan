/**
 * Destructive: wipes ALL application data so the schema can be re-pushed clean.
 *
 * TRUNCATE ... CASCADE empties TABLES below *and every table with an FK into them*,
 * and clears all login sessions. Intended for a deliberate clean slate — it is
 * NOT a migration and it preserves nothing.
 *
 * The `session` table is left in place — connect-pg-simple runs with
 * createTableIfMissing:false — and only its rows are cleared.
 *
 * Usage:  ALLOW_DESTRUCTIVE=1 node scripts/reset-db.mjs --yes
 * Then:   npm run db:push
 */
import pg from "pg";
import { parse } from "pg-connection-string";

const HOW_TO =
  "To really do it, type this yourself (the npm script cannot):\n" +
  "  ALLOW_DESTRUCTIVE=1 node scripts/reset-db.mjs --yes\n" +
  "On Windows PowerShell:\n" +
  '  $env:ALLOW_DESTRUCTIVE=1; node scripts/reset-db.mjs --yes';

if (process.env.NODE_ENV === "production") {
  console.error(
    "Refusing to run with NODE_ENV=production.\n" +
      "This script DELETES ALL DATA and is never safe against a live database."
  );
  process.exit(1);
}

if (process.env.ALLOW_DESTRUCTIVE !== "1") {
  console.error(
    "Refusing to run: ALLOW_DESTRUCTIVE=1 is not set.\n" +
      "This DELETES ALL DATA (users, rooms, friends, games, sessions).\n" +
      "If you wanted to apply schema changes, you want `npm run db:push`.\n" +
      HOW_TO
  );
  process.exit(1);
}

if (!process.argv.includes("--yes")) {
  console.error("Refusing to run without --yes.\n" + HOW_TO);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run this in a shell that has it.");
  process.exit(1);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const dbHost = (() => {
  try {
    return (parse(process.env.DATABASE_URL).host ?? "").replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
})();
if (!LOCAL_HOSTS.has(dbHost) && process.env.ALLOW_REMOTE_RESET !== "1") {
  console.error(
    `Refusing to run: DATABASE_URL host "${dbHost}" is not localhost, 127.0.0.1 or ::1.\n` +
      "This DELETES ALL DATA on that database. If that is truly the target, also set ALLOW_REMOTE_RESET=1."
  );
  process.exit(1);
}

const TABLES = ["active_games", "room_players", "rooms", "friends", "users"];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const before = {};
  for (const t of TABLES) {
    try {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
      before[t] = rows[0].n;
    } catch {
      before[t] = "(table does not exist yet)";
    }
  }
  try {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM session");
    before.session = rows[0].n;
  } catch {
    before.session = "(no session table)";
  }

  console.log("Rows before reset:");
  for (const [t, n] of Object.entries(before)) console.log(`  ${t.padEnd(14)} ${n}`);

  await pool.query("BEGIN");
  // TRUNCATE ... CASCADE clears dependent rows in one statement and resets
  // sequences; it is also far faster than DELETE on a table with FKs.
  await pool.query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  // Sessions are keyed by userId in their JSON payload, so every one of them is
  // now dangling. Clear rows only — never drop this table.
  await pool.query("DELETE FROM session");
  await pool.query("COMMIT");

  console.log("\nAll application data deleted. The `session` table structure was preserved.");
  console.log("Next step:  npm run db:push");
} catch (err) {
  await pool.query("ROLLBACK").catch(() => {});
  console.error("\nReset failed, nothing was changed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
