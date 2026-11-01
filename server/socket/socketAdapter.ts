import { createAdapter } from "@socket.io/redis-streams-adapter";
import { BLOCK_MS, openRedis, redisKey, streamMaxLen, type RedisClient } from "../store/redis.ts";

type Packet = unknown[];

/**
 * The client the adapter is handed. Its read loop and subscriber are `duplicate()`s, which would
 * otherwise bypass `openRedis` and so its error listener and half-open detection. The adapter
 * leaves several of these promises unhandled, so each one that can reject is settled here; and a
 * closed reader never answers, because the adapter's read loop retries a rejection at once.
 *
 * The adapter disconnects them when `io.close()` closes it, but shutdown forwards its departing
 * players' actions after that, and their acks arrive on the subscriber; `closeRedis` ends them.
 */
function adapterClient(): RedisClient {
  const publisher = openRedis("adapter", { offlineQueue: false });
  return Object.assign(Object.create(publisher) as RedisClient, {
    publish: (channel: string, payload: Buffer) => publisher.publish(channel, payload).catch(() => 0),
    duplicate: () => {
      const copy = openRedis("adapter", { connect: false });
      const { connect, subscribe, xRead } = { connect: copy.connect.bind(copy), subscribe: copy.subscribe.bind(copy), xRead: copy.xRead.bind(copy) };
      return Object.assign(copy, {
        connect: () => connect().catch(() => copy),
        disconnect: () => Promise.resolve(),
        subscribe: (...args: Parameters<typeof subscribe>) => subscribe(...args).catch(() => {}),
        xRead: (...args: Parameters<typeof xRead>) => (copy.isOpen ? xRead(...args) : new Promise<never>(() => {})),
      });
    },
  });
}

/**
 * The Socket.IO adapter that carries broadcasts between server instances.
 *
 * Without one, `io.to(...)` reaches only the sockets held by the process that
 * called it — the room row is shared, so two players land in the same room and
 * are never told about each other.
 */
export function createSocketAdapter() {
  const stream = redisKey("socket.io");
  const make = createAdapter(adapterClient(), {
    streamName: stream,
    channelPrefix: stream,
    maxLen: streamMaxLen(),
    blockTimeInMs: BLOCK_MS,
  });
  // Socket.io constructs it with `new`, which an arrow function refuses.
  return function (nsp: unknown) {
    const adapter = make(nsp);
    const count = adapter.serverCount.bind(adapter);
    const serverSideEmit = adapter.serverSideEmit.bind(adapter);
    // Socket.io leaves this promise unhandled. A broadcast's ack waits only on the instances it
    // can reach, and presence answers from this one alone.
    adapter.serverCount = () => count().catch(() => 1);
    // A request whose peers cannot be counted reaches the ack as an error, never as "no peer
    // owns it": the caller must not take over a table another instance may still hold.
    adapter.serverSideEmit = async (packet: Packet) => {
      const ack = packet.at(-1);
      if (typeof ack !== "function") return serverSideEmit(packet);
      try {
        await count();
      } catch (err) {
        return ack(err, []);
      }
      return serverSideEmit(packet);
    };
    return adapter;
  };
}
