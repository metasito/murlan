import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { insertUserSchema } from "@shared/schema";
import { emitToUser } from "./socket";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.session.userId) {
    res.status(401).json({ message: "Non autenticato" });
    return;
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {

  // ── Auth ──────────────────────────────────────────────────────────────────

  app.post("/api/auth/register", async (req, res) => {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Username e password richiesti" });
      return;
    }
    const { username, password } = parsed.data;

    if (username.length < 3 || username.length > 20) {
      res.status(400).json({ message: "Username deve essere tra 3 e 20 caratteri" });
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      res.status(400).json({ message: "Username può contenere solo lettere, numeri e _" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ message: "Password deve essere almeno 6 caratteri" });
      return;
    }

    const existing = await storage.getUserByUsername(username);
    if (existing) {
      res.status(409).json({ message: "Username già in uso" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await storage.createUser({ username, password: passwordHash });

    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username, friendCode: user.friendCode });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ message: "Username e password richiesti" });
      return;
    }

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
    res.json(requests.map((r) => ({ id: r.id, username: r.requester.username, friendCode: r.requester.friendCode })));
  });

  app.post("/api/friends/add", requireAuth, async (req, res) => {
    const { friendCode } = req.body as { friendCode?: string };
    if (!friendCode) {
      res.status(400).json({ message: "Codice amico richiesto" });
      return;
    }

    const friend = await storage.getUserByFriendCode(friendCode.toUpperCase());
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

    // Notify the target user in real time if they're online
    emitToUser(friend.id, "friend:request_incoming", {
      from: sender?.username ?? "Qualcuno",
    });

    res.json({ ok: true, username: friend.username });
  });

  app.post("/api/friends/accept/:id", requireAuth, async (req, res) => {
    const id = String(req.params.id);
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
    await storage.declineFriendRequest(String(req.params.id));
    res.json({ ok: true });
  });

  app.delete("/api/friends/:friendUserId", requireAuth, async (req, res) => {
    await storage.removeFriend(req.session.userId!, String(req.params.friendUserId));
    res.json({ ok: true });
  });

  const httpServer = createServer(app);
  return httpServer;
}
