/**
 * Destructive: wipes ALL application data so the schema can be re-pushed clean.
 *
 * Deletes every row from users, rooms, room_players, friends and active_games,
 * and clears all login sessions. Intended for a deliberate clean slate — it is
 * NOT a migration and it preserves nothing.
 *
 * The `session` TABLE itself is deliberately left in place: connect-pg-simple
 * runs with createTableIfMissing:false, so dropping it would break the server.
 * Only its rows are removed (everyone gets logged out, which is unavoidable
 * once the users they reference are gone).
 *
 * Usage:  node scripts/reset-db.mjs --yes
 * Then:   npm run db:push
 */
import pg from "pg";

if (!process.argv.includes("--yes")) {
  console.error(
    "Refusing to run without --yes.\n" +
      "This DELETES ALL DATA (users, rooms, friends, games, sessions).\n" +
      "Re-run as: node scripts/reset-db.mjs --yes"
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run this on Replit, or in a shell that has it.");
  process.exit(1);
}

// Order does not matter because of CASCADE, but active_games is listed first
// since it is the table most likely to hold rows in an incompatible old shape.
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
