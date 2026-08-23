// Push notifications: the token store, and the one request that delivers one.
//
// Wired to friend invites, deliberately, and not to turns — the reasoning is in
// docs/superpowers/specs/2026-08-17-push-notifications-design.md and comes down
// to the two clocks in server/socket.ts: a player is auto-passed after 30s and
// loses the seat to a bot after 60s, which no notification can beat.
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "./db.ts";
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

/** Registers, or re-registers, one device, and forgets the account's oldest. */
export async function savePushToken(
  userId: string,
  token: string,
  platform: string,
  locale: Locale
): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ token, userId, platform, locale, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform, locale, updatedAt: new Date() },
    });

  const keep = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId))
    .orderBy(desc(pushTokens.updatedAt))
    .limit(MAX_DEVICES_PER_USER);

  if (keep.length < MAX_DEVICES_PER_USER) return;

  await db.delete(pushTokens).where(
    and(
      eq(pushTokens.userId, userId),
      notInArray(pushTokens.token, keep.map((r) => r.token))
    )
  );
}

/**
 * Forgets one device. Called on logout: the next person to hold this phone
 * must not receive the last one's invites.
 *
 * Scoped to the caller's own row. A token is a handle on someone's phone, and
 * knowing one must not be enough to unregister it — logout deletes exactly the
 * row this account registered, which is all logout ever wanted.
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
