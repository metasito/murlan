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
   * reader takes to make one again: there is nobody to hand the message to. In order per `to`,
   * however the stream comes and goes between two sends.
   */
  send(to: string, message: InstanceMessage): Promise<void>;
  /** Only to an inbox its instance still keeps: false, and nothing written, for one that is gone. Rejects like `send`. */
  offer(to: string, message: InstanceMessage): Promise<boolean>;
  on(kind: string, handler: InstanceHandler): void;
  /** Removes this instance's stream, so a send to it rejects at once. Never rejects. */
  close(): Promise<void>;
}

const READ_COUNT = 100;
const RETRY_MS = 250;
const KEEP_ALIVE_MS = 1_000;
/** Between tries at an inbox that is missing; together they outlast two keep-alive ticks. */
const RESEND_DELAYS_MS = [50, 100, 200, 400, 800, 800];
/** How long a send to an instance found gone tries once instead of again. */
const GONE_FOR_MS = 10_000;
const INBOX_TTL_MS = CLUSTER_GAP_SECONDS * 1_000;
const BOOT = JSON.stringify({ kind: "boot" });

const inboxKey = (id: string) => redisKey(`inbox:${id}`);

/** How each send trims its inbox, exported so a test reads the value it actually gets. */
export function inboxTrim() {
  return { strategy: "MAXLEN", strategyModifier: "~", threshold: streamMaxLen() } as const;
}

/** Instances whose inbox stayed missing through every try, each gone for `forMs` from then. */
export function judgedGone(forMs: number, now: () => number = () => performance.now()) {
  /** Oldest judgement first: `judge` re-inserts, so the sweep stops at the first one still in its window. */
  const judgedAt = new Map<string, number>();
  return {
    judge(peer: string): void {
      const at = now();
      judgedAt.delete(peer);
      judgedAt.set(peer, at);
      for (const [p, t] of judgedAt) {
        if (at - t < forMs) break;
        judgedAt.delete(p);
      }
    },
    isGone: (peer: string): boolean => {
      const at = judgedAt.get(peer);
      return at !== undefined && now() - at < forMs;
    },
    forget(peer: string): void {
      judgedAt.delete(peer);
    },
    get size(): number {
      return judgedAt.size;
    },
  };
}

/**
 * One instance's addressed stream, `inbox:<instanceId>`. Each message is read once and in
 * order: the reader resumes from the last entry it handed over, across any reconnect, for as
 * long as the stream still holds it. The stream is its reader's: made at connect, kept alive while
 * it runs, gone once it stops; a sender never makes one, so the stream existing is what `offer`
 * reads as the instance being there.
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
  /** The last entry id handed to a handler; a stream made anew must hold only ids past it. */
  let cursor = "0-0";

  // Pipelined in one write, so the stream is never left without its expiry. Its id is past the
  // cursor even when this store's clock is behind it (failover, restore), or every later `*` id
  // would sit below what the reader has seen and be skipped.
  const create = () => {
    const seen = Number(cursor.split("-")[0]);
    const id = seen > 0 ? `${seen + 1}-*` : "*";
    return Promise.all([writer.xAdd(own, id, { m: BOOT }, { TRIM: inboxTrim() }), writer.pExpire(own, INBOX_TTL_MS)]);
  };

  // The connection's own listener reports an outage; the next tick or reconnect tries again.
  async function keepAlive(): Promise<void> {
    try {
      if (!(await writer.pExpire(own, INBOX_TTL_MS)) && !closed) await create();
    } catch {}
  }

  writer.on("ready", () => {
    if (!closed) void keepAlive();
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
    while (reader.isOpen) {
      try {
        const reply = await reader.xRead({ key: inboxKey(id), id: cursor }, { BLOCK: BLOCK_MS, COUNT: READ_COUNT });
        for (const { messages } of (reply ?? []) as { messages: { id: string; message: Record<string, string> }[] }[]) {
          for (const entry of messages) {
            noteStreamRead("inbox", entry.id);
            await deliver(entry.message.m);
            cursor = entry.id;
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

  const judged = judgedGone(GONE_FOR_MS);

  /**
   * A live instance's inbox is also missing between the store losing its data and the reader
   * making it again, so a missing one is tried again for a while; within `GONE_FOR_MS` of an
   * instance being judged gone, each send tries once.
   */
  async function deliverTo(to: string, payload: string): Promise<boolean> {
    if (await tryOnce(to, payload)) return true;
    if (judged.isGone(to)) return false;
    for (const delay of RESEND_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (await tryOnce(to, payload)) {
        judged.forget(to);
        return true;
      }
    }
    judged.judge(to);
    return false;
  }

  /**
   * Each write to an instance waits for the one before it to be answered: one found missing is
   * tried again, and a later one already written would land ahead of it.
   */
  const tails = new Map<string, Promise<unknown>>();

  function inTurn<T>(to: string, write: () => Promise<T>): Promise<T> {
    const mine = (tails.get(to) ?? Promise.resolve()).catch(() => {}).then(write);
    tails.set(to, mine);
    void mine.catch(() => {}).finally(() => {
      if (tails.get(to) === mine) tails.delete(to);
    });
    return mine;
  }

  return {
    async send(to, message) {
      clusterMessages.inc({ channel: "inbox" });
      const payload = JSON.stringify(message);
      if (!(await inTurn(to, () => deliverTo(to, payload)))) throw gone(to);
    },
    async offer(to, message) {
      clusterMessages.inc({ channel: "inbox" });
      const payload = JSON.stringify(message);
      return inTurn(to, () => tryOnce(to, payload));
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

export function offerToInstance(to: string, message: InstanceMessage): Promise<boolean> {
  if (!inbox) return Promise.reject(new Error("the instance inbox is not open"));
  return inbox.offer(to, message);
}

export function onInstanceMessage(kind: string, handler: InstanceHandler): void {
  handlers.set(kind, handler);
}

export function stopInbox(): Promise<void> {
  const closing = inbox?.close() ?? Promise.resolve();
  inbox = null;
  return closing;
}
