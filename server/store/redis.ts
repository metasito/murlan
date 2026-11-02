import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import runtime from "../../deploy/runtime.json" with { type: "json" };
import { logger } from "../shared/logger.ts";

export type RedisUse = "adapter" | "inbox" | "presence" | "limits" | "owners";
export type RedisClient = ReturnType<typeof newClient>;

export const instanceId = randomUUID();

export const PING_INTERVAL_MS = 5_000;
/** The longest a blocking read may hold its connection; a `PING` queued behind it waits this out. */
export const BLOCK_MS = 2_000;
/** How long a command may wait unsent while the connection is down; node-redis stops timing it once written. */
const COMMAND_TIMEOUT_MS = 3_000;
/** How long past its due time a `PING` may go unanswered; it may be queued behind a blocking read. */
const PONG_DEADLINE_MS = BLOCK_MS + 1_000;
const WATCH_TICK_MS = 500;
const RECONNECT_CAP_MS = 2_000;
const KEEPALIVE_MS = 10_000;
const IDLE_SOCKET_MS = 30_000;

/** How long Redis may be unreachable before a stream starts dropping what it missed. */
export const CLUSTER_GAP_SECONDS = 120;

export function streamMaxLen(perSecond: number = runtime.maxClusterMessagesPerSecond): number {
  return perSecond * CLUSTER_GAP_SECONDS;
}

/**
 * Every key and stream this server names lives under this. Production sets no `search_path`;
 * the integration suites give each server its own schema in one database, and keying Redis to
 * it keeps suites sharing one Redis from hearing each other.
 */
export function keyspace(databaseUrl: string | undefined): string {
  // `options` can carry several `-c` clauses separated by encoded spaces, so the value ends at
  // the first `%20` as surely as at an `&`.
  const raw = databaseUrl?.match(/(?:^|[?&=\s]|%20)search_path(?:%3D|=)(.+)$/i)?.[1];
  const schema = raw?.split(/&|%20|\s/i)[0];
  return schema ? `murlan#${decodeURIComponent(schema)}` : "murlan";
}

export function redisKey(name: string): string {
  return `${keyspace(process.env.DATABASE_URL)}:${name}`;
}

export function reconnectDelay(retries: number): number {
  return Math.min(50 * 2 ** retries, RECONNECT_CAP_MS) + Math.floor(Math.random() * 100);
}

export interface OpenOptions {
  url?: string;
  /**
   * Off for a publisher, so a command fails at once while Redis is away and local delivery goes
   * on. Never off for a blocking reader: its loop would spin on the immediate rejection.
   */
  offlineQueue?: boolean;
  connect?: boolean;
}

export function redisOptions(use: RedisUse, url: string, offlineQueue = true) {
  return {
    url,
    name: `murlan-${use}`,
    pingInterval: PING_INTERVAL_MS,
    disableOfflineQueue: !offlineQueue,
    maintNotifications: "disabled" as const,
    commandOptions: { timeout: COMMAND_TIMEOUT_MS },
    socket: {
      keepAlive: true,
      keepAliveInitialDelay: KEEPALIVE_MS,
      socketTimeout: IDLE_SOCKET_MS,
      reconnectStrategy: reconnectDelay,
    },
  };
}

function newClient(use: RedisUse, url: string, offlineQueue: boolean) {
  return createClient(redisOptions(use, url, offlineQueue));
}

/** Every open connection, and when it last answered. */
const clients = new Map<RedisClient, number>();
let outageSince: number | null = null;

function noteDown(use: RedisUse, err: unknown): void {
  if (outageSince !== null) return;
  outageSince = Date.now();
  logger.error({ err, use }, "Redis unreachable: cross-instance traffic stops until it is back");
}

/** Over once every connection has answered since it began, so a half-open one still counts. */
function noteAnswered(client: RedisClient): void {
  clients.set(client, Date.now());
  if (outageSince === null) return;
  for (const [c, answeredAt] of clients) if (c.isOpen && (!c.isReady || answeredAt < outageSince)) return;
  outageSince = null;
  logger.info("Redis reachable again");
}

/**
 * A connection whose `PING` goes unanswered is half-open: TCP still holds it, nothing comes back,
 * and node-redis times a command out only until it is written, so it would wait forever. The
 * socket's idle timeout cannot see it either, because the writes reset it; so it is shortened to
 * fire at once, and the client reconnects as it does from any socket error.
 */
function watchForHalfOpen(client: RedisClient, use: RedisUse): void {
  const watch = setInterval(() => {
    if (!client.isOpen) {
      clients.delete(client);
      return clearInterval(watch);
    }
    const answeredAt = clients.get(client) ?? Date.now();
    if (!client.isReady || Date.now() - answeredAt < PING_INTERVAL_MS + PONG_DEADLINE_MS) return;
    noteDown(use, new Error("Redis stopped answering PING"));
    clients.set(client, Date.now() - 1);
    client._maintenanceUpdate({ relaxedSocketTimeout: 1 });
  }, WATCH_TICK_MS);
  (watch as unknown as { unref?: () => void }).unref?.();
}

/** Opens a Redis connection: the only place in the server that does. */
export function openRedis(use: RedisUse, { url = process.env.REDIS_URL, offlineQueue = true, connect = true }: OpenOptions = {}): RedisClient {
  if (!url) throw new Error("REDIS_URL is not set");
  const client = newClient(use, url, offlineQueue);
  client.on("error", (err: unknown) => {
    if (client.isOpen) noteDown(use, err);
  });
  client.on("ready", () => {
    client._maintenanceUpdate({});
    noteAnswered(client);
  });
  client.on("ping-interval", () => noteAnswered(client));
  clients.set(client, Date.now());
  watchForHalfOpen(client, use);
  if (connect) client.connect().catch(() => {});
  return client;
}

/** Resolves once every connection opened so far is ready, or after `timeoutMs`. */
export async function redisReady(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ([...clients.keys()].every((c) => c.isReady || !c.isOpen)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/** Ends every connection at once. Call after `io.close()`, which stops the adapter's read loop. */
export function closeRedis(): void {
  for (const client of clients.keys()) client.destroy();
  clients.clear();
  outageSince = null;
}
