import type { Express } from "express";
import { PushTokenSchema, RenameSchema } from "../../../shared/httpSchemas.ts";
import { DEFAULT_LOCALE } from "../../../shared/i18n.ts";
import { routeLimiter } from "../rateLimit.ts";
import { onSignedIn } from "../mount.ts";
import { validate } from "../validate.ts";
import { sessionUser } from "../accountSession.ts";
import { deleteUser } from "../deleteAccount.ts";
import { logger } from "../../shared/logger.ts";
import { userStore, UsernameTakenError } from "../../store/userStore.ts";
import { savePushToken } from "../../socket/push.ts";
import { evictUser } from "../../socket/socketRegistry.ts";
import { trackEvent } from "../../shared/events.ts";
import { payload } from "../../shared/payload.ts";

/**
 * A rename with no ceiling is how one account cycles through names to impersonate others between
 * games. Keyed on the account rather than the address, because the address is shared by everyone
 * behind a household NAT and the limit is about the account's behaviour.
 *
 * A limiter rather than a `usernameChangedAt` column: `CLAUDE.md` orders a change by design, and
 * a column is the last resort. A player-visible "you can change this again in N days" would need
 * one, and that is its own ticket.
 */
const renameLimiter = routeLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  defaultMax: 5,
  envVar: "MURLAN_RENAME_RATE_LIMIT",
  keyBy: "session",
  message: payload("RENAME_RATE_LIMITED"),
});

// A crashing client can crash repeatedly. This is deliberately tight: enough
// to catch a crash loop starting, not enough for one device to flood the log.
// Registration happens once per visit to the Friends screen and once on
// logout. Anything beyond a handful a minute is not a phone registering.
//
// Keyed by account, not by address: the endpoint requires a session, so the
// account is the thing worth limiting, and an IP key would make one player on
// a shared network throttle everyone else behind it.
const pushLimiter = routeLimiter({
  windowMs: 60 * 1000,
  defaultMax: 10,
  keyBy: "session",
  message: payload("RATE_LIMITED"),
});

export function mountAccount(app: Express): void {
  // The token rides the session so /api/auth/logout can withdraw it: a client
  // cold-started since registering no longer knows it.
  onSignedIn(app, "POST /api/push/token", pushLimiter, validate(PushTokenSchema), async (req, res, userId) => {
    const { token, platform, locale } = req.body;
    await savePushToken(userId, token, platform, locale ?? DEFAULT_LOCALE);
    req.session.pushToken = token;
    res.json({ ok: true });
  });

  // Nothing stores a username as history: `roundHistory.userId`, `replays.playerIds` and every
  // stats, rating and friends table key on the id, so each read projects whatever the name is
  // now. A rename is one column, with no backfill behind it. `round_replays.seats.name` is the
  // one stored copy, and `server/game/replays.ts` resolves it against the account on every read.
  //
  // Seated players keep the name the room was joined under — rewriting live room state mid-round
  // would change an opponent's name under the other players for no benefit. The table catches up
  // when the player next sits down.
  // Validation before the limiter: a body that fails the rule never renamed anything, and the
  // budget is there to bound name *cycling*. Spending it on typos would lock a player out of a
  // rename they never made.
  onSignedIn(app, "PATCH /api/users/me", validate(RenameSchema), renameLimiter, async (req, res, userId) => {
    const { username } = req.body;

    // Case-insensitively, by `users_username_lower_uq`. Comparing ids rather than names is what
    // lets a player recase their own: that lookup finds their own row.
    const holder = await userStore.getUserByUsername(username);
    if (holder && holder.id !== userId) {
      res.status(409).json({ ...payload("USERNAME_TAKEN") });
      return;
    }

    try {
      const user = await userStore.renameUser(userId, username);
      logger.info({ userId, username }, "User renamed");
      res.json(sessionUser(user));
    } catch (err) {
      // The check above and this write are not one transaction, so the name can be claimed in
      // between. The constraint is the authority; the check only makes the common case a clean 409.
      if (!(err instanceof UsernameTakenError)) throw err;
      res.status(409).json({ ...payload("USERNAME_TAKEN") });
    }
  });

  onSignedIn(app, "POST /api/users/me/tutorial-seen", async (_req, res, userId) => {
    // Only the first transition is a funnel step. This endpoint is also the
    // catch-up write app/index.tsx makes when the device knows and the account
    // does not, and counting that would report one player opening the tutorial
    // once per phone they own.
    const before = await userStore.getUser(userId);
    await userStore.markTutorialSeen(userId);
    if (before && !before.tutorialSeenAt) trackEvent("tutorial.started", userId);
    res.json({ ok: true });
  });

  onSignedIn(app, "DELETE /api/users/me", async (req, res, userId) => {
    try {
      const seatedRoomIds = await deleteUser(userId);
      req.session.destroy(() => {});
      // After the delete has committed, never before: the account's live
      // socket outlives its session, and a seat still held by an id no `users`
      // row answers to fails every write the round's end makes for the whole
      // table.
      await evictUser(userId, seatedRoomIds);
      logger.info({ userId }, "User account deleted");
      res.json({ ...payload("ACCOUNT_DELETED") });
    } catch (err) {
      logger.error({ err }, "Delete user failed");
      res.status(500).json({ ...payload("ACCOUNT_DELETE_FAILED") });
    }
  });
}
