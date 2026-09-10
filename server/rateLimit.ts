// The one place a rate limiter is built — pinned by
// tests/rateLimiterFactory.test.ts, which fails on any other caller of
// rateLimit() under server/.
import { rateLimit, type RateLimitExceededEventHandler } from "express-rate-limit";
import type { Request, RequestHandler } from "express";

/**
 * What a limiter counts against. `ip` is express-rate-limit's own key, which
 * normalizes IPv6 by prefix — the reason it is an omitted `keyGenerator` here
 * rather than one we write.
 *
 * `session` falls back to `"anonymous"`, so an unauthenticated caller on a
 * session-keyed route shares one budget with every other. Every such route is
 * behind requireAuth, so that bucket is only ever reached by a request that
 * was going to be refused anyway.
 */
export type LimiterKey = "ip" | "session" | "email" | "username";

const KEY_GENERATORS: Record<Exclude<LimiterKey, "ip">, (req: Request) => string> = {
  session: (req) => req.session?.userId ?? "anonymous",
  // Case-folded to the form storage looks the account up by, so `Ana@x.com`
  // and `ana@x.com` cannot fork one account into two budgets.
  email: (req) => (req.body as { email: string }).email.toLowerCase(),
  username: (req) => (req.body as { username: string }).username.toLowerCase(),
};

type LimiterSpec = {
  windowMs: number;
  /** Used when `envVar` is unset, or holds anything but a positive integer. */
  defaultMax: number;
  /** Read when the limiter is built, not per request. */
  envVar?: string;
  keyBy?: LimiterKey;
  skipSuccessfulRequests?: boolean;
};

/**
 * `handler` and `message` are exclusive because express-rate-limit's default
 * handler is what reads `message` — supply your own and the message is dead
 * config that reads as live. Only login needs a handler: see its call site.
 */
export type LimiterOptions = LimiterSpec &
  ({ message: object; handler?: never } | { handler: RateLimitExceededEventHandler; message?: never });

function maxFrom(envVar: string | undefined, defaultMax: number): number {
  if (!envVar) return defaultMax;
  const parsed = Number(process.env[envVar]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultMax;
}

export function routeLimiter({
  windowMs,
  defaultMax,
  envVar,
  keyBy = "ip",
  skipSuccessfulRequests,
  message,
  handler,
}: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit: maxFrom(envVar, defaultMax),
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyBy === "ip" ? {} : { keyGenerator: KEY_GENERATORS[keyBy] }),
    ...(skipSuccessfulRequests === undefined ? {} : { skipSuccessfulRequests }),
    ...(handler ? { handler } : { message }),
  });
}
