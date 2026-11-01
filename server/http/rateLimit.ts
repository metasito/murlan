// The one place a rate limiter is built — pinned by
// tests/server/rateLimiterFactory.test.ts, which fails on any other caller of
// rateLimit() under server/.
import {
  MemoryStore,
  rateLimit,
  type ClientRateLimitInfo,
  type IncrementResponse,
  type Options,
  type RateLimitExceededEventHandler,
  type Store,
} from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { Counter } from "prom-client";
import type { Request, RequestHandler } from "express";
import { openRedis, redisKey, type RedisClient } from "../store/redis.ts";
import { testOnlyEnv } from "./testOnlyEnv.ts";

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
type LimiterKey = "ip" | "session" | "email" | "username";

const KEY_GENERATORS: Record<Exclude<LimiterKey, "ip">, (req: Request) => string> = {
  session: (req) => req.session?.userId ?? "anonymous",
  // Case-folded to the form storage looks the account up by, so `Ana@x.com`
  // and `ana@x.com` cannot fork one account into two budgets.
  email: (req) => (req.body as { email: string }).email.toLowerCase(),
  username: (req) => (req.body as { username: string }).username.toLowerCase(),
};

type LimiterSpec = {
  /** Its counts' name in Redis: the same on every instance, and no other limiter's. */
  name: string;
  windowMs: number;
  /** Used when `envVar` is unset, or holds anything but a positive integer. */
  defaultMax: number;
  /** Read per request, so a test can set it after the routes are imported. */
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

export function maxFrom(envVar: string | undefined, defaultMax: number): number {
  if (!envVar) return defaultMax;
  const parsed = Number(testOnlyEnv(envVar));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultMax;
}

const fallbacks = new Counter({
  name: "limiter_fallbacks_total",
  help: "Requests a rate limiter counted in this instance's memory because Redis did not answer",
  labelNames: ["limiter"],
});

/** How long a request waits on Redis for its count; past it, this instance counts it. */
const SHARED_COUNT_DEADLINE_MS = 1_000;

let limitsConnection: RedisClient | null = null;
const hasConnected = new WeakSet<RedisClient>();

async function sendLimitCommand(args: string[]): Promise<RedisReply> {
  if (!limitsConnection?.isOpen) {
    const opened = openRedis("limits");
    opened.once("ready", () => hasConnected.add(opened));
    limitsConnection = opened;
  }
  // Only a first connect is waited out: a command sent while reconnecting would sit in the
  // offline queue for its whole timeout, and every limited request with it.
  if (hasConnected.has(limitsConnection) && !limitsConnection.isReady) throw new Error("Redis is reconnecting");
  return limitsConnection.sendCommand(args);
}

function withinDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Redis did not answer the rate limiter in time")), SHARED_COUNT_DEADLINE_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Counts in Redis, so a limit holds across instances and through a deploy. While Redis cannot
 * answer, counts in this limiter's own memory instead: the limit still holds on this instance,
 * and the caller never sees the outage as a 500 or as a pass. Counts taken in memory stay there.
 */
class SharedStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  readonly #name: string;
  readonly #memory = new MemoryStore();
  readonly #redis = new RedisStore({ sendCommand: (...args: string[]) => sendLimitCommand(args), prefix: "" });
  #options: Options | undefined;
  #scriptsLoaded: Promise<void> | null = null;

  constructor(name: string) {
    this.#name = name;
    this.prefix = `${name}:`;
  }

  init(options: Options): void {
    this.#options = options;
    this.#memory.init(options);
  }

  // The keyspace is read per call, not at build: a test server scopes DATABASE_URL after the
  // routes, and their limiters, were imported.
  async #shared<T>(key: string, op: (sharedKey: string) => Promise<T>): Promise<T> {
    this.#scriptsLoaded ??= this.#redis.init(this.#options!);
    try {
      return await withinDeadline(this.#scriptsLoaded.then(() => op(redisKey(`limit:${this.#name}:${key}`))));
    } catch (err) {
      this.#scriptsLoaded = null;
      throw err;
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      return await this.#shared(key, (k) => this.#redis.increment(k));
    } catch {
      fallbacks.inc({ limiter: this.#name });
      return this.#memory.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    if (await this.#memory.get(key)) return this.#memory.decrement(key);
    await this.#shared(key, (k) => this.#redis.decrement(k)).catch(() => {});
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      return await this.#shared(key, (k) => this.#redis.get(k));
    } catch {
      return this.#memory.get(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.#memory.resetKey(key);
    await this.#shared(key, (k) => this.#redis.resetKey(k)).catch(() => {});
  }

  shutdown(): void {
    this.#memory.shutdown();
  }
}

export function routeLimiter({
  name,
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
    limit: () => maxFrom(envVar, defaultMax),
    store: new SharedStore(name),
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyBy === "ip" ? {} : { keyGenerator: KEY_GENERATORS[keyBy] }),
    ...(skipSuccessfulRequests === undefined ? {} : { skipSuccessfulRequests }),
    ...(handler ? { handler } : { message }),
  });
}
