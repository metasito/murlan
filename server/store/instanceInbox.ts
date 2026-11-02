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
  /** Rejects at once while Redis is unreachable, or when `to` has no inbox: there is nobody to hand the message to. */
  send(to: string, message: InstanceMessage): Promise<void>;
  on(kind: string, handler: InstanceHandler): void;
  /** Removes this instance's stream, so a send to it rejects at once. Never rejects. */
  close(): Promise<void>;
}

const READ_COUNT = 100;
const RETRY_MS = 250;
const KEEP_ALIVE_MS = 3_000;
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
      if (!(await writer.pExpire(own, INBOX_TTL_MS))) await create();
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

  return {
    async send(to, message) {
      clusterMessages.inc({ channel: "inbox" });
      const entry = await writer.xAddNoMkStream(inboxKey(to), "*", { m: JSON.stringify(message) }, { TRIM: inboxTrim() });
      if (entry === null) throw new Error(`instance ${to} has no inbox: it is gone`);
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
