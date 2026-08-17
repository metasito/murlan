// Push notifications: the token store, and the one request that delivers one.
//
// Wired to friend invites, deliberately, and not to turns — the reasoning is in
// docs/superpowers/specs/2026-08-17-push-notifications-design.md and comes down
// to the two clocks in server/socket.ts: a player is auto-passed after 30s and
// loses the seat to a bot after 60s, which no notification can beat.
import { eq, inArray } from "drizzle-orm";
import { db } from "./db.ts";
import { pushTokens } from "../shared/schema.ts";
import { logger } from "./logger.ts";
import { buildPushRequest, deadTokens, type ExpoTicket, type PushMessage } from "./pushShape.ts";

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

/** Registers, or re-registers, one device. */
export async function savePushToken(
  userId: string,
  token: string,
  platform: string
): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ token, userId, platform, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform, updatedAt: new Date() },
    });
}

/**
 * Forgets one device. Called on logout: the next person to hold this phone
 * must not receive the last one's invites.
 */
export async function deletePushToken(token: string): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.token, token));
}

export async function tokensFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId));
  return rows.map((r) => r.token);
}

/**
 * Delivers `message` to every one of a player's devices.
 *
 * Never throws. A notification that does not arrive must not fail whatever
 * triggered it: the invite still reaches a connected friend, and the game is
 * unaffected either way.
 *
 * Until FCM and APNs credentials are uploaded to EAS (docs/BACKLOG.md O7) Expo
 * accepts the request and cannot deliver it. Everything here still runs.
 */
export async function notifyUser(userId: string, message: PushMessage): Promise<void> {
  try {
    const tokens = await tokensFor(userId);
    if (tokens.length === 0) return;

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildPushRequest(tokens, message)),
    });

    if (!res.ok) {
      logger.warn({ userId, status: res.status }, "Expo push request rejected");
      return;
    }

    const body = (await res.json()) as { data?: ExpoTicket[] };
    const dead = deadTokens(tokens, body.data);

    if (dead.length > 0) {
      await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
      logger.info({ userId, count: dead.length }, "Dropped push tokens Expo no longer knows");
    }
  } catch (err) {
    logger.warn({ err, userId }, "Push notification failed");
  }
}
