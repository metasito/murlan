import { randomBytes, randomInt, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db.ts";
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

// Salts the hash with the address and purpose it's for, so two accounts
// minted the same 6-digit code don't collide on `auth_tokens_token_hash_uq`
// — see the `authTokens` table doc in shared/schema.ts. Salted by email
// rather than userId: the row's own `user_id` (via `RETURNING`) is what
// answers "which account", so redeeming never needs a separate, ambiguous
// email→account lookup the way `storage.getUserByEmail`'s bare `[0]` would
// be once more than one account can share an address (#900 review).
// Case-folded so a redeem typed in different case than the mint still
// matches, the same normalization `getUserByEmail`'s `lower()` applies.
function hashCodeInput(email: string, purpose: AuthTokenPurpose, code: string): string {
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

/** Mints a 6-digit numeric code for `email`, stores only its salted hash, and returns the raw digits to send. */
export async function mintAuthCode(
  userId: string,
  email: string,
  purpose: AuthTokenPurpose,
  ttlMs: number
): Promise<string> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.insert(authTokens).values({
    userId,
    purpose,
    tokenHash: hashToken(hashCodeInput(email, purpose, code)),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return code;
}

/**
 * Redeems a code the same single-use, race-proof way `redeemAuthToken` does
 * — matched by `(email, purpose, code)` rather than the code alone, so it
 * needs no separate account lookup — and additionally guarded by
 * `attempts < MAX_CODE_ATTEMPTS` so a match stops working once a code has
 * been guessed wrong too many times, even before its TTL runs out. Returns
 * the row's own userId, exactly what `RETURNING` names, never a value the
 * caller had to resolve itself.
 *
 * A miss still costs a row an attempt: the second UPDATE runs whenever the
 * first found nothing, incrementing every still-pending `email_verify` row
 * for an account at this address — there is at most one per account by
 * construction, and more than one account only when several share an
 * address, in which case a wrong guess costs all of them equally rather
 * than picking one arbitrarily. This is what makes "N wrong guesses" a real
 * cap instead of just documentation — an unmatched guess doesn't identify a
 * row on its own the way the first UPDATE's exact hash match does.
 */
export async function redeemAuthCode(
  email: string,
  purpose: AuthTokenPurpose,
  code: string
): Promise<string | null> {
  const tokenHash = hashToken(hashCodeInput(email, purpose, code));
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
