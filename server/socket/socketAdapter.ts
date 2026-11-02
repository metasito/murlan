import { createAdapter } from "@socket.io/redis-streams-adapter";
import { MessageType, type ClusterMessage } from "socket.io-adapter";
import { now } from "../http/clock.ts";
import { BLOCK_MS, openRedis, redisKey, streamMaxLen, type RedisClient } from "../store/redis.ts";

type Packet = unknown[];

const HEARTBEAT_MS = 3_000;
const FIRST_BEAT_POLL_MS = 100;
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
  const options = adapterOptions();
  const make = createAdapter(links.client, options);
  // Socket.io constructs it with `new`, which an arrow function refuses.
  return function (nsp: { name: string }) {
    const adapter = make(nsp);
    const cluster = adapter as unknown as { uid: string; onMessage(message: ClusterMessage, offset?: string): void };
    const serverSideEmit = adapter.serverSideEmit.bind(adapter);
    const fetchSockets = adapter.fetchSockets.bind(adapter);
    const onMessage = cluster.onMessage.bind(adapter);
    const close = adapter.close.bind(adapter);
    // Each adapter subscribes to a private channel named for its uid, which is how a peer that is
    // subscribed but not yet heard is still known.
    const privateChannels = `${options.channelPrefix}#${nsp.name}#`;
    const pattern = `${privateChannels.replace(/[*?[\]\\]/g, (c) => `\\${c}`)}*#`;
    const heard = new Map<string, number>();
    const noticed = new Map<string, number>();
    // A peer that said it is leaving is not waited on again, whatever arrives from it after.
    const left = new Set<string>();

    /**
     * The peers a request must hear from: every peer heard within the grace, together with every
     * peer subscribed now that has not gone silent. Neither alone will do. A peer between
     * subscriptions is heard but not subscribed, and short reads as "nobody else holds this
     * table"; one just booted is subscribed but not heard; and a stream backlog read after a
     * reconnect is not hearing anyone, so only live pub/sub traffic counts. A subscription
     * outliving its silent owner, as a partitioned host's does, stops counting after the grace.
     * An instance not itself subscribed cannot count at all.
     */
    async function peers(): Promise<number> {
      if (!links.ready()) throw new Error("this instance is not subscribed to the cluster");
      const channels = (await links.client.sendCommand(["PUBSUB", "CHANNELS", pattern])) as string[];
      const at = now();
      const subscribed = new Set(channels.map((c) => String(c).slice(privateChannels.length, -1)));
      subscribed.delete(cluster.uid);
      for (const uid of left) subscribed.delete(uid);
      for (const uid of subscribed) if (!noticed.has(uid)) noticed.set(uid, at);
      let count = 0;
      for (const [uid, since] of noticed) {
        const last = heard.get(uid);
        if ((last !== undefined && at - last < PEER_GRACE_MS) || (subscribed.has(uid) && at - since < PEER_GRACE_MS)) count += 1;
        else if (!subscribed.has(uid)) {
          noticed.delete(uid);
          heard.delete(uid);
        }
      }
      return count;
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
      opts.flags?.local
        ? withPeers(0, () => fetchSockets(opts))
        : peers().then((n) => withPeers(n, () => fetchSockets(opts)));
    cluster.onMessage = (message: ClusterMessage, offset?: string) => {
      const event = message.type === MessageType.SERVER_SIDE_EMIT ? (message.data.packet as Packet)[0] : undefined;
      if (event === LEAVING) {
        left.add(message.uid);
        heard.delete(message.uid);
        noticed.delete(message.uid);
      } else if (offset === undefined && message.uid !== cluster.uid && !left.has(message.uid)) {
        const at = now();
        heard.set(message.uid, at);
        if (!noticed.has(message.uid)) noticed.set(message.uid, at);
      }
      if (event === HEARTBEAT || event === LEAVING) return;
      return onMessage(message, offset);
    };
    const beatNow = () => void serverSideEmit([HEARTBEAT]);
    const beat = setInterval(beatNow, HEARTBEAT_MS);
    const firstBeat = setInterval(() => {
      if (!links.ready()) return;
      clearInterval(firstBeat);
      beatNow();
    }, FIRST_BEAT_POLL_MS);
    for (const timer of [beat, firstBeat]) (timer as unknown as { unref?: () => void }).unref?.();
    adapter.close = () => {
      clearInterval(beat);
      clearInterval(firstBeat);
      void serverSideEmit([LEAVING]);
      return close();
    };
    return adapter;
  };
}
