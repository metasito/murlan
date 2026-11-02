// tests/integration/clusterCount.test.ts — an instance that cannot be sure it heard every live
// peer says so, and never answers that it is alone; one that is alone says so at once.
//
// "Nobody else holds this table" is what lets a caller release a seat or take a table over, so a
// count that comes up short while a peer is alive and holding tables is a destructive answer. The
// count is every peer whose presence liveness has not lapsed (server/store/presence.ts), so a peer
// whose link is down is still waited on until it lapses. A count that is long, a dead peer still
// waited on, costs every cross-instance request its full timeout.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createClient } from "redis";
import { Server } from "socket.io";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { eventually } from "../helpers/client.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { createSocketAdapter, speaksInbox, type OlderPeers } from "../../server/socket/socketAdapter.ts";
import { randomUUID } from "node:crypto";
import { installClock, realClock } from "../../server/http/clock.ts";
import { openPresenceStore, type PresenceStore } from "../../server/store/presence.ts";
import { closeRedis, instanceId, keyspace } from "../../server/store/redis.ts";

/** What an instance whose own links are not all back yet answers: it cannot count its peers. */
const NOT_SUBSCRIBED = /not subscribed|client is offline/;

const baseUrl = process.env.DATABASE_URL ?? "";
const redisUrl = process.env.REDIS_URL ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const probe = createClient({ url: redisUrl });
probe.on("error", () => {});

interface Answer {
  replies: string[];
  err: string | null;
}

/** Servers on one keyspace of their own, each answering "probe" with its name. */
function cluster(tag: string) {
  const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${tag}_${Date.now()}`;
  const stream = `${keyspace(scoped)}:socket.io`;
  const servers: Server[] = [];
  const proxies: Proxy[] = [];
  const stores: PresenceStore[] = [];
  const ask = (from: Server): Promise<Answer> =>
    new Promise((resolve) =>
      from.serverSideEmit("probe", (err: Error | null, replies: string[]) =>
        resolve({ replies: [...replies].sort(), err: err ? err.message : null })
      )
    );
  return {
    async link(): Promise<Proxy> {
      const proxy = await startProxy(targetOf(redisUrl, 6379));
      proxies.push(proxy);
      return proxy;
    },
    boot(name: string, through?: Proxy, io = new Server()): Server {
      process.env.DATABASE_URL = scoped;
      process.env.REDIS_URL = through ? viaProxy(redisUrl, through) : redisUrl;
      const presence = openPresenceStore({ id: `${name}-${randomUUID()}`, ns: keyspace(scoped) });
      stores.push(presence);
      io.adapter(createSocketAdapter(presence));
      process.env.DATABASE_URL = baseUrl;
      process.env.REDIS_URL = redisUrl;
      io.on("probe", (reply: (r: string) => void) => reply(name));
      servers.push(io);
      return io;
    },
    ask,
    /** The first answer from an instance whose own links are up and subscribed. */
    settled(from: Server): Promise<Answer> {
      return eventually(async () => {
        const answer = await ask(from);
        return answer.err && NOT_SUBSCRIBED.test(answer.err) ? null : answer;
      }, "the instance to subscribe", 15_000);
    },
    /** The first answer that every peer replied to, once all of them are up. */
    answering(from: Server): Promise<Answer> {
      return eventually(async () => {
        const answer = await ask(from);
        return answer.replies.length > 0 && answer.err === null ? answer : null;
      }, "every peer to answer", 15_000);
    },
    /** How many instances are subscribed now, as Redis counts their private channels. */
    async subscribed(): Promise<number> {
      return (await probe.pubSubChannels(`${stream}#/#*#`)).length;
    },
    streamLength: () => probe.xLen(stream),
    /** Every instance's liveness and the set naming them, as Redis losing its data leaves them. */
    async forgetLiveness(): Promise<void> {
      const keys = await probe.keys(`${keyspace(scoped)}:instance*`);
      if (keys.length > 0) await probe.del(keys);
    },
    /** Ends the presence liveness of the instance booted as `name`. */
    async lapse(name: string): Promise<void> {
      const keys = await probe.keys(`${keyspace(scoped)}:instance:${name}-*`);
      assert.equal(keys.length, 1, `no liveness to end for ${name}`);
      await probe.del(keys);
    },
    async stop() {
      // None is attached to an http server, so `io.close()` has no engine to close.
      for (const io of servers) await io.of("/").adapter.close();
      for (const store of stores) store.close();
      for (const proxy of proxies) await proxy.close();
      await dropKeyspace(scoped);
    },
  };
}

/** Past the adapter's grace for a peer last heard. */
const PAST_THE_GRACE_MS = 11_000;

const verdict = ({ replies, err }: Answer) => (replies.length > 0 ? "answered" : err ? "error" : "alone");

/** An http-attached server with one client socket in `room`, which records what reaches it. */
async function withClient(c: ReturnType<typeof cluster>, name: string, through: Proxy, room: string) {
  const http = createServer();
  const io = c.boot(name, through, new Server(http, { transports: ["websocket"] }));
  io.on("connection", (s) => void s.join(room));
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const client: ClientSocket = connect(`http://127.0.0.1:${(http.address() as { port: number }).port}`, {
    transports: ["websocket"],
  });
  const received: unknown[] = [];
  client.on("state", (n: unknown) => received.push(n));
  await new Promise<void>((r) => client.on("connect", () => r()));
  return {
    io,
    received,
    async close() {
      client.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

describe("the cluster's count of its peers", { skip: hasDatabase() ? false : skipMessage() }, () => {
  before(() => probe.connect());
  after(async () => {
    probe.destroy();
    closeRedis();
  });

  describe("a 1.5 s outage of one link", () => {
    const c = cluster("count_blip");
    after(() => c.stop());

    test("nobody is told it is alone, during it or right after", { timeout: 60_000 }, async () => {
      const proxy = await c.link();
      const a = c.boot("a", proxy);
      const b = c.boot("b");
      assert.deepEqual((await Promise.all([c.answering(a), c.answering(b)])).map(verdict), ["answered", "answered"]);

      proxy.refuse(true);
      const asked: Promise<Answer>[] = [];
      for (let i = 0; i < 15; i++) {
        asked.push(c.ask(a), c.ask(b));
        await sleep(100);
      }
      proxy.refuse(false);
      for (let i = 0; i < 60; i++) {
        asked.push(c.ask(a), c.ask(b));
        await sleep(50);
      }
      const verdicts = (await Promise.all(asked)).map(verdict);
      assert.equal(verdicts.filter((v) => v === "alone").length, 0, `told it was alone: ${JSON.stringify(verdicts)}`);
      assert.deepEqual((await Promise.all([c.ask(a), c.ask(b)])).map(verdict), ["answered", "answered"]);
    });
  });

  describe("a peer on a revision that keeps no presence liveness", () => {
    const c = cluster("count_older");
    after(() => c.stop());

    test("is heard as one by its heartbeat, and this revision's peers are not", { timeout: 30_000 }, async () => {
      const a = c.boot("a");
      const b = c.boot("b");
      const hears = () => (a.of("/").adapter as unknown as OlderPeers).hearsOlderPeers();
      // b has answered, so its first beat, carrying this revision's marker, has gone out.
      await c.answering(a);
      assert.equal(hears(), false, "a peer on this revision was taken for an older one");
      b.serverSideEmit("murlan:adapter-heartbeat");
      await eventually(() => hears(), "an older revision's heartbeat to be heard");
    });

    test("this revision's heartbeat names its instance for inbox routing and still reads as keeping liveness", { timeout: 30_000 }, async () => {
      const c2 = cluster("count_current");
      after(() => c2.stop());
      const a = c2.boot("a");
      c2.boot("b");
      const hears = () => (a.of("/").adapter as unknown as OlderPeers).hearsOlderPeers();
      await c2.answering(a);
      await eventually(() => speaksInbox(instanceId), "a current peer's heartbeat to name it");
      assert.equal(hears(), false, "a current peer was taken for an older one");
    });
  });

  describe("a cluster whose presence liveness Redis lost", () => {
    const c = cluster("count_lost");
    after(() => c.stop());

    test("is still counted by its subscriptions until the beats put it back", { timeout: 30_000 }, async () => {
      const a = c.boot("a");
      c.boot("b");
      assert.deepEqual((await c.answering(a)).replies, ["b"]);
      await c.forgetLiveness();
      assert.deepEqual(verdict(await c.ask(a)), "answered", "a peer whose liveness Redis lost was not waited on");
    });
  });

  describe("a peer that boots while another's link is down", () => {
    const c = cluster("count_fresh");
    after(() => c.stop());

    test("does not stand in for the one that cannot answer", { timeout: 60_000 }, async () => {
      const ownerLink = await c.link();
      const a = c.boot("a");
      c.boot("owner", ownerLink);
      assert.deepEqual((await c.answering(a)).replies, ["owner"]);

      ownerLink.refuse(true);
      await eventually(async () => (await c.subscribed()) === 1, "the owner's subscription to drop");
      c.boot("fresh");
      await eventually(async () => (await c.subscribed()) === 2, "the fresh peer to subscribe");
      const during = await c.ask(a);
      assert.notEqual(during.err, null, `answered as if every peer replied: ${JSON.stringify(during)}`);
      ownerLink.refuse(false);
    });
  });

  describe("a peer that died while this instance's link was down", () => {
    const c = cluster("count_ghost");
    after(() => c.stop());

    test("is not waited on once its liveness lapses, whatever it left in the stream", { timeout: 60_000 }, async () => {
      const [mine, theirs] = [await c.link(), await c.link()];
      let skew = 0;
      const restoreClock = installClock({ ...realClock, now: () => realClock.now() + skew });
      const a = await withClient(c, "a", mine, "room");
      try {
        const b = c.boot("b", theirs);
        await c.answering(a.io);
        // A reader that has read nothing resumes from the stream's end, so it has read once.
        b.to("room").emit("state", -1);
        await eventually(() => a.received.includes(-1), "A to read the stream");

        mine.refuse(true);
        await eventually(async () => (await c.subscribed()) === 1, "A's subscription to drop");
        for (let i = 0; i < 5; i++) b.to("room").emit("state", i);
        await eventually(async () => (await c.streamLength()) >= 6, "B's broadcasts in the stream");
        theirs.refuse(true);
        await eventually(async () => (await c.subscribed()) === 0, "B's subscription to drop");
        // Past the grace for a peer last heard, and past its liveness's TTL, which B can no longer refresh.
        skew += PAST_THE_GRACE_MS;
        await c.lapse("b");
        mine.refuse(false);

        await eventually(() => a.received.includes(4), "A to read the backlog B left", 15_000);
        const answer = await c.settled(a.io);
        assert.equal(verdict(answer), "alone", `a dead peer was waited on: ${JSON.stringify(answer)}`);
      } finally {
        restoreClock();
        await a.close();
      }
    });
  });
});
