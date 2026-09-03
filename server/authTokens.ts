import { randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db.ts";
import { authTokens } from "../shared/schema.ts";
import type { AuthTokenPurpose } from "../shared/schema.ts";

/**
 * Proof-of-mailbox-control credentials — see the `authTokens` table doc in
 * shared/schema.ts. Read by two plain HTTP routes only; never by the socket
 * handshake.
 */

export const EMAIL_VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
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
