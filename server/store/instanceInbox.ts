import { logger } from "../shared/logger.ts";
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
  /** Rejects at once while Redis is unreachable: there is nobody to hand the message to. */
  send(to: string, message: InstanceMessage): Promise<void>;
  on(kind: string, handler: InstanceHandler): void;
  close(): void;
}

const READ_COUNT = 100;
const RETRY_MS = 250;

const inboxKey = (id: string) => redisKey(`inbox:${id}`);

/**
 * One instance's addressed stream, `inbox:<instanceId>`. Each message is read once and in
 * order: the reader resumes from the last entry it handed over, across any reconnect, for as
 * long as the stream still holds it.
 */
export function openInbox({
  id = thisInstance,
  url,
  handlers = new Map(),
}: { id?: string; url?: string; handlers?: Map<string, InstanceHandler> } = {}): Inbox {
  const writer = openRedis("inbox", { url, offlineQueue: false });
  const reader = openRedis("inbox", { url });

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
      const key = inboxKey(to);
      await writer
        .multi()
        .xAdd(key, "*", { m: JSON.stringify(message) }, { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: streamMaxLen() } })
        .expire(key, CLUSTER_GAP_SECONDS)
        .exec();
    },
    on(kind, handler) {
      handlers.set(kind, handler);
    },
    close() {
      writer.destroy();
      reader.destroy();
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

export function stopInbox(): void {
  inbox?.close();
  inbox = null;
}
