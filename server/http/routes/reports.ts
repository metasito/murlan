import type { Express } from "express";
import { BugReportSchema, ClientErrorSchema } from "../../../shared/httpSchemas.ts";
import { routeLimiter } from "../rateLimit.ts";
import { onSignedIn } from "../mount.ts";
import { validate } from "../validate.ts";
import { recordClientError } from "../clientErrors.ts";
import { recordBugReport } from "../bugReports.ts";
import { logger } from "../../shared/logger.ts";
import { payload } from "../../shared/payload.ts";

const errorReportLimiter = routeLimiter({
  windowMs: 60 * 1000,
  defaultMax: 5,
  // Keyed by account, like the limiter above. The default key is the IP, and
  // a whole shared network — an office, a carrier NAT — then shares five
  // reports a minute: during the crash wave that makes reports worth having,
  // one device silences every other. The route is requireAuth, so there is
  // always a userId to key on. Compare #41, where login has no such option.
  keyBy: "session",
  message: payload("RATE_LIMITED"),
});

// Its own budget: a crash loop spending errorReportLimiter must not refuse the
// report the player then sends about it.
const bugReportLimiter = routeLimiter({
  windowMs: 60 * 1000,
  defaultMax: 5,
  keyBy: "session",
  message: payload("RATE_LIMITED"),
});

export function mountReports(app: Express): void {
  // In-house rather than a third-party crash SDK: any such SDK is a data
  // processor, which changes the App Store privacy answers and adds a
  // dependency that runs in every session. The report itself goes to
  // `client_errors`, which `sweepRetention` expires at 90 days and
  // `deleteUser` clears; the log line says only that a crash happened and on
  // what platform, because nothing sweeps or deletes a log stream.
  //
  // Authenticated on purpose. An open endpoint is an open write into that
  // table, and a crash worth chasing is one a real account hit.
  onSignedIn(
    app,
    "POST /api/client-errors",
    errorReportLimiter,
    validate(ClientErrorSchema),
    (req, res, userId) => {
      const report = req.body;
      logger.warn({ platform: report.platform }, "Client reported an unhandled error");
      // Also kept as a row, so the owner can read it on /admin later rather
      // than only in the log stream. Fire-and-forget: a crash report failing
      // to store must not turn into a second failure for a client that is
      // already showing its error screen.
      void recordClientError({
        userId,
        message: report.message,
        stack: report.stack,
        // The route, not the component stack. That stack is a render-only
        // detail and now rides in `context`, so `screen` means what it says
        // for a rejected promise as much as for a caught render.
        screen: report.screen,
        platform: report.platform,
        appVersion: report.appVersion,
        context: report.componentStack ? { componentStack: report.componentStack } : {},
        // Not the report, even here. A client chooses its own `message`, and a
        // NUL in it makes this insert fail every time — which would be a way
        // to write arbitrary text into a stream nothing sweeps.
      }).catch((err) =>
        logger.error({ err, platform: report.platform }, "Failed to store a client error report")
      );
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
  onSignedIn(
    app,
    "POST /api/bug-reports",
    bugReportLimiter,
    validate(BugReportSchema),
    async (req, res, userId) => {
      const report = req.body;
      try {
        await recordBugReport({ userId, ...report });
        res.status(201).json({ ok: true });
      } catch (err) {
        logger.error({ err, userId }, "Failed to store a bug report");
        res.status(500).json({ ...payload("INTERNAL_SERVER_ERROR") });
      }
    }
  );
}
