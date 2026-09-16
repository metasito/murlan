// Push notifications: the token store, and the one request that delivers one.
//
// Wired to friend invites, deliberately, and not to turns — the reasoning is in
// docs/superpowers/specs/2026-08-17-push-notifications-design.md and comes down
// to the two clocks in server/socket.ts: a player is auto-passed after 30s and
// loses the seat to a bot after 60s, which no notification can beat.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { lockUsers } from "./userLock.ts";
import { pushTokens } from "../shared/schema.ts";
import type { Locale } from "../shared/i18n.ts";
import { logger } from "./logger.ts";
import { buildPushRequest, deadTokens, type ExpoTicket, type PushDevice, type PushMessage } from "./pushShape.ts";

export type { PushMessage };

/**
 * Expo's push service. One POST, one JSON response, no SDK.
 *
 * Overridable so a test can point it at a local stub. Without that, testing
 * that an invite actually reaches this code would mean sending invented
 * tokens to Expo's production service on every run. The default is the real
 * endpoint, so an unset variable is the shipping behaviour.
 */
const EXPO_PUSH_URL =
  process.env.MURLAN_EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";

/**
 * How many devices one account may be reachable on.
 *
 * A person has a handful. The cap is not about them: a token is accepted on an
 * authenticated request and keyed on itself, so without a bound an account
 * could register unlimited distinct well-formed tokens — rows that never
 * expire, and that every later invite would fan out to in a single request to
 * Expo. Five is generous for real use and bounds both.
 */
export const MAX_DEVICES_PER_USER = 5;

/**
 * Registers, or re-registers, one device, and forgets the account's oldest.
 * Under the user's row lock: two devices registering at once would otherwise
 * each prune with a keep-list that has not seen the other.
 */
export async function savePushToken(
  userId: string,
  token: string,
  platform: string,
  locale: Locale
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockUsers(tx, [userId]);
    await tx
      .insert(pushTokens)
      .values({ token, userId, platform, locale, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: pushTokens.token,
        set: { userId, platform, locale, updatedAt: new Date() },
      });
    await tx.delete(pushTokens).where(
      and(
        eq(pushTokens.userId, userId),
        sql`${pushTokens.token} NOT IN (
          SELECT ${pushTokens.token} FROM ${pushTokens}
          WHERE ${pushTokens.userId} = ${userId}
          ORDER BY ${pushTokens.updatedAt} DESC, ${pushTokens.token} DESC
          LIMIT ${MAX_DEVICES_PER_USER}
        )`
      )
    );
  });
}

/**
 * Forgets one device. Called on logout: the next person to hold this phone
 * must not receive the last one's invites.
 *
 * Scoped to the caller's own row: knowing a token is not authority over the
 * phone it points at.
 */
export async function deletePushToken(userId: string, token: string): Promise<void> {
  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}

export async function tokensFor(userId: string): Promise<PushDevice[]> {
  return db
    .select({ token: pushTokens.token, locale: pushTokens.locale })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId));
}

/**
 * Delivers `message` to every one of a player's devices.
 *
 * Never throws. A notification that does not arrive must not fail whatever
 * triggered it: the invite still reaches a connected friend, and the game is
 * unaffected either way.
 *
 * Until FCM and APNs credentials are uploaded to EAS (issue #32) Expo
 * accepts the request and cannot deliver it. Everything here still runs.
 */
export async function notifyUser(userId: string, message: PushMessage): Promise<void> {
  try {
    const devices = await tokensFor(userId);
    if (devices.length === 0) return;

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildPushRequest(devices, message)),
    });

    if (!res.ok) {
      logger.warn({ userId, status: res.status }, "Expo push request rejected");
      return;
    }

    const body = (await res.json()) as { data?: ExpoTicket[] };
    const dead = deadTokens(devices.map((d) => d.token), body.data);

    if (dead.length > 0) {
      await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
      logger.info({ userId, count: dead.length }, "Dropped push tokens Expo no longer knows");
    }
  } catch (err) {
    logger.warn({ err, userId }, "Push notification failed");
  }
}
