import { randomBytes, randomInt, createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../store/db.ts";
import { lockUsers, type Tx } from "../store/userLock.ts";
import { userStore, uniqueViolation } from "../store/userStore.ts";
import { authTokens } from "../../shared/schema.ts";
import type { AuthTokenPurpose } from "../../shared/schema.ts";

/**
 * Proof-of-mailbox-control credentials — see the `authTokens` table doc in
 * shared/schema.ts. Read by two plain HTTP routes only; never by the socket
 * handshake.
 */

// #925: long enough to fetch the mail without feeling rushed, short enough
// that a stale code isn't worth guessing — MAX_CODE_ATTEMPTS below is what
// actually bounds a brute force, this just bounds how long one is live.
export const EMAIL_VERIFY_CODE_TTL_MS = 15 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** #925: wrong guesses against one live code, resends included. */
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

async function insertCredential(executor: typeof db | Tx, params: {
  userId: string;
  purpose: AuthTokenPurpose;
  tokenHash: string;
  ttlMs: number;
  attempts?: number;
}): Promise<void> {
  const { userId, purpose, tokenHash, ttlMs, attempts } = params;
  await executor.insert(authTokens).values({
    userId,
    purpose,
    tokenHash,
    attempts,
    expiresAt: new Date(Date.now() + ttlMs),
  });
}

/**
 * Shared atomic claim behind both redeem shapes below: single-use via the
 * `used_at IS NULL AND expires_at > now()` guard inside the same UPDATE, so
 * two near-simultaneous redemptions cannot both succeed.
 */
async function claimCredential(params: {
  tokenHash: string;
  purpose: AuthTokenPurpose;
  maxAttempts?: number;
}): Promise<string | null> {
  const { tokenHash, purpose, maxAttempts } = params;
  const attemptsGuard = maxAttempts === undefined ? sql`` : sql`AND attempts < ${maxAttempts}`;
  const result = await db.execute<{ user_id: string }>(sql`
    UPDATE auth_tokens
    SET used_at = now()
    WHERE token_hash = ${tokenHash}
      AND purpose = ${purpose}
      AND used_at IS NULL
      AND expires_at > now()
      ${attemptsGuard}
    RETURNING user_id
  `);
  return result.rows[0]?.user_id ?? null;
}

/** Mints a raw token, stores only its hash, and returns the raw value to hand to the user. */
export async function mintAuthToken(
  userId: string,
  purpose: AuthTokenPurpose,
  ttlMs: number
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await insertCredential(db, { userId, purpose, tokenHash: hashToken(raw), ttlMs });
  return raw;
}

/**
 * Redeems a token. Returns the token's userId, or null if it is unknown,
 * already used, expired or minted for a different purpose.
 */
export async function redeemAuthToken(rawToken: string, purpose: AuthTokenPurpose): Promise<string | null> {
  return claimCredential({ tokenHash: hashToken(rawToken), purpose });
}

/**
 * Guesses the replaced code already cost, carried onto its replacement so a
 * resend cannot re-arm MAX_CODE_ATTEMPTS at will. Only a code still inside its
 * own TTL charges: an expired one could be guessed no further anyway, and
 * forgetting it is what keeps five typos from locking an account out for good.
 */
function spentAttempts(replaced: { attempts: number; expiresAt: Date }[]): number {
  const now = Date.now();
  return Math.max(0, ...replaced.filter((r) => r.expiresAt.getTime() > now).map((r) => r.attempts));
}

/**
 * Mints a 6-digit numeric code for `email`, stores only its salted hash, and
 * returns the raw digits to send.
 *
 * At most one `email_verify` row may exist per user, whichever mint runs
 * last: a second live code is the address-takeover window #900's review
 * flagged. The delete and the insert run under the user's row lock, so two
 * concurrent mints cannot each delete before the other inserts.
 *
 * A collision on `auth_tokens_token_hash_uq` (~1-in-1,000,000 per pair)
 * retries with a fresh code rather than failing the mint outright.
 */
export async function replaceEmailVerifyCode(params: {
  userId: string;
  email: string;
  ttlMs: number;
}): Promise<string> {
  const { userId, email, ttlMs } = params;
  const purpose = "email_verify";
  for (let attempt = 0; ; attempt++) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    try {
      await db.transaction(async (tx) => {
        await lockUsers(tx, [userId]);
        const replaced = await tx
          .delete(authTokens)
          .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)))
          .returning({ attempts: authTokens.attempts, expiresAt: authTokens.expiresAt });
        await insertCredential(tx, {
          userId,
          purpose,
          tokenHash: hashToken(codeHashInput(email, purpose, code)),
          ttlMs,
          attempts: spentAttempts(replaced),
        });
      });
      return code;
    } catch (err) {
      if (attempt >= 2 || uniqueViolation(err) !== "auth_tokens_token_hash_uq") throw err;
    }
  }
}

/**
 * Matched by `(email, purpose, code)`, so a hit's own `user_id` answers
 * "which account" with no separate lookup, and a miss can still be charged
 * without knowing it up front — every still-pending row at that address gets
 * `attempts + 1`, which is more than one row only when several accounts
 * share an address.
 *
 * A hit is one atomic `UPDATE`, so two concurrent right guesses can't both
 * redeem. A miss takes no row lock (its `WHERE` matches nothing), so several
 * concurrent wrong guesses can each be checked before `attempts` catches up:
 * the cap bounds a guessing run to roughly MAX_CODE_ATTEMPTS plus whatever
 * ran concurrently, not exactly. Negligible against a 1-in-1,000,000 code
 * and `authLimiter`'s per-IP ceiling.
 */
export async function redeemAuthCode(params: {
  email: string;
  purpose: AuthTokenPurpose;
  code: string;
}): Promise<string | null> {
  const { email, purpose, code } = params;
  const tokenHash = hashToken(codeHashInput(email, purpose, code));
  const redeemedUserId = await claimCredential({ tokenHash, purpose, maxAttempts: MAX_CODE_ATTEMPTS });
  if (redeemedUserId) return redeemedUserId;

  const userIds = await userStore.getUserIdsByEmail(email);
  await db.execute(sql`
    UPDATE auth_tokens
    SET attempts = attempts + 1
    WHERE purpose = ${purpose}
      AND used_at IS NULL
      AND expires_at > now()
      AND ${inArray(authTokens.userId, userIds)}
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
