import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import type { User } from "../../../shared/schema.ts";
import {
  AddEmailSchema,
  ChangePasswordSchema,
  LoginSchema,
  RegisterSchema,
  RequestPasswordResetSchema,
  ResetPasswordSchema,
  VerifyEmailSchema,
} from "../../../shared/httpSchemas.ts";
import { routeLimiter } from "../rateLimit.ts";
import { on, onSignedIn } from "../mount.ts";
import { validate } from "../validate.ts";
import { loadUser } from "../access.ts";
import { hashPassword, sessionUser, signIn, SignInError } from "../accountSession.ts";
import { mailLocale, sendPasswordResetEmail, sendVerificationEmail } from "../accountMail.ts";
import { deleteUser } from "../deleteAccount.ts";
import { logger } from "../logger.ts";
import {
  mintAuthToken,
  redeemAuthToken,
  replaceEmailVerifyCode,
  redeemAuthCode,
  invalidateAuthTokens,
  EMAIL_VERIFY_CODE_TTL_MS,
  PASSWORD_RESET_TOKEN_TTL_MS,
} from "../authTokens.ts";
import { userStore, UsernameTakenError } from "../../store/userStore.ts";
import { deletePushToken } from "../../socket/push.ts";
import { revokeAccountSockets } from "../../socket/socketRegistry.ts";
import { mintSocketTicket } from "../../socket/ticket.ts";
import { payload } from "../../shared/payload.ts";

/**
 * An integration suite registers one throwaway account per seat and burns the
 * production budget in a few tables, which is what the env override exists
 * for — set before the app is imported, see tests/helpers/testServer.ts.
 *
 * Raised from the old 20: this is now a broad per-IP backstop shared by
 * register and login (#41) rather than login's only defense, so it has to
 * clear a whole office or carrier NAT's worth of normal traffic in a window
 * without tripping. What actually bounds one account's login attempts is
 * loginUsernameLimiter below.
 */
const authLimiter = routeLimiter({
  windowMs: 15 * 60 * 1000,
  defaultMax: 100,
  envVar: "MURLAN_AUTH_RATE_LIMIT",
  message: payload("AUTH_RATE_LIMITED"),
});

// Never a real user's hash — exists only so the limiter below can spend
// bcrypt.compare's cost without a real password to check. Sync and at
// module scope: it runs once, at startup, not on any request path.
const LOGIN_LIMIT_DECOY_HASH = bcrypt.hashSync("murlan-rate-limit-timing-decoy", 10);

/**
 * Per-account login attempts (#41), on top of `authLimiter`'s per-IP ceiling
 * shared with register. Keyed on the same normalized username
 * userStore.getUserByUsername looks up by, so case doesn't fork one account
 * into two budgets.
 *
 * The count lives in this process's memory: the real ceiling is the limit
 * times the instances serving, and a deploy resets it. Accepted (#1651, D7):
 * every guess still pays a bcrypt compare and the per-IP limiter, and a
 * shared store would add a write per attempt plus a fail-open-or-closed
 * choice during a database outage.
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
const loginUsernameLimiter = routeLimiter({
  windowMs: 15 * 60 * 1000,
  defaultMax: 10,
  envVar: "MURLAN_LOGIN_USERNAME_RATE_LIMIT",
  keyBy: "username",
  skipSuccessfulRequests: true,
  handler: async (_req, res) => {
    await bcrypt.compare("x", LOGIN_LIMIT_DECOY_HASH);
    res.status(401).json({ ...payload("INVALID_CREDENTIALS") });
  },
});

/**
 * Per-email cap for POST /api/auth/request-password-reset (design doc,
 * Box 4) — mirrors loginUsernameLimiter's per-account shape, keyed on the
 * same case-insensitive form userStore.getUserByEmail looks up by. Unlike
 * loginUsernameLimiter, tripping this is not itself an oracle: the key is
 * whatever address the caller submitted, so a nonexistent address is
 * throttled on the identical schedule a real one is.
 */
const passwordResetRequestLimiter = routeLimiter({
  windowMs: 15 * 60 * 1000,
  defaultMax: 5,
  envVar: "MURLAN_PASSWORD_RESET_REQUEST_RATE_LIMIT",
  keyBy: "email",
  message: payload("RATE_LIMITED"),
});

/**
 * POST /api/auth/reset-password's only bound (design doc, Box 4) — the
 * token's 256 bits of entropy is the real defense against guessing it, so
 * this is a modest per-IP cap against automated scanning, mirroring
 * ticketLimiter's shape rather than authLimiter's numbers or
 * loginUsernameLimiter's per-account precision, which this route has no
 * username to key on.
 */
const resetPasswordLimiter = routeLimiter({
  windowMs: 60 * 1000,
  defaultMax: 20,
  envVar: "MURLAN_RESET_PASSWORD_RATE_LIMIT",
  message: payload("RATE_LIMITED"),
});

/**
 * Per-account bound on POST /api/auth/change-password (#892) — the route
 * carried no limiter at all, so an authenticated caller could spend
 * bcrypt.compare's cost (~100ms) against a wrong currentPassword without
 * limit. skipSuccessfulRequests mirrors loginUsernameLimiter's reasoning: a
 * person legitimately changing their password twice must not spend the
 * budget a wrong currentPassword does.
 *
 * No decoy hash here, unlike loginUsernameLimiter: that one exists because a
 * fast 401 tells an *anonymous* attacker they have exhausted an account's
 * guesses. This route is already authenticated as the account it is
 * guessing at, so there is no oracle to close.
 */
const changePasswordLimiter = routeLimiter({
  windowMs: 15 * 60 * 1000,
  defaultMax: 10,
  envVar: "MURLAN_CHANGE_PASSWORD_RATE_LIMIT",
  keyBy: "session",
  skipSuccessfulRequests: true,
  message: payload("RATE_LIMITED"),
});

/**
 * Per-address cap on POST /api/auth/register (#892), mirroring
 * passwordResetRequestLimiter exactly. Registration mails the address on
 * demand — see #897 — which is an amplification vector authLimiter's
 * per-IP ceiling does not close. Keying on the submitted address is not
 * itself an oracle: a nonexistent address is throttled on the identical
 * schedule a real one is.
 */
const registerEmailLimiter = routeLimiter({
  windowMs: 15 * 60 * 1000,
  defaultMax: 5,
  envVar: "MURLAN_REGISTER_EMAIL_RATE_LIMIT",
  keyBy: "email",
  message: payload("RATE_LIMITED"),
});

/**
 * Per-address cap on POST /api/auth/add-email (#894 review, finding 4),
 * mirroring registerEmailLimiter exactly. add-email's own EMAIL_ALREADY_SET
 * cap bounds any one *account* to a single verification mail, which is what
 * #892 rested its "self-limiting, no route limiter needed" call on — but
 * that call predates userStore.setEmail no longer raising EmailTakenError for
 * an address claimed-but-unverified elsewhere. Post-#897 any authenticated
 * account can mail one verification code to any address, including a
 * verified victim's, so the amplification now scales with how many accounts
 * an attacker holds rather than being capped at one mail, period.
 */
const addEmailLimiter = routeLimiter({
  windowMs: 15 * 60 * 1000,
  defaultMax: 5,
  envVar: "MURLAN_ADD_EMAIL_RATE_LIMIT",
  keyBy: "email",
  message: payload("RATE_LIMITED"),
});

/**
 * Per-account cap on POST /api/auth/resend-verification (#893) — it is a way
 * to make the server send mail, so it is limited the way addEmailLimiter is,
 * but keyed on the account rather than an address: the route takes no
 * address in its body, only the one already on the caller's own row.
 */
const resendVerificationLimiter = routeLimiter({
  windowMs: 15 * 60 * 1000,
  defaultMax: 5,
  envVar: "MURLAN_RESEND_VERIFICATION_RATE_LIMIT",
  keyBy: "session",
  message: payload("RATE_LIMITED"),
});

// One ticket per socket connection attempt, including every reconnect, so this
// has to tolerate a flapping mobile connection while still being bounded.
const ticketLimiter = routeLimiter({
  windowMs: 60 * 1000,
  defaultMax: 60,
  envVar: "MURLAN_TICKET_RATE_LIMIT",
  message: payload("RATE_LIMITED"),
});

// Register's regenerate and save both write the new session only after the
// user row already exists, so either one failing leaves the same orphan: the
// account is created but unreachable, and its username is permanently taken.
// Both failure paths call this so the rollback isn't duplicated.
async function rollbackRegistration(req: Request, userId: string, res: Response) {
  await deleteUser(userId).catch((cleanupErr) =>
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
  res.status(500).json({ ...payload("INTERNAL_SERVER_ERROR") });
}

export function mountAuth(app: Express): void {
  // #897: neutral by construction, not by matching a decoy. There is no
  // pre-check and no separate "taken" branch — createUser is attempted
  // directly, and a taken-but-unverified address succeeds exactly like a
  // free one (users_email_verified_lower_uq only constrains a *verified*
  // email), so both cases regenerate the same session, mint the same
  // verification token and answer with the same body. `EmailTakenError` is
  // deliberately not caught here: on a fully migrated database `createUser`
  // never raises it (the only unique index left on email is the partial,
  // verified-only one, and a new account's own row is always unverified), so
  // seeing it means the deploy step in docs/DEPLOY-RUNBOOK.md that drops the
  // old unconditional index has not run yet — that must fail loudly (a 500)
  // rather than degrade into a second, session-less registration outcome
  // that a client cannot tell apart from success.
  on(app, "POST /api/auth/register", authLimiter, validate(RegisterSchema), registerEmailLimiter, async (req, res) => {
    const { username, password, email, locale } = req.body;

    const existingUsername = await userStore.getUserByUsername(username);
    if (existingUsername) {
      res.status(409).json({ ...payload("USERNAME_TAKEN") });
      return;
    }

    const passwordHash = await hashPassword(password);
    let user: User;
    try {
      user = await userStore.createUser({ username, password: passwordHash, email });
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        res.status(409).json({ ...payload("USERNAME_TAKEN") });
        return;
      }
      throw err;
    }

    try {
      await signIn(req, user.id);
    } catch (err) {
      if (!(err instanceof SignInError)) throw err;
      logger.error({ err: err.cause }, `Session ${err.stage} failed on register`);
      await rollbackRegistration(req, user.id, res);
      return;
    }
    logger.info({ userId: user.id, username }, "User registered");
    // The client learns who it signed in as from GET /api/auth/me, not
    // from this body — a user object in one branch and not the other is
    // the oracle restated (#897).
    res.status(202).json({ ...payload("CHECK_YOUR_EMAIL") });
    // A provider outage must not block signup — mint and fire without
    // awaiting the send, and only after the reply: the mint is an INSERT,
    // and doing it before the reply would reopen the timing gap #897
    // exists to close.
    replaceEmailVerifyCode({ userId: user.id, email, ttlMs: EMAIL_VERIFY_CODE_TTL_MS })
      .then((code) => sendVerificationEmail(email, username, code, user.id, mailLocale(locale)))
      .catch((err) => logger.error({ err, userId: user.id }, "Failed to mint the verification code"));
  });

  on(app, "POST /api/auth/login", authLimiter, validate(LoginSchema), loginUsernameLimiter, async (req, res) => {
    const { username, password } = req.body;

    const user = await userStore.getUserByUsername(username);
    if (!user) {
      res.status(401).json({ ...payload("INVALID_CREDENTIALS") });
      return;
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      res.status(401).json({ ...payload("INVALID_CREDENTIALS") });
      return;
    }

    try {
      await signIn(req, user.id);
    } catch (err) {
      if (!(err instanceof SignInError)) throw err;
      logger.error({ err: err.cause }, `Session ${err.stage} failed on login`);
      res.status(500).json({ ...payload("INTERNAL_SERVER_ERROR") });
      return;
    }
    logger.info({ userId: user.id, username }, "User logged in");
    res.json(sessionUser(user));
  });

  on(app, "POST /api/auth/logout", async (req, res) => {
    const { userId, pushToken } = req.session;
    const sid = req.sessionID;
    // Before the destroy: a delete that throws must leave the session standing,
    // since the client then keeps both.
    if (userId && pushToken) await deletePushToken(userId, pushToken);
    req.session.destroy(async (destroyErr) => {
      // The session still stands, so the client keeps it — and its sockets.
      if (destroyErr) {
        logger.error({ err: destroyErr, userId }, "Session destroy failed on logout");
        res.status(500).json({ ...payload("INTERNAL_SERVER_ERROR") });
        return;
      }
      if (userId) await revokeAccountSockets(userId, { onlySid: sid });
      res.json({ ok: true });
    });
  });

  onSignedIn(app, "GET /api/auth/me", async (_req, res, userId) => {
    const user = await loadUser(res, userId);
    if (!user) return;
    res.json(sessionUser(user));
  });

  // A live session alone is not proof of intent to change a credential —
  // mirrors login's own bcrypt.compare, and answers a wrong currentPassword
  // with the same generic code login does, so the two are indistinguishable.
  onSignedIn(app, "POST /api/auth/change-password", changePasswordLimiter, validate(ChangePasswordSchema), async (req, res, userId) => {
    const { currentPassword, newPassword } = req.body;

    const user = await loadUser(res, userId);
    if (!user) return;

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      res.status(401).json({ ...payload("INVALID_CREDENTIALS") });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await userStore.changePassword(userId, passwordHash, req.sessionID);
    await revokeAccountSockets(userId, { exceptSid: req.sessionID });
    logger.info({ userId }, "Password changed");
    res.json({ ok: true });
  });

  // #863: the existing-beta-cohort nudge
  // (docs/adr/0007-account-recovery-email-verification-and-password-reset.md,
  // Box 1). Reuses the signup flow's own
  // machinery — mint an email_verify token, send it through sendVerificationEmail
  // — rather than a second one; redemption still goes through the
  // verify-email route below. `email IS NULL` is re-checked here (not just by
  // the profile card that hides once it isn't) because the check and the
  // write below are not one transaction, and this is an authenticated
  // account overwriting its own row, not a public lookup.
  onSignedIn(app, "POST /api/auth/add-email", validate(AddEmailSchema), addEmailLimiter, async (req, res, userId) => {
    const { email, locale } = req.body;

    const existing = await loadUser(res, userId);
    if (!existing) return;
    if (existing.email) {
      res.status(409).json({ ...payload("EMAIL_ALREADY_SET") });
      return;
    }

    const user = await userStore.setEmail(userId, email);

    const code = await replaceEmailVerifyCode({ userId, email, ttlMs: EMAIL_VERIFY_CODE_TTL_MS });
    sendVerificationEmail(email, user.username, code, userId, mailLocale(locale));
    logger.info({ userId }, "Email added, pending verification");
    res.json(sessionUser(user));
  });

  // Public: the code plus the email it was sent to is the credential
  // (server/http/authTokens.ts), not the session — reachable signed-out, the same
  // as the redeem this replaces. A hit resolves the userId from the matched
  // row itself, no lookup needed; a miss does look accounts up by email, to
  // charge every pending row at that address, and an unknown address skips
  // that write — a timing difference authLimiter's per-IP cap makes
  // uneconomical to enumerate through.
  on(app, "POST /api/auth/verify-email", authLimiter, validate(VerifyEmailSchema), async (req, res) => {
    const { email, code } = req.body;
    const userId = await redeemAuthCode({ email, purpose: "email_verify", code });
    if (!userId) {
      res.status(400).json({ ...payload("INVALID_TOKEN") });
      return;
    }
    const result = await userStore.markEmailVerified(userId, email);
    if (result === "not_found") {
      // #894 review, finding 3: the account this token names is gone, or its
      // own email claim already is (a second outstanding token, redeemed
      // after the first already cleared it) — either way there is nothing
      // left to verify, or it now claims a different address than the code
      // was minted for. Same generic failure the redeem step above uses.
      logger.info({ userId }, "Email verification token redeemed nothing left to verify");
      res.status(400).json({ ...payload("INVALID_TOKEN") });
      return;
    }
    if (result === "lost_race") {
      // #897: another account proved control of this mailbox first — this
      // one's claim is already cleared by markEmailVerified, not colliding
      // with users_email_verified_lower_uq.
      logger.info({ userId }, "Email verification lost the race to a different account");
      res.status(409).json({ ...payload("EMAIL_VERIFIED_ELSEWHERE") });
      return;
    }
    logger.info({ userId }, "Email verified");
    res.json({ ok: true });
  });

  /**
   * #893: without this, a mint older than its TTL (EMAIL_VERIFY_CODE_TTL_MS)
   * leaves an account permanently unverifiable — add-email refuses a second
   * call once an address is set (EMAIL_ALREADY_SET), and nothing else mints
   * an email_verify code. Same replace-the-code shape as add-email,
   * keyed on the session rather than a submitted address: the address to
   * resend to is the one already on the caller's own row.
   */
  onSignedIn(app, "POST /api/auth/resend-verification", resendVerificationLimiter, async (req, res, userId) => {
    const user = await loadUser(res, userId);
    if (!user) return;
    if (!user.email) {
      res.status(409).json({ ...payload("EMAIL_NOT_SET") });
      return;
    }
    if (user.emailVerifiedAt) {
      res.status(409).json({ ...payload("EMAIL_ALREADY_VERIFIED") });
      return;
    }

    const code = await replaceEmailVerifyCode({ userId, email: user.email, ttlMs: EMAIL_VERIFY_CODE_TTL_MS });
    sendVerificationEmail(user.email, user.username, code, userId, mailLocale(req.body?.locale));
    logger.info({ userId }, "Verification email resent");
    res.json({ ok: true });
  });

  // Enumeration-safe by design
  // (docs/adr/0007-account-recovery-email-verification-and-password-reset.md,
  // Box 5): identical 200 { ok: true } whether or not
  // the address matches a verified account, and the branch then costs one
  // indexed `users` lookup either way, which is the only work that happens
  // before the reply — the mint and the send both run after it, so neither
  // can be timed. An unverified email is deliberately treated the same as
  // no account at all: verified-email is load-bearing here, not a
  // formality (an unverified address that could reset is
  // registration-then-takeover of someone else's account).
  on(
    app,
    "POST /api/auth/request-password-reset",
    authLimiter,
    validate(RequestPasswordResetSchema),
    passwordResetRequestLimiter,
    async (req, res) => {
      const { email, locale } = req.body;
      const user = await userStore.getVerifiedUserByEmail(email);
      res.json({ ok: true });
      if (!user?.emailVerifiedAt) return;
      // Not awaited: the request this reply belonged to is already done, so
      // a rejection here has no caller left to reach it except this catch.
      mintAuthToken(user.id, "password_reset", PASSWORD_RESET_TOKEN_TTL_MS)
        .then((token) => sendPasswordResetEmail(user.email!, token, user.id, mailLocale(locale)))
        .catch((err) => logger.error({ err, userId: user.id }, "Failed to mint the reset token"));
    }
  );

  // Public: the token itself is the credential, same as verify-email above.
  // One generic failure for unknown/expired/used/unverified alike — which of
  // those it was is not this caller's business.
  on(
    app,
    "POST /api/auth/reset-password",
    resetPasswordLimiter,
    validate(ResetPasswordSchema),
    async (req, res) => {
      const { token, newPassword } = req.body;
      const userId = await redeemAuthToken(token, "password_reset");
      const user = userId ? await userStore.getUser(userId) : undefined;
      if (!user?.emailVerifiedAt) {
        res.status(400).json({ ...payload("INVALID_RESET_TOKEN") });
        return;
      }

      const passwordHash = await hashPassword(newPassword);
      await userStore.resetPassword(user.id, passwordHash);
      await revokeAccountSockets(user.id);
      // The token this request redeemed is already used_at-stamped; this
      // only reaches its unredeemed siblings (design doc, Box 2) — the same
      // "live credential" class as the sessions userStore.resetPassword just
      // cleared, and for the same reason.
      await invalidateAuthTokens(user.id, "password_reset");
      logger.info({ userId: user.id }, "Password reset");
      res.json({ ok: true });
    }
  );

  // Mints the short-lived, single-use ticket the socket handshake accepts in
  // place of a session cookie (native clients do not send cookies on upgrade).
  onSignedIn(app, "POST /api/auth/socket-ticket", ticketLimiter, (req, res, userId) => {
    const { ticket, expiresAt } = mintSocketTicket(userId, req.sessionID);
    res.json({ ticket, expiresAt });
  });
}
