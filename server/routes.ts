import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { storage, UsernameTakenError } from "./storage.ts";
import type { User } from "../shared/schema.ts";
import { logger } from "./logger.ts";
import { validate } from "./validate.ts";
import {
  RegisterSchema,
  LoginSchema,
  AddFriendSchema,
  ClientErrorSchema,
  PushTokenSchema,
} from "./schemas.ts";
import { deletePushToken, savePushToken } from "./push.ts";
import { DEFAULT_LOCALE, type Locale } from "../shared/i18n.ts";
import { emitToUser, evictUser, isUserOnline } from "./socket.ts";
import { mintSocketTicket } from "./ticket.ts";
import { getUserStats, getMatchHistory, getUserAchievements } from "./stats.ts";
import { getReplayForUser, listReplaysForUser } from "./replays.ts";
import { getLeaderboard, getRating, PROVISIONAL_GAMES } from "./ratings.ts";
import { recordClientError } from "./clientErrors.ts";
import { adminSnapshot } from "./admin.ts";
import { renderAdminPage } from "./adminPage.ts";
import { z } from "zod";

// Every JSON error body carries a stable machine-readable `code` alongside
// plain-text `message`/`error`. The client localises by `code` and falls back
// to the text: the server keeps no translation table of its own.
/**
 * Route-parameter validation via `safeParse`, not `.parse`: `.parse` throws
 * on a bad value, which Express turns into an uncaught 500 logged as a
 * server fault, when a malformed id in the URL is squarely the caller's
 * mistake. Returns the parsed value, or null after having already sent a 400.
 */
const RouteParamSchema = z.string().min(1).max(64);

function readParam(res: Response, raw: unknown): string | null {
  const parsed = RouteParamSchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid parameter", code: "INVALID_PARAMETER" });
    return null;
  }
  return parsed.data;
}

/**
 * An integration suite registers one throwaway account per seat and burns the
 * production budget in a few tables. Read once at module scope, so a test
 * process must set it before the app is imported — see
 * tests/helpers/testServer.ts.
 */
function authMaxFromEnv(): number {
  const parsed = Number(process.env.MURLAN_AUTH_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 20;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: authMaxFromEnv(),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, try again in 15 minutes.", code: "AUTH_RATE_LIMITED" },
});

const friendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests, slow down.", code: "RATE_LIMITED" },
});

// One ticket per socket connection attempt, including every reconnect, so this
// has to tolerate a flapping mobile connection while still being bounded.
const ticketLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down.", code: "RATE_LIMITED" },
});

// A crashing client can crash repeatedly. This is deliberately tight: enough
// to catch a crash loop starting, not enough for one device to flood the log.
// Registration happens once per visit to the Friends screen and once on
// logout. Anything beyond a handful a minute is not a phone registering.
//
// Keyed by account, not by address: the endpoint requires a session, so the
// account is the thing worth limiting, and an IP key would make one player on
// a shared network throttle everyone else behind it.
const pushLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.session?.userId ?? "anonymous",
  message: { error: "Too many requests, slow down.", code: "RATE_LIMITED" },
});

const errorReportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down.", code: "RATE_LIMITED" },
});

// Everything a signed-in client is told about itself, from the one place, so
// register, login and /me cannot answer the same question differently.
function sessionUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    tutorialSeenAt: user.tutorialSeenAt ? user.tutorialSeenAt.toISOString() : null,
  };
}

/**
 * The owner, and nobody else. `requireAuth` alone is not enough here: this is
 * a new authenticated surface over everyone's data, not another player route.
 *
 * 404 rather than 403 for both the signed-out and the signed-in-but-not-owner
 * case, so the page's existence is not something an ordinary account can
 * confirm. It is not linked from the app bundle either.
 */
async function requireAdmin(req: Request, res: Response, next: () => void) {
  const userId = req.session.userId;
  if (!userId) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  const user = await storage.getUser(userId);
  if (!user?.isAdmin) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  next();
}

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.session.userId) {
    res.status(401).json({ message: "Not authenticated", code: "NOT_AUTHENTICATED" });
    return;
  }
  next();
}

// Register's regenerate and save both write the new session only after the
// user row already exists, so either one failing leaves the same orphan: the
// account is created but unreachable, and its username is permanently taken.
// Both failure paths call this so the rollback isn't duplicated.
async function rollbackRegistration(userId: string, res: Response) {
  await storage.deleteUser(userId).catch((cleanupErr) =>
    logger.error({ cleanupErr, userId }, "Failed to roll back orphaned registration")
  );
  res.status(500).json({ message: "Internal server error", code: "INTERNAL_SERVER_ERROR" });
}

export async function registerRoutes(app: Express): Promise<Server> {

  // ── Auth ──────────────────────────────────────────────────────────────────

  app.post("/api/auth/register", authLimiter, validate(RegisterSchema), async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };

    const existing = await storage.getUserByUsername(username);
    if (existing) {
      res.status(409).json({ message: "Username already taken", code: "USERNAME_TAKEN" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await storage.createUser({ username, password: passwordHash });
    } catch (err) {
      if (!(err instanceof UsernameTakenError)) throw err;
      res.status(409).json({ message: "Username already taken", code: "USERNAME_TAKEN" });
      return;
    }

    // Regenerating gives the new account a fresh session id instead of writing
    // into whatever session the registration request already carried —
    // otherwise an attacker who planted a cookie on this origin before the
    // victim signed up would inherit their session.
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error({ err: regenErr }, "Session regenerate failed on register");
        void rollbackRegistration(user.id, res);
        return;
      }
      req.session.userId = user.id;
      req.session.save((err) => {
        if (err) {
          logger.error({ err }, "Session save failed on register");
          void rollbackRegistration(user.id, res);
          return;
        }
        logger.info({ userId: user.id, username }, "User registered");
        res.json(sessionUser(user));
      });
    });
  });

  app.post("/api/auth/login", authLimiter, validate(LoginSchema), async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };

    const user = await storage.getUserByUsername(username);
    if (!user) {
      res.status(401).json({ message: "Wrong username or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      res.status(401).json({ message: "Wrong username or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    // See the register route above: regenerate first so a session id planted
    // by an attacker before this login can never end up holding this user.
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error({ err: regenErr }, "Session regenerate failed on login");
        res.status(500).json({ message: "Internal server error", code: "INTERNAL_SERVER_ERROR" });
        return;
      }
      req.session.userId = user.id;
      req.session.save((err) => {
        if (err) {
          logger.error({ err }, "Session save failed on login");
          res.status(500).json({ message: "Internal server error", code: "INTERNAL_SERVER_ERROR" });
          return;
        }
        logger.info({ userId: user.id, username }, "User logged in");
        res.json(sessionUser(user));
      });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  // Notification registration. The DELETE is what logout calls: the next
  // person to hold this phone must not receive the last one's invites, and
  // the cascade on users only covers an account being deleted.
  app.post("/api/push/token", requireAuth, pushLimiter, validate(PushTokenSchema), async (req, res) => {
    const { token, platform, locale } = req.body as {
      token: string;
      platform: string;
      locale?: Locale;
    };
    await savePushToken(req.session.userId!, token, platform, locale ?? DEFAULT_LOCALE);
    res.json({ ok: true });
  });

  app.delete("/api/push/token", requireAuth, pushLimiter, validate(PushTokenSchema), async (req, res) => {
    await deletePushToken((req.body as { token: string }).token);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      res.status(401).json({ message: "Not authenticated", code: "NOT_AUTHENTICATED" });
      return;
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      res.status(401).json({ message: "User not found", code: "USER_NOT_FOUND" });
      return;
    }
    res.json(sessionUser(user));
  });

  // Mints the short-lived, single-use ticket the socket handshake accepts in
  // place of a session cookie (native clients do not send cookies on upgrade).
  app.post("/api/auth/socket-ticket", requireAuth, ticketLimiter, (req, res) => {
    const { ticket, expiresAt } = mintSocketTicket(req.session.userId!);
    res.json({ ticket, expiresAt });
  });

  // ── User ─────────────────────────────────────────────────────────────────

  app.post("/api/users/me/tutorial-seen", requireAuth, async (req, res) => {
    await storage.markTutorialSeen(req.session.userId!);
    res.json({ ok: true });
  });

  app.delete("/api/users/me", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteUser(userId);
      req.session.destroy(() => {});
      // After the delete has committed, never before: the account's live
      // socket outlives its session, and a seat still held by an id no `users`
      // row answers to fails every write the hand's end makes for the whole
      // table.
      await evictUser(userId);
      logger.info({ userId }, "User account deleted");
      res.json({ message: "Account deleted", code: "ACCOUNT_DELETED" });
    } catch (err) {
      logger.error({ err }, "Delete user failed");
      res.status(500).json({ error: "Eliminazione fallita", code: "ACCOUNT_DELETE_FAILED" });
    }
  });

  // ── Friends ───────────────────────────────────────────────────────────────

  app.get("/api/friends", requireAuth, async (req, res) => {
    const friends = await storage.getFriends(req.session.userId!);
    res.json(friends.map((f) => ({
      id: f.friend.id,
      username: f.friend.username,
      lastSeen: f.friend.lastSeen ? f.friend.lastSeen.toISOString() : null,
    })));
  });

  app.get("/api/friends/requests", requireAuth, async (req, res) => {
    const requests = await storage.getPendingFriendRequests(req.session.userId!);
    res.json(requests.map((r) => ({
      id: r.id,
      username: r.requester.username,
    })));
  });

  app.get("/api/users/search", requireAuth, async (req, res) => {
    const username = z.string().min(1).max(30).safeParse(req.query.username);
    if (!username.success) {
      res.status(400).json({ message: "Invalid username", code: "INVALID_USERNAME" });
      return;
    }
    const found = await storage.getUserByUsername(username.data);
    if (!found || found.id === req.session.userId) {
      res.status(404).json({ message: "User not found", code: "USER_NOT_FOUND" });
      return;
    }
    res.json({ id: found.id, username: found.username });
  });

  app.get("/api/friends/sent", requireAuth, async (req, res) => {
    const sent = await storage.getSentFriendRequests(req.session.userId!);
    res.json(sent.map((r) => ({
      id: r.id,
      username: r.recipient.username,
    })));
  });

  app.post("/api/friends/add", requireAuth, friendLimiter, validate(AddFriendSchema), async (req, res) => {
    const { username } = req.body as { username: string };

    const friend = await storage.getUserByUsername(username);
    if (!friend) {
      res.status(404).json({ message: "User not found", code: "USER_NOT_FOUND" });
      return;
    }

    if (friend.id === req.session.userId) {
      res.status(400).json({ message: "You cannot add yourself", code: "CANNOT_ADD_SELF" });
      return;
    }

    const already = await storage.areFriends(req.session.userId!, friend.id);
    if (already) {
      res.status(409).json({ message: "Already friends", code: "ALREADY_FRIENDS" });
      return;
    }

    const pending = await storage.hasPendingRequest(req.session.userId!, friend.id);
    if (pending) {
      res.status(409).json({ message: "Friend request already sent", code: "FRIEND_REQUEST_ALREADY_SENT" });
      return;
    }

    const sender = await storage.getUser(req.session.userId!);
    await storage.addFriend(req.session.userId!, friend.id);

    emitToUser(friend.id, "friend:request_incoming", {
      from: sender?.username ?? "Qualcuno",
    });

    logger.info({ from: req.session.userId, to: friend.id }, "Friend request sent");
    res.json({ ok: true, username: friend.username });
  });

  app.delete("/api/friends/requests/:id", requireAuth, async (req, res) => {
    const id = readParam(res, req.params.id);
    if (id === null) return;
    // Only the sender can cancel — enforced inside cancelFriendRequest.
    const cancelled = await storage.cancelFriendRequest(id, req.session.userId!);
    if (!cancelled) {
      res.status(404).json({ message: "Friend request not found", code: "FRIEND_REQUEST_NOT_FOUND" });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/friends/accept/:id", requireAuth, async (req, res) => {
    const id = readParam(res, req.params.id);
    if (id === null) return;
    const accepterId = req.session.userId!;
    // Scoped to the recipient: the sender must not be able to accept their
    // own request by id (IDOR).
    const result = await storage.acceptFriend(id, accepterId);
    if (!result) {
      res.status(404).json({ message: "Friend request not found", code: "FRIEND_REQUEST_NOT_FOUND" });
      return;
    }
    const accepter = await storage.getUser(accepterId);
    const requesterId = result.requesterId;

    emitToUser(requesterId, "friend:request_accepted", {
      by: accepter?.username ?? "Qualcuno",
    });

    if (isUserOnline(accepterId)) {
      emitToUser(requesterId, "friend:status", { userId: accepterId, online: true });
    }
    if (isUserOnline(requesterId)) {
      emitToUser(accepterId, "friend:status", { userId: requesterId, online: true });
    }

    res.json({ ok: true });
  });

  app.post("/api/friends/decline/:id", requireAuth, async (req, res) => {
    const id = readParam(res, req.params.id);
    if (id === null) return;
    // Only the recipient can decline (IDOR: any user could destroy any
    // pending request by id).
    const declined = await storage.declineFriendRequest(id, req.session.userId!);
    if (!declined) {
      res.status(404).json({ message: "Friend request not found", code: "FRIEND_REQUEST_NOT_FOUND" });
      return;
    }
    res.json({ ok: true });
  });

  app.delete("/api/friends/:friendUserId", requireAuth, async (req, res) => {
    const friendUserId = readParam(res, req.params.friendUserId);
    if (friendUserId === null) return;
    await storage.removeFriend(req.session.userId!, friendUserId);
    res.json({ ok: true });
  });

  // ── Stats / history / achievements ──────────────────────────────────────

  app.get("/api/stats/me", requireAuth, async (req, res) => {
    const stats = await getUserStats(req.session.userId!);
    res.json(stats);
  });

  app.get("/api/stats/history", requireAuth, async (req, res) => {
    const history = await getMatchHistory(req.session.userId!);
    res.json(history);
  });

  // ── Ranked ladder ─────────────────────────────────────────────────────────
  //
  // The season is derived from the clock on every read, so a month boundary
  // needs no job to cross: `getRating` seeds the new season from the previous
  // one and only writes when a rated hand actually finishes.
  app.get("/api/ratings/me", requireAuth, async (req, res) => {
    res.json(await getRating(req.session.userId!, new Date()));
  });

  // ── Admin ─────────────────────────────────────────────────────────────────
  //
  // Server-rendered on purpose. This is never part of the app bundle, so no
  // admin code reaches a player's browser (#103).
  app.get("/admin", requireAdmin, async (_req, res) => {
    try {
      const snapshot = await adminSnapshot(PROVISIONAL_GAMES);
      res.type("html").send(renderAdminPage(snapshot));
    } catch (err) {
      logger.error({ err }, "Failed to build the admin snapshot");
      res.status(500).type("text/plain").send("Snapshot failed");
    }
  });

  app.get("/api/ratings/leaderboard", requireAuth, async (_req, res) => {
    res.json(await getLeaderboard(new Date()));
  });

  // ── Replays ───────────────────────────────────────────────────────────────
  //
  // Both reads are scoped to the caller's own seats: the query filters on
  // player_ids, so an id lifted from somewhere else returns 404 rather than a
  // stranger's game. A replay holds no hand, only what was played.
  app.get("/api/replays", requireAuth, async (req, res) => {
    res.json(await listReplaysForUser(req.session.userId!));
  });

  app.get("/api/replays/:id", requireAuth, async (req, res) => {
    const id = readParam(res, req.params.id);
    if (id === null) return;
    const replay = await getReplayForUser(id, req.session.userId!);
    if (!replay) {
      res.status(404).json({ message: "Replay not found", code: "REPLAY_NOT_FOUND" });
      return;
    }
    res.json(replay);
  });

  // ── Client crash reports ──────────────────────────────────────────────────
  //
  // In-house rather than a third-party crash SDK: any such SDK is a data
  // processor, which changes the App Store privacy answers and adds a
  // dependency that runs in every session. This writes to the log the server
  // already has, so a crash on a device is visible wherever the server's
  // output is read.
  //
  // Authenticated on purpose. An open endpoint is an open log-injection
  // vector, and a crash worth chasing is one a real account hit.
  app.post(
    "/api/client-errors",
    requireAuth,
    errorReportLimiter,
    validate(ClientErrorSchema),
    (req, res) => {
      const report = req.body as {
        message: string;
        stack?: string;
        componentStack?: string;
        platform?: string;
        appVersion?: string;
      };
      logger.error(
        { userId: req.session.userId, clientError: report },
        "Client reported an unhandled error"
      );
      // Also kept as a row, so the owner can read it on /admin later rather
      // than only in the log stream. Fire-and-forget: a crash report failing
      // to store must not turn into a second failure for a client that is
      // already showing its error screen.
      void recordClientError({
        userId: req.session.userId ?? null,
        message: report.message,
        stack: report.stack,
        screen: report.componentStack,
        platform: report.platform,
        appVersion: report.appVersion,
      }).catch((err) => logger.error({ err }, "Failed to store a client error report"));
      // Nothing to say back. The client is already showing its error screen and
      // must not depend on this having worked.
      res.status(204).end();
    }
  );

  app.get("/api/stats/achievements", requireAuth, async (req, res) => {
    const achievements = await getUserAchievements(req.session.userId!);
    res.json(achievements);
  });

  const httpServer = createServer(app);
  return httpServer;
}
