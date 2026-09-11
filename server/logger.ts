import pino from "pino";
import pinoHttp from "pino-http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { unmatchedKind } from "./staticPaths.ts";

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
// Analytics decision, 10 February 2022; EDPB Guidelines 01/2025 on
// pseudonymisation), so none of it is written at all.
//
// The address is written only as the pattern of the route that answered —
// `DELETE /api/friends/invites/:roomCode` — because the requested one holds a
// room code, the very thing `REDACT_PATHS` keeps out of the line, and
// `/api/friends/:friendUserId` names an account. Anything else writes no
// address: the only other text available is the client's own. A wildcard counts
// as anything else — express leaves `req.route` set on a route that called
// `next()`, and `server/app.ts`'s SPA catch-all declines `/api` that way.
//
// `req.baseUrl` is deliberately not joined on: it is matched text, so a Router
// mounted at `/api/rooms/:roomCode` would put the code back. `path` is typed as
// it arrives, not as it is usually written — a regexp route makes it a RegExp.
//
// With no pattern to write, `kind` says which of the app's surfaces was asked
// for, from `unmatchedKind`'s fixed three words. Without it a scan sweep of the
// API and a deploy that lost a file out of `dist/` are the same line — and the
// lost file is not even a 404, since the SPA catch-all answers it with the
// shell.
type LoggedRequest = IncomingMessage & { route?: { path?: unknown }; originalUrl?: string };

function loggedRequest(req: LoggedRequest) {
  const pattern = req.route?.path;
  const url = typeof pattern === "string" && !pattern.includes("*") ? pattern : undefined;
  return {
    method: req.method,
    url,
    kind: url ? undefined : unmatchedKind((req.originalUrl ?? req.url ?? "").split("?")[0]),
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
    // On, pino-http composes its own serializer under ours, which hands
    // `loggedRequest` a plain object with no `route` on it.
    wrapSerializers: false,
    // The completed-request line is assembled here, at `finish`, rather than
    // bound to the child logger: pino serializes a child's bindings when the
    // child is made, which is before routing, and `req.route` is the whole
    // point. `quietResLogger` is what drops the early binding — leave it out
    // and the line carries both, the second one still holding the address.
    quietResLogger: true,
    customSuccessObject: (req: LoggedRequest, _res: ServerResponse, line: object) => ({ ...line, req }),
    customErrorObject: (req: LoggedRequest, _res: ServerResponse, _err: Error, line: object) => ({
      ...line,
      req,
    }),
    autoLogging: { ignore: (req: IncomingMessage) => req.url === "/health" },
  });
}
