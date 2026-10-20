/**
 * Sets a new random password on one account and prints it once.
 *
 *   ALLOW_RESET=1 node scripts/reset-password.mjs <username>
 *
 * Self-serve reset now exists (POST /api/auth/request-password-reset and
 * /api/auth/reset-password) for any account with a verified email. This
 * script is deliberately the fallback rather than a stale duplicate: it is
 * the only recovery for an account that has no verified email yet, or has
 * lost access to the mailbox it verified. A signed-in player who still knows
 * their current password uses the in-app change-password screen instead. This
 * script is deliberately not an npm script and not a route: it needs the
 * database URL and a person who has decided to run it.
 *
 * The username is matched case-insensitively, the same way login is
 * (server/store/userStore.ts getUserByUsername), so the caller does not have to know
 * the exact casing the account was registered with.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const username = process.argv[2];

if (process.env.ALLOW_RESET !== "1" || !username) {
  console.error(
    "Usage: ALLOW_RESET=1 node scripts/reset-password.mjs <username>\n" +
      "On Windows PowerShell:\n" +
      '  $env:ALLOW_RESET=1; node scripts/reset-password.mjs <username>'
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// Base64url of 9 bytes: 12 characters, no ambiguous punctuation to read aloud.
const temporary = randomBytes(9).toString("base64url");
const hash = await bcrypt.hash(temporary, 10);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query(
    `UPDATE users SET password = $1
      WHERE lower(username) = lower($2)
      RETURNING id, username`,
    [hash, username]
  );
  if (rows.length === 0) {
    await client.query("ROLLBACK");
    console.error(`There is no account named "${username}".`);
    process.exit(1);
  }
  const { id } = rows[0];
  await client.query("DELETE FROM session WHERE sess->>'userId' = $1", [id]);
  await client.query("DELETE FROM push_tokens WHERE user_id = $1", [id]);
  await client.query(
    "UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL",
    [id]
  );
  await client.query("COMMIT");
  console.log(`${rows[0].username} — temporary password: ${temporary}`);
  console.log("Shown once. Send it to them — they can set their own password from the profile screen once signed in.");
  console.log("Sessions, push tokens and unredeemed reset links are gone; a connection already open ends when it next reconnects.");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  client.release();
  await pool.end();
}
