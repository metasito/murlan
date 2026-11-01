// tests/integration/clusterCount.test.ts — an instance that cannot be sure it heard every live
// peer says so, and never answers that it is alone; one that is alone says so at once.
//
// "Nobody else holds this table" is what lets a caller release a seat or take a table over, so a
// count that comes up short while a peer is alive and holding tables is a destructive answer. The
// count is short whenever a peer's subscriber is not subscribed at that moment: while its Redis
// link is down, and in the seconds while it resubscribes. A count that is long, a dead peer still
// waited on, costs every cross-instance request its full timeout.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { createSocketAdapter } from "../../server/socket/socketAdapter.ts";
import { closeRedis, redisReady } from "../../server/store/redis.ts";

const NOT_SUBSCRIBED = /not subscribed/;

const baseUrl = process.env.DATABASE_URL ?? "";
const redisUrl = process.env.REDIS_URL ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Answer {
  replies: string[];
  err: string | null;
}

/** Servers on one keyspace of their own, each answering "probe" with its name. */
function cluster(tag: string) {
  const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${tag}_${Date.now()}`;
  const servers: Server[] = [];
  const proxies: Proxy[] = [];
  return {
    async link(): Promise<Proxy> {
      const proxy = await startProxy(targetOf(redisUrl, 6379));
      proxies.push(proxy);
      return proxy;
    },
    boot(name: string, through?: Proxy, io = new Server()): Server {
      process.env.DATABASE_URL = scoped;
      process.env.REDIS_URL = through ? viaProxy(redisUrl, through) : redisUrl;
      io.adapter(createSocketAdapter());
      process.env.DATABASE_URL = baseUrl;
      process.env.REDIS_URL = redisUrl;
      io.on("probe", (reply: (r: string) => void) => reply(name));
      servers.push(io);
      return io;
    },
    ask(from: Server): Promise<Answer> {
      return new Promise((resolve) =>
        from.serverSideEmit("probe", (err: Error | null, replies: string[]) =>
          resolve({ replies: [...replies].sort(), err: err ? err.message : null })
        )
      );
    },
    async stop() {
      // None is attached to an http server, so `io.close()` has no engine to close.
      for (const io of servers) await io.of("/").adapter.close();
      for (const proxy of proxies) await proxy.close();
      await dropKeyspace(scoped);
    },
  };
}

const verdict = ({ replies, err }: Answer) => (replies.length > 0 ? "answered" : err ? "error" : "alone");

describe("the cluster's count of its peers", { skip: hasDatabase() ? false : skipMessage() }, () => {
  after(() => closeRedis());

  describe("a 1.5 s outage of one link", () => {
    const c = cluster("count_blip");
    after(() => c.stop());

    test("nobody is told it is alone, during it or right after", { timeout: 60_000 }, async () => {
      const proxy = await c.link();
      const a = c.boot("a", proxy);
      const b = c.boot("b");
      await redisReady();
      assert.deepEqual((await Promise.all([c.ask(a), c.ask(b)])).map(verdict), ["answered", "answered"]);

      proxy.refuse(true);
      const asked: Promise<Answer>[] = [];
      const sockets: Promise<unknown>[] = [];
      for (let i = 0; i < 15; i++) {
        asked.push(c.ask(a), c.ask(b));
        sockets.push(b.fetchSockets().then(() => "alone", () => "error"));
        await sleep(100);
      }
      proxy.refuse(false);
      for (let i = 0; i < 60; i++) {
        asked.push(c.ask(a), c.ask(b));
        await sleep(50);
      }
      const verdicts = (await Promise.all(asked)).map(verdict);
      assert.equal(verdicts.filter((v) => v === "alone").length, 0, `told it was alone: ${JSON.stringify(verdicts)}`);
      assert.deepEqual([...new Set(await Promise.all(sockets))], ["error"], "fetchSockets answered from this instance alone");
      assert.deepEqual((await Promise.all([c.ask(a), c.ask(b)])).map(verdict), ["answered", "answered"]);
    });
  });

  describe("a peer that boots while another's link is down", () => {
    const c = cluster("count_fresh");
    after(() => c.stop());

    test("does not stand in for the one that cannot answer", { timeout: 60_000 }, async () => {
      const ownerLink = await c.link();
      const a = c.boot("a");
      c.boot("owner", ownerLink);
      await redisReady();
      assert.deepEqual((await c.ask(a)).replies, ["owner"]);

      ownerLink.refuse(true);
      await sleep(200);
      c.boot("fresh");
      await sleep(700);
      const during = await c.ask(a);
      assert.notEqual(during.err, null, `answered as if every peer replied: ${JSON.stringify(during)}`);
      ownerLink.refuse(false);
    });
  });

  describe("a peer that died while this instance's link was down", () => {
    const c = cluster("count_ghost");
    after(() => c.stop());

    test("is not brought back by the broadcasts it left in the stream", { timeout: 60_000 }, async () => {
      const [mine, theirs] = [await c.link(), await c.link()];
      const a = c.boot("a", mine);
      const b = c.boot("b", theirs);
      await redisReady();
      // A reader that has read nothing resumes from the stream's end, so it has read once.
      b.to("room").emit("state", -1);
      await sleep(300);
      assert.equal(verdict(await c.ask(a)), "answered");

      mine.refuse(true);
      await sleep(300);
      for (let i = 0; i < 5; i++) b.to("room").emit("state", i);
      await sleep(300);
      theirs.refuse(true);
      await sleep(11_000);
      mine.refuse(false);

      let first: Answer | undefined;
      for (let i = 0; i < 100 && !first; i++) {
        const answer = await c.ask(a);
        if (answer.err && NOT_SUBSCRIBED.test(answer.err)) await sleep(200);
        else first = answer;
      }
      assert.ok(first, "A never subscribed again");
      const answers = [first];
      // The backlog is read back after the link returns, so the asks go on past that.
      for (let i = 0; i < 6; i++) {
        await sleep(500);
        answers.push(await c.ask(a));
      }
      assert.deepEqual(answers.map(verdict), answers.map(() => "alone"), `a dead peer was waited on: ${JSON.stringify(answers)}`);
    });
  });

  describe("an instance whose link is down", () => {
    const c = cluster("count_local");
    after(() => c.stop());

    test("still finds its own sockets, while a cluster-wide ask fails", { timeout: 30_000 }, async () => {
      const link = await c.link();
      const http = createServer();
      const io = c.boot("x", link, new Server(http, { transports: ["websocket"] }));
      io.on("connection", (s) => void s.join("user:x"));
      await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
      const client = connect(`http://127.0.0.1:${(http.address() as { port: number }).port}`, { transports: ["websocket"] });
      try {
        await new Promise<void>((r) => client.on("connect", () => r()));
        await redisReady();
        link.refuse(true);
        await sleep(300);
        assert.equal((await io.local.in("user:x").fetchSockets()).length, 1, "the local pass lost this instance's socket");
        await assert.rejects(io.in("user:x").fetchSockets(), "a cluster-wide ask answered from this instance alone");
      } finally {
        client.close();
        await new Promise<void>((r) => http.close(() => r()));
      }
    });
  });
});
