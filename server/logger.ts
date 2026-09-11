import pino from "pino";
import pinoHttp from "pino-http";
import type { IncomingMessage, ServerResponse } from "node:http";

// A hand-written line handed a request or response object carries the live
// session cookie and any bearer token in cleartext. The completed-request line
// is not one of them: it goes through `HTTP_SERIALIZERS` below, which writes no
// headers at all.
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

// pino-http's defaults emit the whole header bag and the socket's peer address.
// `x-forwarded-for`, `forwarded` (RFC 7239), `x-real-ip` and `cf-connecting-ip`
// each carry the player's own IP. Truncating or hashing an address leaves
// personal data under the same retention and deletion duty (CNIL's Google
// Analytics decision, 2022; EDPB Guidelines 01/2025 §pseudonymisation), so none
// of it is written at all.
//
// The URL is logged as the route's pattern, never as the address requested:
// `DELETE /api/friends/invites/:roomCode` would otherwise put a room code in
// the line, which is the very thing `REDACT_PATHS` exists to keep out of it,
// and `/api/friends/:friendUserId` would name an account. A request no route
// matched — a static asset — has no pattern, and carries no parameter either.
type LoggedRequest = IncomingMessage & {
  originalUrl?: string;
  baseUrl?: string;
  route?: { path?: string };
};

function loggedRequest(req: LoggedRequest) {
  return {
    method: req.method,
    url: req.route?.path
      ? `${req.baseUrl ?? ""}${req.route.path}`
      : (req.originalUrl ?? req.url ?? "").split("?")[0],
  };
}

const HTTP_SERIALIZERS = {
  req: loggedRequest,
  res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
};

/** The completed-request logger `server/app.ts` mounts. */
export function createRequestLogger(target: pino.Logger = logger) {
  return pinoHttp({
    logger: target,
    serializers: HTTP_SERIALIZERS,
    // The completed-request line is assembled here, at `finish`, rather than
    // bound to the child logger: pino serializes a child's bindings when the
    // child is made, which is before routing, and `req.route` is the whole
    // point. `quietResLogger` is what drops the early binding — leave it out
    // and the line carries both, the second one still holding the address.
    quietResLogger: true,
    customSuccessObject: (req: LoggedRequest, _res: ServerResponse, line: object) => ({
      ...line,
      req: loggedRequest(req),
    }),
    customErrorObject: (req: LoggedRequest, _res: ServerResponse, _err: Error, line: object) => ({
      ...line,
      req: loggedRequest(req),
    }),
    autoLogging: { ignore: (req: IncomingMessage) => req.url === "/health" },
  });
}
