import { DEFAULT_LOCALE, isLocale, translate, type Locale } from "../../shared/i18n.ts";
import { EMAIL_VERIFY_CODE_TTL_MS, PASSWORD_RESET_TOKEN_TTL_MS } from "./authTokens.ts";
import { logger } from "../shared/logger.ts";
import { sendMail } from "./mail.ts";

/**
 * Names the account and says what to do if the reader didn't ask for this
 * (#894 review, finding 2): registration is neutral by design (#897), which
 * means this mail can now land in a mailbox that never asked to create one —
 * a stranger who registered with someone else's address. An anonymous
 * "here's a code" body gave that person no way to tell it apart from their
 * own pending signup, and redeeming the wrong one loses their own email
 * claim (userStore.markEmailVerified). Exported so tests can pin the wording
 * without standing up a mail provider.
 */
export function verificationEmailBody(username: string, code: string, locale: Locale): string {
  return translate(locale, "mail.verifyBody", { username, code, minutes: EMAIL_VERIFY_CODE_TTL_MS / 60_000 });
}

export function passwordResetEmailBody(token: string, locale: Locale): string {
  return translate(locale, "mail.resetBody", { token, minutes: PASSWORD_RESET_TOKEN_TTL_MS / 60_000 });
}

export function mailLocale(value: unknown): Locale {
  return typeof value === "string" && isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Never awaited by a caller — a provider outage must not delay or fail the response it rides with. */
export function sendVerificationEmail(to: string, username: string, code: string, userId: string, locale: Locale): void {
  sendMail(to, translate(locale, "mail.verifySubject"), verificationEmailBody(username, code, locale), userId)
    .catch((err) => logger.error({ err, userId }, "sendVerificationEmail failed"));
}

/**
 * Never awaited by its caller (design doc, Box 5) — the enumeration-safe
 * request-password-reset handler replies before this settles, so the only
 * work the response waits on is the token mint, not the outbound HTTPS call.
 */
export function sendPasswordResetEmail(to: string, token: string, userId: string, locale: Locale): void {
  sendMail(to, translate(locale, "mail.resetSubject"), passwordResetEmailBody(token, locale), userId).catch((err) => logger.error({ err, userId }, "sendPasswordResetEmail failed"));
}
