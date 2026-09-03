import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { storage, UsernameTakenError, EmailTakenError } from "./storage.ts";
import { friendRequestRow, friendRow } from "./friendRows.ts";
import type { FriendRequestAccepted, FriendRequestIncoming } from "../lib/wire.ts";
import type { User } from "../shared/schema.ts";
import { logger } from "./logger.ts";
import { validate } from "./validate.ts";
import {
  RegisterSchema,
  RenameSchema,
  LoginSchema,
  ChangePasswordSchema,
  AddEmailSchema,
  VerifyEmailSchema,
  RequestPasswordResetSchema,
  ResetPasswordSchema,
  AddFriendSchema,
  ClientErrorSchema,
  PushTokenSchema,
  BugReportSchema,
} from "./schemas.ts";
import { deletePushToken, savePushToken } from "./push.ts";
import { DEFAULT_LOCALE, translate, type Locale } from "../shared/i18n.ts";
import { emitToUser, evictUser, isUserOnline } from "./socket.ts";
import { mintSocketTicket } from "./ticket.ts";
import {
  mintAuthToken,
  redeemAuthToken,
  invalidateAuthTokens,
  EMAIL_VERIFY_TOKEN_TTL_MS,
  PASSWORD_RESET_TOKEN_TTL_MS,
} from "./authTokens.ts";
import { sendMail } from "./mail.ts";
import { getUserStats, getUserAchievements } from "./stats.ts";
import { getMatchHistoryView } from "./matchHistoryView.ts";
import { getReplayForUser, listReplaysForUser } from "./replays.ts";
import { getLeaderboard, getRating, PROVISIONAL_GAMES } from "./ratings.ts";
import { recordClientError } from "./clientErrors.ts";
import { recordBugReport } from "./bugReports.ts";
import { adminSnapshot } from "./admin.ts";
import { trackEvent } from "./events.ts";
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
 *
 * Raised from the old 20: this is now a broad per-IP backstop shared by
 * register and login (#41) rather than login's only defense, so it has to
 * clear a whole office or carrier NAT's worth of normal traffic in a window
 * without tripping. What actually bounds one account's login attempts is
 * loginUsernameMaxFromEnv() below.
 */
function authMaxFromEnv(): number {
  const parsed = Number(process.env.MURLAN_AUTH_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 100;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: authMaxFromEnv(),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, try again in 15 minutes.", code: "AUTH_RATE_LIMITED" },
});

/**
 * A rename with no ceiling is how one account cycles through names to impersonate others between
 * games. Keyed on the account rather than the address, because the address is shared by everyone
 * behind a household NAT and the limit is about the account's behaviour.
 *
 * A limiter rather than a `usernameChangedAt` column: `CLAUDE.md` orders a change by design, and
 * a column is the last resort. A player-visible "you can change this again in N days" would need
 * one, and that is its own ticket.
 */
const renameLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: renameMaxFromEnv(),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.session?.userId ?? "anonymous",
  message: { message: "Too many name changes, try again tomorrow.", code: "RENAME_RATE_LIMITED" },
});

/** Same pattern as authMaxFromEnv() above. */
function renameMaxFromEnv(): number {
  const parsed = Number(process.env.MURLAN_RENAME_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

/** Same pattern as authMaxFromEnv() above. */
function loginUsernameMaxFromEnv(): number {
  const parsed = Number(process.env.MURLAN_LOGIN_USERNAME_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
}

// Never a real user's hash — exists only so the limiter below can spend
// bcrypt.compare's cost without a real password to check. Sync and at
// module scope: it runs once, at startup, not on any request path.
const LOGIN_LIMIT_DECOY_HASH = bcrypt.hashSync("murlan-rate-limit-timing-decoy", 10);

/**
 * Per-account login attempts (#41) — express-rate-limit's own `authLimiter`
 * above is a per-IP ceiling shared with register and sized for a whole
 * office; this is the thing that actually makes one account's password hard
 * to guess. Keyed on the same normalized username storage.getUserByUsername
 * looks up by, so case doesn't fork one account into two budgets.
 *
 * skipSuccessfulRequests: a correct login must never spend down the budget a
 * wrong one does — otherwise a user who logs in from several devices a day
 * could lock themselves out with no failed attempt in sight.
 *
 * The response on trip is deliberately not express-rate-limit's default: it
 * has to be byte-for-byte the wrong-password response below, including its
 * timing. Skipping straight to a 401 would return faster than a real
 * bcrypt.compare does, and that gap is itself an oracle — a request that
 * comes back suspiciously fast is one this account's password was never
 * checked against, which tells an attacker they've already exhausted the
 * account's real guesses. Paying a decoy bcrypt.compare closes that gap; see
 * #41's PR description for the measurement.
 */
const loginUsernameLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: loginUsernameMaxFromEnv(),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => (req.body as { username: string }).username.toLowerCase(),
  handler: async (_req, res) => {
    await bcrypt.compare("x", LOGIN_LIMIT_DECOY_HASH);
    res.status(401).json({ message: "Wrong username or password", code: "INVALID_CREDENTIALS" });
  },
});

/** Same pattern as authMaxFromEnv() above. */
function passwordResetRequestMaxFromEnv(): number {
  const parsed = Number(process.env.MURLAN_PASSWORD_RESET_REQUEST_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

/**
 * Per-email cap for POST /api/auth/request-password-reset (design doc,
 * Box 4) — mirrors loginUsernameLimiter's per-account shape, keyed on the
 * same case-insensitive form storage.getUserByEmail looks up by. Unlike
 * loginUsernameLimiter, tripping this is not itself an oracle: the key is
 * whatever address the caller submitted, so a nonexistent address is
 * throttled on the identical schedule a real one is.
 */
const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: passwordResetRequestMaxFromEnv(),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req.body as { email: string }).email.toLowerCase(),
  message: { error: "Too many requests, slow down.", code: "RATE_LIMITED" },
});

/** Same pattern as authMaxFromEnv() above. */
function resetPasswordMaxFromEnv(): number {
  const parsed = Number(process.env.MURLAN_RESET_PASSWORD_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 20;
}

/**
 * POST /api/auth/reset-password's only bound (design doc, Box 4) — the
 * token's 256 bits of entropy is the real defense against guessing it, so
 * this is a modest per-IP cap against automated scanning, mirroring
 * ticketLimiter's shape rather than authLimiter's numbers or
 * loginUsernameLimiter's per-account precision, which this route has no
 * username to key on.
 */
const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: resetPasswordMaxFromEnv(),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down.", code: "RATE_LIMITED" },
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
  // Keyed by account, like the limiter above. The default key is the IP, and
  // a whole shared network — an office, a carrier NAT — then shares five
  // reports a minute: during the crash wave that makes reports worth having,
  // one device silences every other. The route is requireAuth, so there is
  // always a userId to key on. Compare #41, where login has no such option.
  keyGenerator: (req: Request) => req.session?.userId ?? "anonymous",
  message: { error: "Too many requests, slow down.", code: "RATE_LIMITED" },
});

// Everything a signed-in client is told about itself, from the one place, so
// register, login and /me cannot answer the same question differently.
function sessionUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    tutorialSeenAt: user.tutorialSeenAt ? user.tutorialSeenAt.toISOString() : null,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

/** Never awaited by a caller — a provider outage must not delay or fail the response it rides with. */
function sendVerificationEmail(to: string, token: string): void {
  sendMail(
    to,
    "Verify your Murlan email",
    `Your Murlan email verification code is:\n\n${token}\n\nThis code expires in 24 hours.`
  ).catch((err) => logger.error({ err, to }, "sendVerificationEmail failed"));
}

/**
 * Never awaited by its caller (design doc, Box 5) — the enumeration-safe
 * request-password-reset handler replies before this settles, so the only
 * work the response waits on is the token mint, not the outbound HTTPS call.
 */
function sendPasswordResetEmail(to: string, token: string): void {
  sendMail(
    to,
    "Reset your Murlan password",
    `Your Murlan password reset code is:\n\n${token}\n\nThis code expires in 30 minutes. ` +
      `If you did not request this, you can ignore this email.`
  ).catch((err) => logger.error({ err, to }, "sendPasswordResetEmail failed"));
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
async function rollbackRegistration(req: Request, userId: string, res: Response) {
  await storage.deleteUser(userId).catch((cleanupErr) =>
    logger.error({ cleanupErr, userId }, "Failed to roll back orphaned registration")
  );
  // express-session retries the save at `res.end` for as long as a session is
  // attached, and the save is what just failed.
  await new Promise<void>((resolve) =>
    req.session.destroy((destroyErr) => {
      if (destroyErr) logger.error({ destroyErr, userId }, "Failed to drop the session after a failed registration");
      resolve();
    })
  );
  res.status(500).json({ message: "Internal server error", code: "INTERNAL_SERVER_ERROR" });
}

export async function registerRoutes(app: Express): Promise<Server> {

  // ── Auth ──────────────────────────────────────────────────────────────────

  app.post("/api/auth/register", authLimiter, validate(RegisterSchema), async (req, res) => {
    const { username, password, email } = req.body as { username: string; password: string; email: string };

    const existingUsername = await storage.getUserByUsername(username);
    if (existingUsername) {
      res.status(409).json({ message: "Username already taken", code: "USERNAME_TAKEN" });
      return;
    }
    const existingEmail = await storage.getUserByEmail(email);
    if (existingEmail) {
      res.status(409).json({ message: "Email already registered", code: "EMAIL_TAKEN" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await storage.createUser({ username, password: passwordHash, email });
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        res.status(409).json({ message: "Username already taken", code: "USERNAME_TAKEN" });
        return;
      }
      if (err instanceof EmailTakenError) {
        res.status(409).json({ message: "Email already registered", code: "EMAIL_TAKEN" });
        return;
      }
      throw err;
    }

    // A provider outage must not block signup — mint and fire without
    // awaiting the send, and never let it fail the response.
    try {
      const token = await mintAuthToken(user.id, "email_verify", EMAIL_VERIFY_TOKEN_TTL_MS);
      sendVerificationEmail(email, token);
    } catch (err) {
      logger.error({ err, userId: user.id }, "Failed to mint the verification token");
    }

    // Regenerating gives the new account a fresh session id instead of writing
    // into whatever session the registration request already carried —
    // otherwise an attacker who planted a cookie on this origin before the
    // victim signed up would inherit their session.
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error({ err: regenErr }, "Session regenerate failed on register");
        void rollbackRegistration(req, user.id, res);
        return;
      }
      req.session.userId = user.id;
      req.session.save((err) => {
        if (err) {
          logger.error({ err }, "Session save failed on register");
          void rollbackRegistration(req, user.id, res);
          return;
        }
        logger.info({ userId: user.id, username }, "User registered");
        res.json(sessionUser(user));
      });
    });
  });

  app.post("/api/auth/login", authLimiter, validate(LoginSchema), loginUsernameLimiter, async (req, res) => {
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
    await deletePushToken(req.session.userId!, (req.body as { token: string }).token);
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

  // A live session alone is not proof of intent to change a credential —
  // mirrors login's own bcrypt.compare, and answers a wrong currentPassword
  // with the same generic code login does, so the two are indistinguishable.
  app.post("/api/auth/change-password", requireAuth, validate(ChangePasswordSchema), async (req, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const userId = req.session.userId!;

    const user = await storage.getUser(userId);
    if (!user) {
      res.status(401).json({ message: "Not authenticated", code: "NOT_AUTHENTICATED" });
      return;
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      res.status(401).json({ message: "Wrong username or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await storage.changePassword(userId, passwordHash, req.sessionID);
    logger.info({ userId }, "Password changed");
    res.json({ ok: true });
  });

  // #863: the existing-beta-cohort nudge (docs/superpowers/specs/2026-09-03-
  // account-recovery-design.md, Box 1). Reuses the signup flow's own
  // machinery — mint an email_verify token, send it through sendVerificationEmail
  // — rather than a second one; redemption still goes through the
  // verify-email route below. `email IS NULL` is re-checked here (not just by
  // the profile card that hides once it isn't) because the check and the
  // write below are not one transaction, and this is an authenticated
  // account overwriting its own row, not a public lookup.
  app.post("/api/auth/add-email", requireAuth, validate(AddEmailSchema), async (req, res) => {
    const { email } = req.body as { email: string };
    const userId = req.session.userId!;

    const existing = await storage.getUser(userId);
    if (!existing) {
      res.status(401).json({ message: "Not authenticated", code: "NOT_AUTHENTICATED" });
      return;
    }
    if (existing.email) {
      res.status(409).json({ message: "Email already set", code: "EMAIL_ALREADY_SET" });
      return;
    }

    let user;
    try {
      user = await storage.setEmail(userId, email);
    } catch (err) {
      if (err instanceof EmailTakenError) {
        res.status(409).json({ message: "Email already registered", code: "EMAIL_TAKEN" });
        return;
      }
      throw err;
    }

    const token = await mintAuthToken(userId, "email_verify", EMAIL_VERIFY_TOKEN_TTL_MS);
    sendVerificationEmail(email, token);
    logger.info({ userId }, "Email added, pending verification");
    res.json(sessionUser(user));
  });

  // Public: the token itself is the credential (server/authTokens.ts), not
  // the session. Generic failure message — whether the token is unknown,
  // expired or already used is not this caller's business, and the redeem
  // itself is the account oracle to avoid distinguishing.
  app.post("/api/auth/verify-email", validate(VerifyEmailSchema), async (req, res) => {
    const { token } = req.body as { token: string };
    const userId = await redeemAuthToken(token, "email_verify");
    if (!userId) {
      res.status(400).json({ message: "Invalid or expired verification link", code: "INVALID_TOKEN" });
      return;
    }
    await storage.markEmailVerified(userId);
    logger.info({ userId }, "Email verified");
    res.json({ ok: true });
  });

  // Enumeration-safe by design (docs/superpowers/specs/2026-09-03-account-
  // recovery-design.md, Box 5): identical 200 { ok: true } whether or not
  // the address matches a verified account, and the response is sent
  // before the mail provider is ever called — only the token mint (an
  // indexed lookup plus one insert) happens before the reply, so the two
  // branches cost the same up to that point. An unverified email is
  // deliberately treated the same as no account at all: verified-email is
  // load-bearing here, not a formality (an unverified address that could
  // reset is registration-then-takeover of someone else's account).
  app.post(
    "/api/auth/request-password-reset",
    authLimiter,
    validate(RequestPasswordResetSchema),
    passwordResetRequestLimiter,
    async (req, res) => {
      const { email } = req.body as { email: string };
      const user = await storage.getUserByEmail(email);
      if (user && user.emailVerifiedAt) {
        const token = await mintAuthToken(user.id, "password_reset", PASSWORD_RESET_TOKEN_TTL_MS);
        res.json({ ok: true });
        sendPasswordResetEmail(user.email!, token);
        return;
      }
      res.json({ ok: true });
    }
  );

  // Public: the token itself is the credential, same as verify-email above.
  // One generic failure for unknown/expired/used/unverified alike — which of
  // those it was is not this caller's business.
  app.post(
    "/api/auth/reset-password",
    resetPasswordLimiter,
    validate(ResetPasswordSchema),
    async (req, res) => {
      const { token, newPassword } = req.body as { token: string; newPassword: string };
      const userId = await redeemAuthToken(token, "password_reset");
      const user = userId ? await storage.getUser(userId) : undefined;
      if (!user?.emailVerifiedAt) {
        res.status(400).json({ message: "Invalid or expired reset link", code: "INVALID_RESET_TOKEN" });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await storage.resetPassword(user.id, passwordHash);
      // The token this request redeemed is already used_at-stamped; this
      // only reaches its unredeemed siblings (design doc, Box 2) — the same
      // "live credential" class as the sessions storage.resetPassword just
      // cleared, and for the same reason.
      await invalidateAuthTokens(user.id, "password_reset");
      logger.info({ userId: user.id }, "Password reset");
      res.json({ ok: true });
    }
  );

  // Mints the short-lived, single-use ticket the socket handshake accepts in
  // place of a session cookie (native clients do not send cookies on upgrade).
  app.post("/api/auth/socket-ticket", requireAuth, ticketLimiter, (req, res) => {
    const { ticket, expiresAt } = mintSocketTicket(req.session.userId!);
    res.json({ ticket, expiresAt });
  });

  // ── User ─────────────────────────────────────────────────────────────────

  // Nothing stores a username as history: `matchHistory.userId`, `replays.playerIds` and every
  // stats, rating and friends table key on the id, so each read projects whatever the name is
  // now. A rename is one column, with no backfill behind it.
  //
  // Seated players keep the name the room was joined under — rewriting live room state mid-hand
  // would change an opponent's name under the other players for no benefit. The table catches up
  // when the player next sits down.
  // Validation before the limiter: a body that fails the rule never renamed anything, and the
  // budget is there to bound name *cycling*. Spending it on typos would lock a player out of a
  // rename they never made.
  app.patch("/api/users/me", requireAuth, validate(RenameSchema), renameLimiter, async (req, res) => {
    const userId = req.session.userId!;
    const { username } = req.body as { username: string };

    // Case-insensitively, by `users_username_lower_uq`. Comparing ids rather than names is what
    // lets a player recase their own: that lookup finds their own row.
    const holder = await storage.getUserByUsername(username);
    if (holder && holder.id !== userId) {
      res.status(409).json({ message: "Username already taken", code: "USERNAME_TAKEN" });
      return;
    }

    try {
      const user = await storage.renameUser(userId, username);
      logger.info({ userId, username }, "User renamed");
      res.json(sessionUser(user));
    } catch (err) {
      // The check above and this write are not one transaction, so the name can be claimed in
      // between. The constraint is the authority; the check only makes the common case a clean 409.
      if (!(err instanceof UsernameTakenError)) throw err;
      res.status(409).json({ message: "Username already taken", code: "USERNAME_TAKEN" });
    }
  });

  app.post("/api/users/me/tutorial-seen", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    // Only the first transition is a funnel step. This endpoint is also the
    // catch-up write app/index.tsx makes when the device knows and the account
    // does not, and counting that would report one player opening the tutorial
    // once per phone they own.
    const before = await storage.getUser(userId);
    await storage.markTutorialSeen(userId);
    if (before && !before.tutorialSeenAt) trackEvent("tutorial.started", userId);
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
      res.status(500).json({
        error: translate(DEFAULT_LOCALE, "server.ACCOUNT_DELETE_FAILED"),
        code: "ACCOUNT_DELETE_FAILED",
      });
    }
  });

  // ── Friends ───────────────────────────────────────────────────────────────

  app.get("/api/friends", requireAuth, async (req, res) => {
    const friends = await storage.getFriends(req.session.userId!);
    res.json(friends.map((f) => friendRow(f.friend)));
  });

  app.get("/api/friends/requests", requireAuth, async (req, res) => {
    const requests = await storage.getPendingFriendRequests(req.session.userId!);
    res.json(requests.map((r) => friendRequestRow(r, r.requester)));
  });

  // The invites a socket would have announced. This is the half that survives
  // the recipient being away — the emit and the push are both "look now".
  app.get("/api/friends/invites", requireAuth, async (req, res) => {
    res.json(await storage.getGameInvites(req.session.userId!));
  });

  app.delete("/api/friends/invites/:roomCode", requireAuth, async (req, res) => {
    const roomCode = z.string().length(6).safeParse(String(req.params.roomCode ?? "").toUpperCase());
    if (!roomCode.success) {
      res.status(400).json({ message: "Invalid room code", code: "INVALID_ROOM_CODE" });
      return;
    }
    await storage.declineGameInvite(req.session.userId!, roomCode.data);
    res.json({ ok: true });
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
    res.json(sent.map((r) => friendRequestRow(r, r.recipient)));
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

    const pending = await storage.pendingRequestBetween(req.session.userId!, friend.id);
    if (pending === "sent") {
      res.status(409).json({ message: "Friend request already sent", code: "FRIEND_REQUEST_ALREADY_SENT" });
      return;
    }
    if (pending === "received") {
      res.status(409).json({
        message: "They already sent you a request — accept it instead",
        code: "FRIEND_REQUEST_INCOMING_PENDING",
      });
      return;
    }

    const sender = await storage.getUser(req.session.userId!);
    const request = await storage.addFriend(req.session.userId!, friend.id);

    // The row travels with the announcement: the recipient's cache holds the
    // request on the frame the banner goes up, rather than seconds later when
    // the fetch the invalidation started comes back.
    emitToUser(friend.id, "friend:request_incoming", {
      from: sender?.username ?? "Qualcuno",
      request: sender && request ? friendRequestRow(request, sender) : undefined,
    } satisfies FriendRequestIncoming);

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
      friend: accepter ? friendRow(accepter) : undefined,
    } satisfies FriendRequestAccepted);

    if (await isUserOnline(accepterId)) {
      emitToUser(requesterId, "friend:status", { userId: accepterId, online: true });
    }
    if (await isUserOnline(requesterId)) {
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
    const history = await getMatchHistoryView(req.session.userId!);
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
        screen?: string;
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
        // The route, not the component stack. That stack is a render-only
        // detail and now rides in `context`, so `screen` means what it says
        // for a rejected promise as much as for a caught render.
        screen: report.screen,
        platform: report.platform,
        appVersion: report.appVersion,
        context: report.componentStack ? { componentStack: report.componentStack } : {},
      }).catch((err) => logger.error({ err }, "Failed to store a client error report"));
      // Nothing to say back. The client is already showing its error screen and
      // must not depend on this having worked.
      res.status(204).end();
    }
  );

  // Authenticated and rate-limited for the same reasons as the route above:
  // an open endpoint taking arbitrary text is a log-injection and abuse
  // surface, and a report worth reading is one a real account sent.
  //
  // Unlike a crash report this one is awaited and answered. The player pressed
  // send and is owed an outcome — a banner saying it arrived is the whole
  // feedback loop, and a fire-and-forget write would make that banner a lie.
  app.post(
    "/api/bug-reports",
    requireAuth,
    errorReportLimiter,
    validate(BugReportSchema),
    async (req, res) => {
      const report = req.body as {
        description: string;
        screen?: string;
        appVersion?: string;
        platform?: string;
        locale?: string;
      };
      try {
        await recordBugReport({ userId: req.session.userId!, ...report });
        res.status(201).json({ ok: true });
      } catch (err) {
        logger.error({ err, userId: req.session.userId }, "Failed to store a bug report");
        res.status(500).json({
          error: translate(DEFAULT_LOCALE, "server.INTERNAL_SERVER_ERROR"),
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    }
  );

  app.get("/api/stats/achievements", requireAuth, async (req, res) => {
    const achievements = await getUserAchievements(req.session.userId!);
    res.json(achievements);
  });

  const httpServer = createServer(app);
  return httpServer;
}
