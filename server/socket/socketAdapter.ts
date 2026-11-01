import { createAdapter } from "@socket.io/redis-streams-adapter";
import { MessageType, type ClusterMessage } from "socket.io-adapter";
import { BLOCK_MS, openRedis, redisKey, streamMaxLen, type RedisClient } from "../store/redis.ts";
import { noteStreamRead } from "../shared/metrics.ts";

type Packet = unknown[];

const HEARTBEAT_MS = 3_000;
/** How long a peer counts as alive after it was last heard, as the old heartbeat adapter's timeout. */
const PEER_GRACE_MS = 10_000;
const HEARTBEAT = "murlan:adapter-heartbeat";
const LEAVING = "murlan:adapter-leaving";

interface AdapterLinks {
  client: RedisClient;
  /** Every connection is up and the subscriber has subscribed, so a peer's reply can reach us. */
  ready(): boolean;
}

/**
 * The client the adapter is handed. Its read loop and subscriber are `duplicate()`s, which would
 * otherwise bypass `openRedis` and so its error listener and half-open detection. The adapter
 * leaves several of these promises unhandled, so each one that can reject is settled here; and a
 * closed reader never answers, because the adapter's read loop retries a rejection at once.
 *
 * The adapter disconnects them when `io.close()` closes it, but shutdown forwards its departing
 * players' actions after that, and their acks arrive on the subscriber; `closeRedis` ends them.
 */
function adapterLinks(): AdapterLinks {
  const publisher = openRedis("adapter", { offlineQueue: false });
  const copies: RedisClient[] = [];
  let subscribed = false;
  const client = Object.assign(Object.create(publisher) as RedisClient, {
    publish: (channel: string, payload: Buffer) => publisher.publish(channel, payload).catch(() => 0),
    duplicate: () => {
      const copy = openRedis("adapter", { connect: false });
      copies.push(copy);
      const { connect, subscribe, xRead } = { connect: copy.connect.bind(copy), subscribe: copy.subscribe.bind(copy), xRead: copy.xRead.bind(copy) };
      return Object.assign(copy, {
        connect: () => connect().catch(() => copy),
        disconnect: () => Promise.resolve(),
        subscribe: (...args: Parameters<typeof subscribe>) =>
          subscribe(...args).then(
            () => {
              subscribed = true;
            },
            () => {}
          ),
        xRead: (...args: Parameters<typeof xRead>) => (copy.isOpen ? xRead(...args) : new Promise<never>(() => {})),
      });
    },
  });
  return { client, ready: () => subscribed && publisher.isReady && copies.every((c) => c.isReady) };
}

/** What the adapter is built with, exported so a test reads the values it actually gets. */
export function adapterOptions() {
  const stream = redisKey("socket.io");
  return { streamName: stream, channelPrefix: stream, maxLen: streamMaxLen(), blockTimeInMs: BLOCK_MS };
}

/**
 * The Socket.IO adapter that carries broadcasts between server instances.
 *
 * Without one, `io.to(...)` reaches only the sockets held by the process that
 * called it — the room row is shared, so two players land in the same room and
 * are never told about each other.
 */
export function createSocketAdapter() {
  const links = adapterLinks();
  const make = createAdapter(links.client, adapterOptions());
  // Socket.io constructs it with `new`, which an arrow function refuses.
  return function (nsp: unknown) {
    const adapter = make(nsp);
    const cluster = adapter as unknown as { uid: string; onMessage(message: ClusterMessage, offset?: string): void };
    const subscribers = adapter.serverCount.bind(adapter);
    const serverSideEmit = adapter.serverSideEmit.bind(adapter);
    const fetchSockets = adapter.fetchSockets.bind(adapter);
    const onMessage = cluster.onMessage.bind(adapter);
    const close = adapter.close.bind(adapter);
    const heard = new Map<string, number>();

    /**
     * The peers a request must hear from. The subscriber count alone comes up short whenever a
     * peer's subscriber is between subscriptions, and short reads as "nobody else holds this
     * table"; so a peer heard within the grace still counts, and an instance not itself
     * subscribed cannot count at all.
     */
    async function peers(): Promise<number> {
      if (!links.ready()) throw new Error("this instance is not subscribed to the cluster");
      const count = await subscribers();
      const now = performance.now();
      for (const [uid, at] of heard) if (now - at > PEER_GRACE_MS) heard.delete(uid);
      return Math.max(count - 1, heard.size);
    }

    // The adapter reads the count once, synchronously, at the start of the request this pins it for.
    let pinned: number | null = null;
    const withPeers = <T>(n: number, request: () => T): T => {
      pinned = n + 1;
      try {
        return request();
      } finally {
        pinned = null;
      }
    };
    // Socket.io leaves this promise unhandled, and a broadcast's ack waits only on the instances
    // it can reach.
    adapter.serverCount = () => (pinned !== null ? Promise.resolve(pinned) : peers().then((n) => n + 1, () => 1));
    // A request whose peers cannot be counted fails, never answering "no peer owns it": the
    // caller must not release a seat or take over a table another instance may still hold.
    adapter.serverSideEmit = (packet: Packet) => {
      const ack = packet.at(-1);
      if (typeof ack !== "function") return serverSideEmit(packet);
      return peers().then(
        (n) => withPeers(n, () => serverSideEmit(packet)),
        (err: unknown) => ack(err, [])
      );
    };
    adapter.fetchSockets = (opts: Parameters<typeof fetchSockets>[0]) =>
      opts.flags?.local ? fetchSockets(opts) : peers().then((n) => withPeers(n, () => fetchSockets(opts)));
    cluster.onMessage = (message: ClusterMessage, offset?: string) => {
      if (offset !== undefined) noteStreamRead("adapter", offset);
      if (message.uid !== cluster.uid) heard.set(message.uid, performance.now());
      const event = message.type === MessageType.SERVER_SIDE_EMIT ? (message.data.packet as Packet)[0] : undefined;
      if (event === LEAVING) heard.delete(message.uid);
      if (event === HEARTBEAT || event === LEAVING) return;
      return onMessage(message, offset);
    };
    const beat = setInterval(() => void serverSideEmit([HEARTBEAT]), HEARTBEAT_MS);
    (beat as unknown as { unref?: () => void }).unref?.();
    adapter.close = () => {
      clearInterval(beat);
      void serverSideEmit([LEAVING]);
      return close();
    };
    return adapter;
  };
}
