/**
 * Sets a new random password on one account and prints it once.
 *
 *   ALLOW_RESET=1 node scripts/reset-password.mjs <username>
 *
 * There is no self-serve recovery — no email is stored — so this is the only
 * way a locked-out account gets back in. It is deliberately not an npm script
 * and not a route: it needs the database URL and a person who has decided to
 * run it.
 *
 * The username is matched case-insensitively, the same way login is
 * (server/storage.ts getUserByUsername), so the caller does not have to know
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
try {
  const { rows } = await pool.query(
    `UPDATE users SET password = $1
      WHERE lower(username) = lower($2)
      RETURNING username`,
    [hash, username]
  );
  if (rows.length === 0) {
    console.error(`There is no account named "${username}".`);
    process.exit(1);
  }
  console.log(`${rows[0].username} — temporary password: ${temporary}`);
  console.log("Shown once. Send it to them — there is no in-app change-password screen yet.");
} finally {
  await pool.end();
}
