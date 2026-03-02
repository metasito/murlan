import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { logger } from "./logger";
import { validate } from "./validate";
import { RegisterSchema, LoginSchema, AddFriendSchema } from "./schemas";
import { insertUserSchema } from "@shared/schema";
import { emitToUser } from "./socket";
import { z } from "zod";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppi tentativi, riprova tra 15 minuti." },
});

const friendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Troppe richieste, rallenta." },
});

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.session.userId) {
    res.status(401).json({ message: "Non autenticato" });
    return;
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {

  // ── Auth ──────────────────────────────────────────────────────────────────

  app.post("/api/auth/register", authLimiter, validate(RegisterSchema), async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };

    const existing = await storage.getUserByUsername(username);
    if (existing) {
      res.status(409).json({ message: "Username già in uso" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await storage.createUser({ username, password: passwordHash });

    req.session.userId = user.id;
    logger.info({ userId: user.id, username }, "User registered");
    res.json({ id: user.id, username: user.username, friendCode: user.friendCode });
  });

  app.post("/api/auth/login", authLimiter, validate(LoginSchema), async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };

    const user = await storage.getUserByUsername(username);
    if (!user) {
      res.status(401).json({ message: "Username o password errati" });
      return;
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      res.status(401).json({ message: "Username o password errati" });
      return;
    }

    req.session.userId = user.id;
    logger.info({ userId: user.id, username }, "User logged in");
    res.json({ id: user.id, username: user.username, friendCode: user.friendCode });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      res.status(401).json({ message: "Non autenticato" });
      return;
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      res.status(401).json({ message: "Utente non trovato" });
      return;
    }
    res.json({ id: user.id, username: user.username, friendCode: user.friendCode });
  });

  // ── User ─────────────────────────────────────────────────────────────────

  app.delete("/api/users/me", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteUser(userId);
      req.session.destroy(() => {});
      logger.info({ userId }, "User account deleted");
      res.json({ message: "Account eliminato con successo" });
    } catch (err) {
      logger.error({ err }, "Delete user failed");
      res.status(500).json({ error: "Eliminazione fallita" });
    }
  });

  // ── Friends ───────────────────────────────────────────────────────────────

  app.get("/api/friends", requireAuth, async (req, res) => {
    const friends = await storage.getFriends(req.session.userId!);
    res.json(friends.map((f) => ({
      id: f.friend.id,
      username: f.friend.username,
      friendCode: f.friend.friendCode,
      lastSeen: f.friend.lastSeen ? f.friend.lastSeen.toISOString() : null,
    })));
  });

  app.get("/api/friends/requests", requireAuth, async (req, res) => {
    const requests = await storage.getPendingFriendRequests(req.session.userId!);
    res.json(requests.map((r) => ({
      id: r.id,
      username: r.requester.username,
      friendCode: r.requester.friendCode,
    })));
  });

  app.post("/api/friends/add", requireAuth, friendLimiter, validate(AddFriendSchema), async (req, res) => {
    const { friendCode } = req.body as { friendCode: string };

    const friend = await storage.getUserByFriendCode(friendCode);
    if (!friend) {
      res.status(404).json({ message: "Nessun giocatore trovato con questo codice" });
      return;
    }
    if (friend.id === req.session.userId) {
      res.status(400).json({ message: "Non puoi aggiungere te stesso" });
      return;
    }

    const already = await storage.areFriends(req.session.userId!, friend.id);
    if (already) {
      res.status(409).json({ message: "Siete già amici" });
      return;
    }

    const pending = await storage.hasPendingRequest(req.session.userId!, friend.id);
    if (pending) {
      res.status(409).json({ message: "Richiesta di amicizia già inviata" });
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

  app.post("/api/friends/accept/:id", requireAuth, async (req, res) => {
    const id = z.string().parse(req.params.id);
    const result = await storage.acceptFriend(id);
    if (result) {
      const accepter = await storage.getUser(req.session.userId!);
      emitToUser(result.requesterId, "friend:request_accepted", {
        by: accepter?.username ?? "Qualcuno",
      });
    }
    res.json({ ok: true });
  });

  app.post("/api/friends/decline/:id", requireAuth, async (req, res) => {
    const id = z.string().parse(req.params.id);
    await storage.declineFriendRequest(id);
    res.json({ ok: true });
  });

  app.delete("/api/friends/:friendUserId", requireAuth, async (req, res) => {
    const friendUserId = z.string().parse(req.params.friendUserId);
    await storage.removeFriend(req.session.userId!, friendUserId);
    res.json({ ok: true });
  });

  const httpServer = createServer(app);
  return httpServer;
}
