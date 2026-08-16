import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { validate } from "./validate.ts";
import { RegisterSchema, LoginSchema, AddFriendSchema, ClientErrorSchema } from "./schemas.ts";
import { insertUserSchema } from "../shared/schema.ts";
import { emitToUser, isUserOnline } from "./socket.ts";
import { mintSocketTicket } from "./ticket.ts";
import { getUserStats, getMatchHistory, getUserAchievements } from "./stats.ts";
import { getReplayForUser, listReplaysForUser } from "./replays.ts";
import { z } from "zod";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

// Every JSON error body below carries a stable machine-readable `code`
// alongside the existing Italian `message`/`error` text. The client
// localises by `code` (see lib/i18n.ts's `translateServerPayload`) and
// falls back to the plain-text Italian string if a code is ever unknown to
// it — the server does not keep its own copy of the translation table.
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
    res.status(400).json({ message: "Parametro non valido", code: "INVALID_PARAMETER" });
    return null;
  }
  return parsed.data;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppi tentativi, riprova tra 15 minuti.", code: "AUTH_RATE_LIMITED" },
});

const friendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Troppe richieste, rallenta.", code: "RATE_LIMITED" },
});

// One ticket per socket connection attempt, including every reconnect, so this
// has to tolerate a flapping mobile connection while still being bounded.
const ticketLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste, rallenta.", code: "RATE_LIMITED" },
});

// A crashing client can crash repeatedly. This is deliberately tight: enough
// to catch a crash loop starting, not enough for one device to flood the log.
const errorReportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste, rallenta.", code: "RATE_LIMITED" },
});

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.session.userId) {
    res.status(401).json({ message: "Non autenticato", code: "NOT_AUTHENTICATED" });
    return;
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {

  // ── Auth ──────────────────────────────────────────────────────────────────

  app.post("/api/auth/register", authLimiter, validate(RegisterSchema), async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };

    const existing = await storage.searchUserByUsername(username);
    if (existing) {
      res.status(409).json({ message: "Username già in uso", code: "USERNAME_TAKEN" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await storage.createUser({ username, password: passwordHash });

    req.session.userId = user.id;
    req.session.save(async (err) => {
      if (err) {
        // The account exists but the caller has no session and sees an error,
        // so the username would be permanently taken by an account nobody can
        // reach. Roll it back so they can retry.
        logger.error({ err }, "Session save failed on register");
        await storage.deleteUser(user.id).catch((cleanupErr) =>
          logger.error({ cleanupErr, userId: user.id }, "Failed to roll back orphaned registration")
        );
        res.status(500).json({ message: "Errore interno del server", code: "INTERNAL_SERVER_ERROR" });
        return;
      }
      logger.info({ userId: user.id, username }, "User registered");
      res.json({ id: user.id, username: user.username });
    });
  });

  app.post("/api/auth/login", authLimiter, validate(LoginSchema), async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };

    const user = await storage.getUserByUsername(username);
    if (!user) {
      res.status(401).json({ message: "Username o password errati", code: "INVALID_CREDENTIALS" });
      return;
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      res.status(401).json({ message: "Username o password errati", code: "INVALID_CREDENTIALS" });
      return;
    }

    req.session.userId = user.id;
    req.session.save((err) => {
      if (err) {
        logger.error({ err }, "Session save failed on login");
        res.status(500).json({ message: "Errore interno del server", code: "INTERNAL_SERVER_ERROR" });
        return;
      }
      logger.info({ userId: user.id, username }, "User logged in");
      res.json({ id: user.id, username: user.username });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      res.status(401).json({ message: "Non autenticato", code: "NOT_AUTHENTICATED" });
      return;
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      res.status(401).json({ message: "Utente non trovato", code: "USER_NOT_FOUND" });
      return;
    }
    res.json({ id: user.id, username: user.username });
  });

  // Mints the short-lived, single-use ticket the socket handshake accepts in
  // place of a session cookie (native clients do not send cookies on upgrade).
  app.post("/api/auth/socket-ticket", requireAuth, ticketLimiter, (req, res) => {
    const { ticket, expiresAt } = mintSocketTicket(req.session.userId!);
    res.json({ ticket, expiresAt });
  });

  // ── User ─────────────────────────────────────────────────────────────────

  app.delete("/api/users/me", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteUser(userId);
      req.session.destroy(() => {});
      logger.info({ userId }, "User account deleted");
      res.json({ message: "Account eliminato con successo", code: "ACCOUNT_DELETED" });
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
      res.status(400).json({ message: "Username non valido", code: "INVALID_USERNAME" });
      return;
    }
    const found = await storage.searchUserByUsername(username.data);
    if (!found || found.id === req.session.userId) {
      res.status(404).json({ message: "Utente non trovato", code: "USER_NOT_FOUND" });
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

    const friend = await storage.searchUserByUsername(username);
    if (!friend) {
      res.status(404).json({ message: "Utente non trovato", code: "USER_NOT_FOUND" });
      return;
    }

    if (friend.id === req.session.userId) {
      res.status(400).json({ message: "Non puoi aggiungere te stesso", code: "CANNOT_ADD_SELF" });
      return;
    }

    const already = await storage.areFriends(req.session.userId!, friend.id);
    if (already) {
      res.status(409).json({ message: "Siete già amici", code: "ALREADY_FRIENDS" });
      return;
    }

    const pending = await storage.hasPendingRequest(req.session.userId!, friend.id);
    if (pending) {
      res.status(409).json({ message: "Richiesta di amicizia già inviata", code: "FRIEND_REQUEST_ALREADY_SENT" });
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
      res.status(404).json({ message: "Richiesta non trovata", code: "FRIEND_REQUEST_NOT_FOUND" });
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
      res.status(404).json({ message: "Richiesta non trovata", code: "FRIEND_REQUEST_NOT_FOUND" });
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
      res.status(404).json({ message: "Richiesta non trovata", code: "FRIEND_REQUEST_NOT_FOUND" });
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
      res.status(404).json({ message: "Replay non trovato", code: "REPLAY_NOT_FOUND" });
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
