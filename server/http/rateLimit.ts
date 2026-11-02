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
import { createHmac } from "node:crypto";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { Counter } from "prom-client";
import type { Request, RequestHandler } from "express";
import { defineScript, openRedis, redisKey, type CommandParser, type RedisClient } from "../store/redis.ts";
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
  help: "Requests a rate limiter counted only in this instance's memory because Redis did not answer",
  labelNames: ["limiter"],
});

/**
 * How long a request waits on Redis for the cluster's count before going on with its own. An
 * in-region round trip is under a millisecond; a miss costs only cluster-wide precision, since the
 * local count always judges too.
 */
const SHARED_COUNT_DEADLINE_MS = 100;
/** How many times a deadline that fired late, behind a stalled event loop, is given again. */
const MAX_REARMS = 2;
/** After this many misses in a row, every limiter counts locally without asking Redis for a while. */
const MISSES_BEFORE_PAUSE = 3;
const SHARED_COUNT_PAUSE_MS = 1_000;

let limitsConnection: RedisClient<typeof LIMIT_SCRIPTS> | null = null;
let missesInARow = 0;
// Monotonic, not the installable clock: a test's fake clock dated ahead would pause Redis for good.
let pausedUntil = 0;

/** Opens the connection every limiter counts over, at boot; `closeRedis` ends it. */
export function connectRateLimits(): void {
  if (!limitsConnection?.isOpen) limitsConnection = openRedis("limits", { offlineQueue: false, scripts: LIMIT_SCRIPTS });
}

function sendLimitCommand(args: string[]): Promise<RedisReply> {
  if (!limitsConnection) return Promise.reject(new Error("the rate-limit connection was never opened"));
  return limitsConnection.sendCommand(args);
}

function withinDeadline<T>(work: () => Promise<T>): Promise<T> {
  if (!limitsConnection?.isReady || performance.now() < pausedUntil) {
    return Promise.reject(new Error("Redis is not answering the rate limiters"));
  }
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answered = work().then(
    (value) => {
      settled = true;
      missesInARow = 0;
      return value;
    },
    (err: unknown) => {
      settled = true;
      throw err;
    },
  );
  const late = new Promise<never>((_, reject) => {
    let rearms = 0;
    const arm = () => {
      const armedAt = performance.now();
      timer = setTimeout(() => {
        // A timer firing late means the event loop stalled, not that Redis was slow: the stall may
        // have held the command unsent (node-redis writes on setImmediate) or its reply unread.
        if (performance.now() - armedAt > SHARED_COUNT_DEADLINE_MS * 1.25 && rearms++ < MAX_REARMS) return arm();
        // One turn of the loop, so a reply already in the socket counts.
        setImmediate(() => {
          if (settled) return;
          if (++missesInARow >= MISSES_BEFORE_PAUSE) pausedUntil = performance.now() + SHARED_COUNT_PAUSE_MS;
          reject(new Error("Redis did not answer the rate limiter in time"));
        });
      }, SHARED_COUNT_DEADLINE_MS);
    };
    arm();
  });
  return Promise.race([answered, late]).finally(() => clearTimeout(timer));
}

/**
 * Names a caller in Redis by a keyed hash, never by the IP, email, username or account id itself.
 * The key is derived from the session secret rather than the secret itself, which signs socket
 * tickets: a key name must never be a ticket signature over a string the caller chose. The secret
 * is read per call: two servers in one process each boot with their own env.
 */
function sharedKey(limiter: string, key: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const hashKey = createHmac("sha256", secret).update("murlan:rate-limit").digest();
  return redisKey(`limit:${limiter}:${createHmac("sha256", hashKey).update(key).digest("base64url")}`);
}

// rate-limit-redis's own decrement is a bare DECR, which recreates an expired or flushed key at -1
// with no expiry: a caller's hash kept forever. No Valkey 9.1 command decrements only a live key.
const decrementLiveCount = defineScript({
  SCRIPT: `local hits = tonumber(redis.call("GET", KEYS[1]))
if hits and hits > 0 and redis.call("PTTL", KEYS[1]) > 0 then return redis.call("DECR", KEYS[1]) end
return 0`,
  NUMBER_OF_KEYS: 1,
  parseCommand(parser: CommandParser, key: string) {
    parser.pushKey(key);
  },
  transformReply: (reply: number) => reply,
});
const LIMIT_SCRIPTS = { decrementLiveCount };

/**
 * Counts every request twice: in Redis, the cluster's count, which holds across instances and
 * through a deploy; and in this limiter's own memory, this instance's count. A request is judged
 * by the larger. While Redis cannot answer, the local count alone judges, so an outage leaves
 * each limit exactly as strict as a per-instance limiter, never looser, and a caller never sees
 * it as a 500. A count kept locally during an outage stays for its window after Redis is back.
 */
class SharedStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  readonly #name: string;
  readonly #memory = new MemoryStore();
  /** Requests Redis never counted, per key, so their take-back skips Redis too. */
  readonly #unshared = new MemoryStore();
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
    this.#unshared.init(options);
  }

  // A failed load is forgotten so the next request loads again; rate-limit-redis keeps the
  // rejected load otherwise, and answers every later call with it. A script Redis lost after
  // loading it (NOSCRIPT) rate-limit-redis reloads by itself.
  #loadScripts(): Promise<void> {
    this.#scriptsLoaded ??= this.#redis.init(this.#options!).catch((err: unknown) => {
      this.#scriptsLoaded = null;
      throw err;
    });
    return this.#scriptsLoaded;
  }

  // The keyspace is read per call, not at build: a test server scopes DATABASE_URL after the
  // routes, and their limiters, were imported.
  #shared<T>(key: string, op: (sharedKey: string) => Promise<T>): Promise<T> {
    return withinDeadline(async () => {
      await this.#loadScripts();
      return op(sharedKey(this.#name, key));
    });
  }

  async increment(key: string): Promise<IncrementResponse> {
    const [local, shared] = await Promise.all([
      this.#memory.increment(key),
      this.#shared(key, (k) => this.#redis.increment(k)).catch(async () => {
        fallbacks.inc({ limiter: this.#name });
        await this.#unshared.increment(key);
        return undefined;
      }),
    ]);
    return shared && shared.totalHits >= local.totalHits ? shared : local;
  }

  async decrement(key: string): Promise<void> {
    await this.#memory.decrement(key);
    if (((await this.#unshared.get(key))?.totalHits ?? 0) > 0) return this.#unshared.decrement(key);
    await this.#shared(key, (k) => limitsConnection!.decrementLiveCount(k)).catch(() => {});
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const [local, shared] = await Promise.all([
      this.#memory.get(key),
      this.#shared(key, (k) => this.#redis.get(k)).catch(() => undefined),
    ]);
    if (!shared || !local) return shared ?? local;
    return shared.totalHits >= local.totalHits ? shared : local;
  }

  async resetKey(key: string): Promise<void> {
    await Promise.all([
      this.#memory.resetKey(key),
      this.#unshared.resetKey(key),
      this.#shared(key, (k) => this.#redis.resetKey(k)).catch(() => {}),
    ]);
  }

  shutdown(): void {
    this.#memory.shutdown();
    this.#unshared.shutdown();
  }
}

/** Every limiter built, by name, with its window. */
const windows = new Map<string, number>();

/**
 * The longest any count is kept: in Redis, its window, after which the key expires; in memory,
 * twice that, since a MemoryStore sweeps a window's keys only once the next window ends too.
 */
export function limiterRetentionMs(): { shared: number; local: number } {
  const longest = Math.max(0, ...windows.values());
  return { shared: longest, local: 2 * longest };
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
  if (windows.has(name)) throw new Error(`a rate limiter named "${name}" already exists, and two would share one count`);
  windows.set(name, windowMs);
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
