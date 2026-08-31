import pino from "pino";

// pino-http's default req/res serializers copy the entire header bag, which
// would put the live session cookie and any bearer token in cleartext on every
// completed-request log line.
//
// A room code is the sole credential for `room:join` and `room:spectate`, so
// the `payload` a refused socket event carries (`server/socketSafety.ts`) is
// the same kind of hazard: anyone reading the log, or the vendor shipping it,
// could join a private table. `tests/logRedaction.test.ts` fails if a socket
// schema grows another code-shaped field without a path here.
export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "payload.code",
  "payload.roomCode",
];

/**
 * Builds the app's pino instance, optionally against a caller-supplied stream.
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
