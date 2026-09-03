// tests/e2e/helpers/mailSink.ts — reads the raw token out of the file
// server/mail.ts's MURLAN_MAIL_SINK branch writes to (playwright.config.ts
// hands the path to the server and re-exports it on process.env). This is
// the only way a browser-driven spec can get a token at all: the server
// stores only its hash, and the real send goes to Resend.
import { readFileSync } from "node:fs";

interface SinkEntry {
  to: string;
  subject: string;
  text: string;
}

const POLL_MS = 200;

function tokenFromBody(text: string): string | null {
  // Both verificationEmailBody and sendPasswordResetEmail's body put the
  // token alone on its own line, straight after "...is:".
  return text.match(/:\n\n(\S+)\n\n/)?.[1] ?? null;
}

/**
 * Waits for the most recent mail to `to` whose subject contains
 * `subjectContains`, and returns the token inside it.
 *
 * Polls rather than reading once: every mint this suite drives is a
 * fire-and-forget send that runs after the request's own reply (register's
 * CHECK_YOUR_EMAIL, request-password-reset's enumeration-safe 200), so the
 * line is not guaranteed to exist the instant the page moves on.
 */
export async function readMailToken(
  to: string,
  subjectContains: string,
  timeoutMs = 20_000
): Promise<string> {
  const sinkPath = process.env.MURLAN_MAIL_SINK;
  if (!sinkPath) {
    throw new Error("MURLAN_MAIL_SINK is not set — playwright.config.ts must hand it to webServer.env");
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let lines: string[] = [];
    try {
      lines = readFileSync(sinkPath, "utf8").split("\n").filter(Boolean);
    } catch {
      // Not created yet — the first mail this run sends is what creates it.
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i]!) as SinkEntry;
      if (entry.to.toLowerCase() !== to.toLowerCase()) continue;
      if (!entry.subject.includes(subjectContains)) continue;
      const token = tokenFromBody(entry.text);
      if (token) return token;
    }
    if (Date.now() > deadline) {
      throw new Error(`no mail to ${to} with subject containing "${subjectContains}" arrived within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
