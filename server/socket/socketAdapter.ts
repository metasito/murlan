import { createAdapter } from "@socket.io/redis-streams-adapter";
import { MessageType, type ClusterMessage } from "socket.io-adapter";
import { now } from "../http/clock.ts";
import type { RedisArgument } from "redis";
import { BLOCK_MS, instanceId, openRedis, redisKey, streamMaxLen, type RedisClient } from "../store/redis.ts";
import { clusterMessages, noteStreamRead } from "../shared/metrics.ts";
import { leavePresence, livePeers, type PresenceStore } from "../store/presence.ts";

type Liveness = Pick<PresenceStore, "livePeers" | "leave">;

type Packet = unknown[];

const HEARTBEAT_MS = 3_000;
const FIRST_BEAT_POLL_MS = 100;
/** How long a peer counts as alive after it was last heard, as the old heartbeat adapter's timeout. */
const PEER_GRACE_MS = 10_000;
const HEARTBEAT = "murlan:adapter-heartbeat";
const LEAVING = "murlan:adapter-leaving";
/** Instances by the name their heartbeat carries, with the adapter uid it came from. */
export class RoutingPeers {
  private readonly named = new Map<string, { uid: string; at: number }>();

  heard(uid: string, packet: Packet, at: number): void {
    if (packet[0] === HEARTBEAT && typeof packet[1] === "string") this.named.set(packet[1], { uid, at });
  }

  left(packet: Packet): void {
    if (typeof packet[1] === "string") this.named.delete(packet[1]);
  }

  /** Named within the grace. */
  heardFrom(instance: string, at: number): boolean {
    const peer = this.named.get(instance);
    if (peer && at - peer.at < PEER_GRACE_MS) return true;
    this.named.delete(instance);
    return false;
  }

  /** Whether `instance`'s uid is among `uids`, the adapter uids subscribed now; forgets every instance whose is not. */
  subscribed(instance: string, uids: ReadonlySet<string>): boolean {
    for (const [name, { uid }] of this.named) if (!uids.has(uid)) this.named.delete(name);
    return this.named.has(instance);
  }
}

export const heartbeatPacket = (): Packet => [HEARTBEAT, instanceId];

const routing = new RoutingPeers();
let subscribedUids: (() => Promise<Set<string>>) | null = null;

/** Whether `instance`'s heartbeat was heard within the grace. */
export function heardFrom(instance: string): boolean {
  return routing.heardFrom(instance, now());
}

/**
 * Whether `instance`'s adapter is subscribed now: a killed process loses its subscription at once,
 * though it is still heard for the grace. Rejects when the subscriptions cannot be read.
 */
export async function stillSubscribed(instance: string): Promise<boolean> {
  if (!subscribedUids) throw new Error("the socket adapter is not running");
  return routing.subscribed(instance, await subscribedUids());
}

interface AdapterLinks {
  client: RedisClient;
  /** Every connection is up, the subscriber has subscribed and the read loop has issued its first read, so a peer's reply can reach us. */
  ready(): boolean;
}

let announceUp: () => void = () => {};
/** Settles once an adapter has its first read in flight; what `server/index.ts` announces readiness on. */
export const adapterUp = new Promise<void>((resolve) => {
  announceUp = resolve;
});

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
  let reading = false;
  const client = Object.assign(Object.create(publisher) as RedisClient, {
    publish: (channel: string, payload: Buffer) => publisher.publish(channel, payload).catch(() => 0),
    duplicate: () => {
      const copy = openRedis("adapter", { connect: false });
      copies.push(copy);
      const { connect, subscribe, xRead } = { connect: copy.connect.bind(copy), subscribe: copy.subscribe.bind(copy), xRead: copy.xRead.bind(copy) };
      // The adapter reads from `$` until it has read an entry, and every empty read moves `$` to
      // the tail, so an entry appended between two reads of a quiet stream was never read: each
      // `$` is replaced by the tail the first read found.
      const tails = new Map<string, Promise<string>>();
      const tailOf = (key: RedisArgument): Promise<string> => {
        const name = String(key);
        const known = tails.get(name);
        if (known) return known;
        const tail = copy.xRevRange(key, "+", "-", { COUNT: 1 }).then(
          (last) => last?.[0]?.id ?? "0-0",
          (err: unknown) => {
            tails.delete(name);
            throw err;
          }
        );
        tails.set(name, tail);
        return tail;
      };
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
        xRead: async (...[streams, ...rest]: Parameters<typeof xRead>) => {
          if (!copy.isOpen) return new Promise<never>(() => {});
          reading = true;
          const from = await Promise.all(
            (Array.isArray(streams) ? streams : [streams]).map(async (s) => (s.id === "$" ? { ...s, id: await tailOf(s.key) } : s))
          );
          return xRead(from, ...rest);
        },
      });
    },
  });
  return { client, ready: () => subscribed && reading && publisher.isReady && copies.every((c) => c.isReady) };
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
export function createSocketAdapter(liveness: Liveness = { livePeers, leave: leavePresence }) {
  const links = adapterLinks();
  const options = adapterOptions();
  const make = createAdapter(links.client, options);
  // Socket.io constructs it with `new`, which an arrow function refuses.
  return function (nsp: { name: string }) {
    const adapter = make(nsp);
    const cluster = adapter as unknown as {
      uid: string;
      onMessage(message: ClusterMessage, offset?: string): void;
      doPublish(message: ClusterMessage): Promise<string>;
      doPublishResponse(requesterUid: string, response: unknown): Promise<void>;
    };
    const doPublish = cluster.doPublish.bind(adapter);
    const doPublishResponse = cluster.doPublishResponse.bind(adapter);
    cluster.doPublish = (message) => {
      const event = message.type === MessageType.SERVER_SIDE_EMIT ? (message.data.packet as Packet)[0] : undefined;
      if (event !== HEARTBEAT) clusterMessages.inc({ channel: "adapter" });
      return doPublish(message);
    };
    cluster.doPublishResponse = (requesterUid, response) => {
      clusterMessages.inc({ channel: "adapter" });
      return doPublishResponse(requesterUid, response);
    };
    const serverSideEmit = adapter.serverSideEmit.bind(adapter);
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

    /** The other adapters' uids subscribed now, but for one that said it is leaving. */
    async function subscribedNow(): Promise<Set<string>> {
      if (!links.ready()) throw new Error("this instance is not subscribed to the cluster");
      const channels = (await links.client.sendCommand(["PUBSUB", "CHANNELS", pattern])) as string[];
      const subscribed = new Set(channels.map((c) => String(c).slice(privateChannels.length, -1)));
      subscribed.delete(cluster.uid);
      for (const uid of left) subscribed.delete(uid);
      return subscribed;
    }
    subscribedUids = subscribedNow;

    /**
     * The peers a request must hear from, the larger of two counts: `instances` reads short after
     * Redis lost its data, and while a sweep races a peer's return. Either count failing fails the
     * request. An instance not itself subscribed cannot count at all.
     */
    async function peers(): Promise<number> {
      if (!links.ready()) throw new Error("this instance is not subscribed to the cluster");
      const [heardOf, listed] = await Promise.all([subscribedPeers(), liveness.livePeers()]);
      return Math.max(heardOf, listed);
    }

    /**
     * Peers heard of on the adapter's own channels: every peer heard within the grace, together with every
     * peer subscribed now that has not gone silent. Neither alone will do. A peer between
     * subscriptions is heard but not subscribed, and short reads as "nobody else holds this
     * table"; one just booted is subscribed but not heard; and a stream backlog read after a
     * reconnect is not hearing anyone, so only live pub/sub traffic counts. A subscription
     * outliving its silent owner, as a partitioned host's does, stops counting after the grace.
     */
    async function subscribedPeers(): Promise<number> {
      const subscribed = await subscribedNow();
      const at = now();
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
    cluster.onMessage = (message: ClusterMessage, offset?: string) => {
      if (offset !== undefined) noteStreamRead("adapter", offset);
      const packet = message.type === MessageType.SERVER_SIDE_EMIT ? (message.data.packet as Packet) : [];
      const event = packet[0];
      if (event === LEAVING) {
        left.add(message.uid);
        heard.delete(message.uid);
        noticed.delete(message.uid);
        routing.left(packet);
      } else if (offset === undefined && message.uid !== cluster.uid && !left.has(message.uid)) {
        const at = now();
        heard.set(message.uid, at);
        if (!noticed.has(message.uid)) noticed.set(message.uid, at);
        routing.heard(message.uid, packet, at);
      }
      if (event === HEARTBEAT || event === LEAVING) return;
      return onMessage(message, offset);
    };
    const beatNow = () => void serverSideEmit(heartbeatPacket());
    const beat = setInterval(beatNow, HEARTBEAT_MS);
    const firstBeat = setInterval(() => {
      if (!links.ready()) return;
      clearInterval(firstBeat);
      beatNow();
      announceUp();
    }, FIRST_BEAT_POLL_MS);
    for (const timer of [beat, firstBeat]) (timer as unknown as { unref?: () => void }).unref?.();
    adapter.close = () => {
      liveness.leave();
      clearInterval(beat);
      clearInterval(firstBeat);
      void serverSideEmit([LEAVING, instanceId]);
      return close();
    };
    return adapter;
  };
}
