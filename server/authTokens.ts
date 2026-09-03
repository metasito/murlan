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
 *
 * Sweeps expired rows on every call — the design's retention rule, and the
 * only thing that bounds this table.
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
  await db.execute(sql`DELETE FROM auth_tokens WHERE expires_at < now()`);
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
