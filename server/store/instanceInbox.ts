import { logger } from "../shared/logger.ts";
import { clusterMessages, noteStreamRead } from "../shared/metrics.ts";
import {
  BLOCK_MS,
  CLUSTER_GAP_SECONDS,
  instanceId as thisInstance,
  openRedis,
  redisKey,
  streamMaxLen,
  type RedisClient,
} from "./redis.ts";

/** What one instance sends another. `kind` picks the handler; the rest is JSON. */
export interface InstanceMessage {
  kind: string;
  [field: string]: unknown;
}

export type InstanceHandler = (message: InstanceMessage) => void | Promise<void>;

export interface Inbox {
  /**
   * Rejects at once while Redis is unreachable, and once `to` has had no inbox for longer than its
   * reader takes to make one again: there is nobody to hand the message to. In order per `to`.
   */
  send(to: string, message: InstanceMessage): Promise<void>;
  on(kind: string, handler: InstanceHandler): void;
  /** Removes this instance's stream, so a send to it rejects at once. Never rejects. */
  close(): Promise<void>;
}

const READ_COUNT = 100;
const RETRY_MS = 250;
const KEEP_ALIVE_MS = 1_000;
/** Between tries at an inbox that is missing; together they outlast two keep-alive ticks. */
const RESEND_DELAYS_MS = [50, 100, 200, 400, 800, 800];
const INBOX_TTL_MS = CLUSTER_GAP_SECONDS * 1_000;
const BOOT = JSON.stringify({ kind: "boot" });

const inboxKey = (id: string) => redisKey(`inbox:${id}`);

/** How each send trims its inbox, exported so a test reads the value it actually gets. */
export function inboxTrim() {
  return { strategy: "MAXLEN", strategyModifier: "~", threshold: streamMaxLen() } as const;
}

/**
 * One instance's addressed stream, `inbox:<instanceId>`. Each message is read once and in
 * order: the reader resumes from the last entry it handed over, across any reconnect, for as
 * long as the stream still holds it. The stream is its reader's: made at connect, kept alive while
 * it runs, gone once it stops; a sender never makes one.
 */
export function openInbox({
  id = thisInstance,
  url,
  handlers = new Map(),
}: { id?: string; url?: string; handlers?: Map<string, InstanceHandler> } = {}): Inbox {
  const writer = openRedis("inbox", { url, offlineQueue: false });
  const reader = openRedis("inbox", { url });
  const own = inboxKey(id);
  let closed = false;

  // Pipelined in one write, so the stream is never left without its expiry.
  const create = () =>
    Promise.all([writer.xAdd(own, "*", { m: BOOT }, { TRIM: inboxTrim() }), writer.pExpire(own, INBOX_TTL_MS)]);

  // The connection's own listener reports an outage; the next tick or reconnect tries again.
  async function keepAlive(): Promise<void> {
    try {
      if (!(await writer.pExpire(own, INBOX_TTL_MS)) && !closed) await create();
    } catch {}
  }

  writer.on("ready", () => {
    if (!closed) void create().catch(() => {});
  });
  const keeper = setInterval(() => void keepAlive(), KEEP_ALIVE_MS);
  (keeper as unknown as { unref?: () => void }).unref?.();

  async function deliver(raw: string | undefined): Promise<void> {
    let message: InstanceMessage;
    try {
      message = JSON.parse(raw ?? "");
    } catch (err) {
      logger.error({ err }, "Unreadable instance message dropped");
      return;
    }
    const handler = handlers.get(message.kind);
    if (!handler) {
      logger.debug({ kind: message.kind }, "Instance message with no handler dropped");
      return;
    }
    try {
      await handler(message);
    } catch (err) {
      logger.error({ err, kind: message.kind }, "Instance message handler threw");
    }
  }

  async function read(reader: RedisClient): Promise<void> {
    let after = "0-0";
    while (reader.isOpen) {
      try {
        const reply = await reader.xRead({ key: inboxKey(id), id: after }, { BLOCK: BLOCK_MS, COUNT: READ_COUNT });
        for (const { messages } of (reply ?? []) as { messages: { id: string; message: Record<string, string> }[] }[]) {
          for (const entry of messages) {
            noteStreamRead("inbox", entry.id);
            await deliver(entry.message.m);
            after = entry.id;
          }
        }
      } catch {
        // The connection's own listener reports the outage; this only keeps a rejection that
        // returns at once from spinning the loop.
        if (reader.isOpen) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }

  void read(reader);

  const tryOnce = async (to: string, payload: string) =>
    (await writer.xAddNoMkStream(inboxKey(to), "*", { m: payload }, { TRIM: inboxTrim() })) !== null;
  const gone = (to: string) => new Error(`instance ${to} has no inbox: it is gone`);

  /**
   * A live instance's inbox is also missing between the store losing its data and the reader
   * making it again, so a missing one is tried again for a while. Sends to the same instance wait
   * behind those tries, keeping their order; once it is judged gone, each tries once.
   */
  const missing = new Map<string, Promise<boolean>>();

  async function retry(to: string, payload: string): Promise<boolean> {
    for (const delay of RESEND_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (await tryOnce(to, payload)) return true;
    }
    return false;
  }

  async function sendTo(to: string, payload: string): Promise<void> {
    for (;;) {
      const ahead = missing.get(to);
      if (ahead) {
        if (await ahead.catch(() => false)) continue;
        if (await tryOnce(to, payload)) return;
        throw gone(to);
      }
      if (await tryOnce(to, payload)) return;
      if (missing.has(to)) continue;
      const tries = retry(to, payload);
      missing.set(to, tries);
      const delivered = await tries.finally(() => {
        if (missing.get(to) === tries) missing.delete(to);
      });
      if (!delivered) throw gone(to);
      return;
    }
  }

  return {
    async send(to, message) {
      clusterMessages.inc({ channel: "inbox" });
      await sendTo(to, JSON.stringify(message));
    },
    on(kind, handler) {
      handlers.set(kind, handler);
    },
    async close() {
      closed = true;
      clearInterval(keeper);
      reader.destroy();
      await writer.del(own).catch(() => {});
      writer.destroy();
    },
  };
}

const handlers = new Map<string, InstanceHandler>();
let inbox: Inbox | null = null;

/** This instance's inbox, opened at boot. */
export function startInbox(): void {
  inbox ??= openInbox({ handlers });
}

export function sendToInstance(to: string, message: InstanceMessage): Promise<void> {
  if (!inbox) return Promise.reject(new Error("the instance inbox is not open"));
  return inbox.send(to, message);
}

export function onInstanceMessage(kind: string, handler: InstanceHandler): void {
  handlers.set(kind, handler);
}

export function stopInbox(): Promise<void> {
  const closing = inbox?.close() ?? Promise.resolve();
  inbox = null;
  return closing;
}
