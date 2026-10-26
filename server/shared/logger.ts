import pino from "pino";

// A hand-written line handed a request or response object carries the live
// session cookie and any bearer token in cleartext. The completed-request line
// is not one of them: it goes through `server/http/logger.ts`'s `HTTP_SERIALIZERS`, which writes no
// headers at all.
//
// A room code is the sole credential for `room:join` and `room:spectate`, so
// the `payload` a refused socket event carries (`server/socket/socketSafety.ts`) is
// the same kind of hazard: anyone reading the log, or the vendor shipping it,
// could join a private table. `tests/server/logRedaction.test.ts` fails if a socket
// schema grows another code-shaped field without a path here.
export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "payload.code",
  "payload.roomCode",
];

// drizzle's DrizzleQueryError renders the failed statement's bound parameters
// into its own `message` — and, through the merged `caused by:` text, into
// `stack` — so an insert into `users` that trips a constraint writes the email
// and the bcrypt hash to the log. Every `logger.error({ err }, ...)` in the
// server reaches this one serializer.
const PARAMS_LINE = /\nparams:[^\n]*/g;

function stripParams(err: Error): Record<string, unknown> {
  const line = pino.stdSerializers.err(err) as Record<string, unknown>;
  delete line.params;
  for (const key of ["message", "stack"] as const) {
    const value = line[key];
    if (typeof value === "string") line[key] = value.replace(PARAMS_LINE, "\nparams: [redacted]");
  }
  return line;
}

type ErrorRecorder = (entry: Record<string, unknown>) => void;
let recordError: ErrorRecorder | undefined;

/** Receives every written line at `error` or above, after redaction. */
export function setErrorRecorder(recorder: ErrorRecorder | undefined): void {
  recordError = recorder;
}

const ERROR_LEVEL = 50;

function tapErrors(line: string): string {
  const level = Number(/"level":(\d+)/.exec(line)?.[1]);
  if (recordError && level >= ERROR_LEVEL) {
    try {
      recordError(JSON.parse(line) as Record<string, unknown>);
    } catch (err) {
      // Never through the logger: a failing recorder would feed itself.
      process.stderr.write(`server error recorder failed: ${String(err)}\n`);
    }
  }
  return line;
}

/**
 * Builds the app's pino instance, optionally against a caller-supplied stream.
 *
 * `destination` and `transport` are mutually exclusive as far as pino is
 * concerned, so the pretty-printer only applies when nothing else already
 * claimed the output. It is a worker thread that can outlive a bare `node`
 * process, so it runs only where a person reads it: a terminal, or LOG_PRETTY=1.
 */
export function createLogger(destination?: pino.DestinationStream) {
  const pretty = process.env.LOG_PRETTY === "1" || process.stdout.isTTY;
  return pino(
    {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      hooks: { streamWrite: tapErrors },
      redact: {
        paths: REDACT_PATHS,
        censor: "[redacted]",
      },
      serializers: { err: stripParams },
      transport:
        !destination && process.env.NODE_ENV !== "production" && pretty
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    destination
  );
}

export const logger = createLogger();
