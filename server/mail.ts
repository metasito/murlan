import { logger } from "./logger.ts";
import { trackEvent } from "./events.ts";

/** Since this process started — reset by every restart, like the rest of memory. */
const counts = { attempted: 0, succeeded: 0, failed: 0 };

export interface MailHealth {
  configured: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
}

/** For /admin — see server/admin.ts's "Mail health" panel. */
export function mailHealth(): MailHealth {
  return { configured: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM_ADDRESS), ...counts };
}

/**
 * One outbound email, sent via Resend's HTTP API through Node's built-in
 * `fetch` — no SDK dependency, per
 * docs/superpowers/specs/2026-09-03-account-recovery-design.md, Box 3.
 * Every caller goes through this one function, so a vendor swap or removal
 * touches this file alone. Credentials live in Replit Secrets, read at call
 * time (not module scope) so a test process can set them per-run.
 *
 * Never throws: a provider outage must not become a caller's problem to
 * handle specially. Returns whether the send is believed to have gone out.
 *
 * A `warn`/`error` log line alone is not an observer — #875 found the mail
 * secrets unset in the deployment and nobody had noticed. Every failure
 * path also lands a `mail.sendFailed` event row, which `funnel()` counts and
 * `/admin` can show; see `boot check` below for the once-at-startup half.
 */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  counts.attempted += 1;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM_ADDRESS;
  if (!apiKey || !from) {
    logger.warn({ to }, "sendMail: RESEND_API_KEY/MAIL_FROM_ADDRESS not set, skipping send");
    trackEvent("mail.sendFailed", null, { mailFailureReason: "unconfigured" });
    counts.failed += 1;
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) {
      logger.error({ to, status: res.status }, "sendMail: provider rejected the send");
      trackEvent("mail.sendFailed", null, { mailFailureReason: "rejected" });
      counts.failed += 1;
      return false;
    }
    counts.succeeded += 1;
    return true;
  } catch (err) {
    logger.error({ err, to }, "sendMail: send failed");
    trackEvent("mail.sendFailed", null, { mailFailureReason: "network_error" });
    counts.failed += 1;
    return false;
  }
}

/**
 * Once, at boot, at `error` level, naming what is missing — not per-request,
 * buried in request logs. Does not refuse to boot: `CLAUDE.md` requires the
 * app to launch from the Run button with no setup, and taking production
 * down because recovery mail is unconfigured would trade an inert feature
 * for an outage.
 */
export function checkMailConfigOnBoot(): void {
  const missing = [
    !process.env.RESEND_API_KEY && "RESEND_API_KEY",
    !process.env.MAIL_FROM_ADDRESS && "MAIL_FROM_ADDRESS",
  ].filter((v): v is string => v !== false);
  if (missing.length > 0) {
    logger.error(
      { missing },
      "Mail is not configured — verification and password-reset mail will silently no-op"
    );
  }
}
