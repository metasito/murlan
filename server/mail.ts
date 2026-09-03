import { logger } from "./logger.ts";

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
 */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM_ADDRESS;
  if (!apiKey || !from) {
    logger.warn({ to }, "sendMail: RESEND_API_KEY/MAIL_FROM_ADDRESS not set, skipping send");
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
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, to }, "sendMail: send failed");
    return false;
  }
}
