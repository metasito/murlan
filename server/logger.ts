import pino from "pino";

// pino-http's default req/res serializers copy the entire header bag,
// which puts the live session cookie and any bearer token in cleartext on
// every completed-request log line. Shared with tests/logRedaction.test.ts
// so the test fails the moment this list stops matching what's applied.
export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
];

/**
 * Builds the app's pino instance. Factored out so tests/logRedaction.test.ts
 * can point the same construction — same redact config — at a capturing
 * stream instead of stdout, rather than re-declaring the options and
 * verifying nothing but its own copy.
 *
 * `destination` and `transport` are mutually exclusive as far as pino is
 * concerned, so the pretty-printer only applies when nothing else already
 * claimed the output.
 */
export function createLogger(destination?: pino.DestinationStream) {
  return pino(
    {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      redact: {
        paths: REDACT_PATHS,
        censor: "[redacted]",
      },
      transport:
        !destination && process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    destination
  );
}

export const logger = createLogger();
