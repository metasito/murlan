import { randomBytes, randomInt, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db.ts";
import { uniqueViolation } from "./storage.ts";
import { authTokens } from "../shared/schema.ts";
import type { AuthTokenPurpose } from "../shared/schema.ts";

/**
 * Proof-of-mailbox-control credentials — see the `authTokens` table doc in
 * shared/schema.ts. Read by two plain HTTP routes only; never by the socket
 * handshake.
 */

export const EMAIL_VERIFY_CODE_TTL_MS = 15 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** #925: wrong guesses against one outstanding code before it must be resent. */
export const MAX_CODE_ATTEMPTS = 5;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Salted by email rather than userId, so redemption resolves the account
// from the matched row's own `user_id` instead of a separate, ambiguous
// email→account lookup (#900 review) — see shared/schema.ts's table doc.
function codeHashInput(email: string, purpose: AuthTokenPurpose, code: string): string {
  return `${email.trim().toLowerCase()}:${purpose}:${code}`;
}

/** Mints a raw token, stores only its hash, and returns the raw value to hand to the user. */
export async function mintAuthToken(
  userId: string,
  purpose: AuthTokenPurpose,
  ttlMs: number
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.insert(authTokens).values({
    userId,
    purpose,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

/**
 * Redeems a token: single-use via the atomic `used_at IS NULL AND
 * expires_at > now()` guard inside the same UPDATE, so two near-simultaneous
 * redemptions cannot both succeed. Returns the token's userId, or null if it
 * is unknown, already used, expired or minted for a different purpose.
 */
export async function redeemAuthToken(
  rawToken: string,
  purpose: AuthTokenPurpose
): Promise<string | null> {
  const tokenHash = hashToken(rawToken);
  const result = await db.execute<{ user_id: string }>(sql`
    UPDATE auth_tokens
    SET used_at = now()
    WHERE token_hash = ${tokenHash}
      AND purpose = ${purpose}
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING user_id
  `);
  return result.rows[0]?.user_id ?? null;
}

/**
 * Mints a 6-digit numeric code for `email`, stores only its salted hash, and
 * returns the raw digits to send. A collision on `auth_tokens_token_hash_uq`
 * (two mints landing on the same digits, ~1-in-1,000,000 per pair) retries
 * with a fresh code rather than failing the mint outright.
 */
export async function mintAuthCode(
  userId: string,
  email: string,
  purpose: AuthTokenPurpose,
  ttlMs: number
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    try {
      await db.insert(authTokens).values({
        userId,
        purpose,
        tokenHash: hashToken(codeHashInput(email, purpose, code)),
        expiresAt: new Date(Date.now() + ttlMs),
      });
      return code;
    } catch (err) {
      if (attempt >= 2 || uniqueViolation(err) !== "auth_tokens_token_hash_uq") throw err;
    }
  }
}

/**
 * Redeems a code the same single-use, race-proof way `redeemAuthToken` does:
 * a match and a miss are each one atomic `UPDATE`, so a concurrent guess
 * can't act on a stale read the way a separate SELECT-then-UPDATE could —
 * Postgres re-checks each statement's WHERE clause against the just-locked
 * row before applying it.
 *
 * Matched by `(email, purpose, code)`, so the row's own `user_id` answers
 * "which account" and a miss can still be charged without knowing it up
 * front. A miss increments `attempts` on every still-pending row at that
 * address instead: at most one per account by construction, so this reaches
 * more than one only when several accounts share an address, in which case
 * a wrong guess costs all of them rather than an arbitrary one.
 */
export async function redeemAuthCode(
  email: string,
  purpose: AuthTokenPurpose,
  code: string
): Promise<string | null> {
  const tokenHash = hashToken(codeHashInput(email, purpose, code));
  const result = await db.execute<{ user_id: string }>(sql`
    UPDATE auth_tokens
    SET used_at = now()
    WHERE token_hash = ${tokenHash}
      AND purpose = ${purpose}
      AND used_at IS NULL
      AND expires_at > now()
      AND attempts < ${MAX_CODE_ATTEMPTS}
    RETURNING user_id
  `);
  const redeemedUserId = result.rows[0]?.user_id;
  if (redeemedUserId) return redeemedUserId;

  await db.execute(sql`
    UPDATE auth_tokens
    SET attempts = attempts + 1
    WHERE purpose = ${purpose}
      AND used_at IS NULL
      AND expires_at > now()
      AND user_id IN (SELECT id FROM users WHERE lower(email) = lower(${email}))
  `);
  return null;
}

/**
 * Box 2: redeeming one `password_reset` token invalidates every other
 * outstanding one for the same user. The row the caller just redeemed
 * already has `used_at` set by `redeemAuthToken`, so this `used_at IS NULL`
 * guard leaves it untouched and only catches its unredeemed siblings.
 */
export async function invalidateAuthTokens(userId: string, purpose: AuthTokenPurpose): Promise<void> {
  await db.execute(sql`
    UPDATE auth_tokens
    SET used_at = now()
    WHERE user_id = ${userId}
      AND purpose = ${purpose}
      AND used_at IS NULL
  `);
}

/**
 * Unlike `password_reset` (invalidated only on redemption — an outstanding
 * link the user is about to click must survive a second request), every
 * `email_verify` mint retires every other outstanding one for that user
 * first. Two live `email_verify` tokens is the address-takeover window
 * #900's review flagged: redeem one and lose the race (email cleared to
 * NULL by markEmailVerified), then add-email a different address and
 * redeem the still-live second one — verifying an address never proven.
 * A hard DELETE, not a soft `used_at` mark: at most one row may exist for
 * a user+purpose at a time is the actual invariant, not just "at most one
 * redeemable" — whichever mint runs last always wins, regardless of which
 * of register's fire-and-forget mint or add-email's own lands first.
 */
export async function invalidatePendingAuthTokens(userId: string, purpose: AuthTokenPurpose): Promise<void> {
  await db.execute(sql`
    DELETE FROM auth_tokens
    WHERE user_id = ${userId}
      AND purpose = ${purpose}
      AND used_at IS NULL
  `);
}
