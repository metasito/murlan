import type { Request } from "express";
import bcrypt from "bcryptjs";
import type { User } from "../../shared/schema.ts";
import type { SessionUserDto } from "../../shared/http.ts";
import { revokeAccountSockets } from "../socket/socketRegistry.ts";

export function sessionUser(user: User): SessionUserDto {
  return {
    id: user.id,
    username: user.username,
    tutorialSeenAt: user.tutorialSeenAt ? user.tutorialSeenAt.toISOString() : null,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

export class SignInError extends Error {
  readonly stage: "regenerate" | "save";

  constructor(stage: "regenerate" | "save", cause: unknown) {
    super(`Session ${stage} failed`, { cause });
    this.stage = stage;
  }
}

/**
 * Regenerates the session, revokes the prior session's sockets (not awaited), sets userId and
 * saves. Regenerating gives the account a fresh session id instead of writing into whatever
 * session the request already carried — otherwise an attacker who planted a cookie on this origin
 * before the victim signed in would inherit their session.
 *
 * Rejects with a SignInError naming the stage that failed; nothing is sent either way, so the
 * caller decides the reply and anything that must follow it.
 */
export function signIn(req: Request, userId: string): Promise<void> {
  const prior = { userId: req.session.userId, sid: req.sessionID };
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenErr) => {
      if (regenErr) return reject(new SignInError("regenerate", regenErr));
      if (prior.userId) void revokeAccountSockets(prior.userId, { onlySid: prior.sid });
      req.session.userId = userId;
      req.session.save((saveErr) => {
        if (saveErr) return reject(new SignInError("save", saveErr));
        resolve();
      });
    });
  });
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
