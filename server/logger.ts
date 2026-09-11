import pino from "pino";
import pinoHttp from "pino-http";
import type { IncomingMessage, ServerResponse } from "node:http";

// The completed-request line no longer carries headers at all
// (`HTTP_SERIALIZERS` below), so the three header paths here defend any *other*
// line handed a request or response object — an error a library attaches one
// to, or a future hand-written line. They stay because the cost is nil and the
// next such line is not announced.
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

// pino-http's default serializers emit the whole header bag and the socket's
// peer address. `x-forwarded-for`, `forwarded` (RFC 7239), `x-real-ip` and
// `cf-connecting-ip` each carry the player's real IP through Replit's TLS
// terminator, and no query string is worth keeping either — `?username=` names
// an account, and the next route to take a token in the URL would be logged
// without anyone deciding to.
//
// Truncating or hashing the address instead would not help: a DPA has already
// rejected octet-truncation as anonymisation, and a salted hash is only
// pseudonymisation, so either answer still leaves personal data to retain,
// export and delete. What a fault is diagnosed from is the path and the status.
const HTTP_SERIALIZERS = {
  req: (req: IncomingMessage & { originalUrl?: string }) => ({
    method: req.method,
    url: (req.originalUrl ?? req.url ?? "").split("?")[0],
  }),
  res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
};

/** The completed-request logger `server/app.ts` mounts. */
export function createRequestLogger(target: pino.Logger = logger) {
  return pinoHttp({
    logger: target,
    serializers: HTTP_SERIALIZERS,
    autoLogging: { ignore: (req: IncomingMessage) => req.url === "/health" },
  });
}
