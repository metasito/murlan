import type { NextFunction, Request, Response } from "express";
import type { User } from "../../shared/schema.ts";
import { userStore } from "../store/userStore.ts";
import { payload } from "../shared/payload.ts";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ ...payload("NOT_AUTHENTICATED") });
    return;
  }
  next();
}

/**
 * The owner, and nobody else. `requireAuth` alone is not enough here: this is
 * a new authenticated surface over everyone's data, not another player route.
 *
 * 404 rather than 403 for both the signed-out and the signed-in-but-not-owner
 * case, so the page's existence is not something an ordinary account can
 * confirm. It is not linked from the app bundle either.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  const user = await userStore.getUser(userId);
  if (!user?.isAdmin) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  next();
}

/** The signed-in account's row, or null after replying 401 NOT_AUTHENTICATED: its session outlived it. */
export async function loadUser(res: Response, userId: string): Promise<User | null> {
  const user = await userStore.getUser(userId);
  if (!user) {
    res.status(401).json({ ...payload("NOT_AUTHENTICATED") });
    return null;
  }
  return user;
}
