// tests/integration/presenceStore.test.ts — where each account is connected, on the real Redis:
// a late clear never erases a replacement, a dead instance's accounts are cleared and reported
// exactly once however many instances sweep it, and an instance whose liveness lapsed puts back
// what a sweep took from it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { eventually } from "../helpers/client.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { LEAVING_MS, openPresenceStore, type PresenceStore } from "../../server/store/presence.ts";
import { DRAINING_SPREAD_MS } from "../../lib/reconnectDelay.ts";
import { closeRedis, redisReady } from "../../server/store/redis.ts";
import { startProxy, targetOf, viaProxy } from "../helpers/tcpProxy.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { storePresence } from "../../server/socket/socketOutbox.ts";
import { sweepFinishedTables } from "../../server/game/gamePersistence.ts";
import { resumeOrphanedTables } from "../../server/game/tableLifecycle.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { startRound } from "../../lib/game/gameEngine.ts";
import { settleInFlight } from "../../server/shared/inFlight.ts";

describe("the presence store", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const redisUrl = process.env.REDIS_URL!;
  const probe = createClient({ url: redisUrl });
  probe.on("error", () => {});
  const opened: PresenceStore[] = [];
  const namespaces: string[] = [];

  /** Instances on one keyspace of their own, with no heartbeat of their own: each test beats them. */
  function cluster() {
    const ns = `murlan#presence_${randomUUID().slice(0, 8)}`;
    namespaces.push(ns);
    return {
      ns,
      open(id = randomUUID()) {
        const store = openPresenceStore({ id, ns, heartbeat: false });
        opened.push(store);
        return store;
      },
      key: (name: string) => `${ns}:${name}`,
    };
  }

  before(() => probe.connect());
  after(async () => {
    for (const store of opened) store.close();
    for (const ns of namespaces) {
      const keys: string[] = [];
      for await (const batch of probe.scanIterator({ MATCH: `${ns}:*`, COUNT: 500 })) keys.push(...batch);
      if (keys.length) await probe.del(keys);
    }
    probe.destroy();
    closeRedis();
  });

  test("an evicted socket's late clear leaves its replacement's entry and seat", async () => {
    const c = cluster();
    const [x, y] = [c.open(), c.open()];
    await redisReady();
    await Promise.all([x.beat(), y.beat()]);
    x.record("ana", "sock-a");
    x.seat("sock-a", "room-1");
    // Each connect is its own write, so the replacement's must be the later one.
    await eventually(async () => (await x.locate(["ana"])).get("ana")?.socket === "sock-a", "the first connection's entry");
    y.record("ana", "sock-b");
    y.seat("sock-b", "room-1");
    await eventually(async () => (await x.locate(["ana"])).get("ana")?.socket === "sock-b", "the replacement's entry");

    x.forget("ana", "sock-a");
    x.unseat("sock-a");
    // Clears run one at a time, so once a later one has landed the late one has too.
    x.record("zed", "sock-z");
    await eventually(async () => (await probe.exists(c.key("online:zed"))) === 1, "the barrier's entry");
    x.forget("zed", "sock-z");
    await eventually(async () => (await probe.exists(c.key("online:zed"))) === 0, "the late clear to land");
    assert.equal(await probe.exists(c.key("table:sock-a")), 0);

    const where = (await y.locate(["ana"], { tables: true })).get("ana");
    assert.deepEqual(where, { instance: y.id, socket: "sock-b", table: "room-1" });
    assert.equal(await probe.sIsMember(c.key(`instance-users:${y.id}`), "ana"), 1);
  });

  test("a clear by the socket the entry names removes it, and its instance stops listing the account", async () => {
    const c = cluster();
    const x = c.open();
    await redisReady();
    await x.beat();
    x.record("ben", "sock-1");
    await eventually(async () => (await x.locate(["ben"])).has("ben"), "the entry");
    x.forget("ben", "sock-1");
    await eventually(async () => (await probe.exists(c.key("online:ben"))) === 0, "the entry to clear");
    await eventually(async () => (await probe.sIsMember(c.key(`instance-users:${x.id}`), "ben")) === 0, "the listing to clear");
  });

  test("an entry whose instance has no liveness reads as offline", async () => {
    const c = cluster();
    const [x, y] = [c.open(), c.open()];
    await redisReady();
    await Promise.all([x.beat(), y.beat()]);
    y.record("cara", "sock-c");
    await eventually(async () => (await x.locate(["cara"])).has("cara"), "the entry");
    await probe.del(c.key(`instance:${y.id}`));
    assert.equal((await x.locate(["cara"])).has("cara"), false);
    assert.equal(await x.livePeers(), 0);
  });

  test("two live instances sweep one dead one at once, and each of its accounts is reported exactly once", async () => {
    const c = cluster();
    const [a, b, dead] = [c.open(), c.open(), c.open()];
    await redisReady();
    await Promise.all([a.beat(), b.beat(), dead.beat()]);
    const users = Array.from({ length: 20 }, (_, i) => `u${i}`);
    for (const u of users) {
      dead.record(u, `s-${u}`);
      dead.seat(`s-${u}`, "room-d");
    }
    a.record("alive", "s-alive");
    await eventually(async () => (await a.locate(users)).size === users.length, "the dead instance's entries");

    const reported: string[] = [];
    const leftAts = new Set<Date | null>();
    for (const x of [a, b]) x.onLost((ids, leftAt) => (reported.push(...ids), leftAts.add(leftAt)));
    dead.close();
    await probe.del(c.key(`instance:${dead.id}`));
    await Promise.all([a.beat(), b.beat(), a.beat(), b.beat()]);

    assert.deepEqual([...reported].sort(), [...users].sort(), "an account was reported twice, or not at all");
    assert.deepEqual([...leftAts], [null], "a crashed instance was said to have left at a time");
    assert.equal((await a.locate(users)).size, 0);
    assert.equal(await probe.exists(users.map((u) => c.key(`online:${u}`))), 0);
    assert.equal(await probe.exists(users.map((u) => c.key(`table:s-${u}`))), 0);
    assert.equal(await probe.exists(c.key(`instance-users:${dead.id}`)), 0);
    assert.equal(await probe.sIsMember(c.key("instances"), dead.id), 0);
    assert.equal((await a.locate(["alive"])).has("alive"), true, "a live instance's account was swept");
  });

  test("a leaving instance's departures are reported by a peer's sweep once the reconnect window has passed, and one that came back elsewhere never", async () => {
    const c = cluster();
    const [peer, leaving] = [c.open(), c.open()];
    await redisReady();
    await Promise.all([peer.beat(), leaving.beat()]);
    leaving.record("early", "s-early");
    leaving.record("gone", "s-gone");
    leaving.record("back", "s-back");
    await eventually(async () => (await peer.locate(["early", "gone", "back"])).size === 3, "the entries");
    const reported: string[] = [];
    let leftAt: Date | null = null;
    peer.onLost((ids, at) => {
      reported.push(...ids);
      leftAt = at;
    });

    assert.equal(leaving.forget("early", "s-early"), false, "a departure before leave() is its own instance's to report");
    await eventually(async () => !(await peer.locate(["early"])).has("early"), "the early departure's clear");
    const leaveAt = Date.now();
    leaving.leave();
    await eventually(async () => (await probe.exists(c.key(`instance:${leaving.id}`))) === 0, "the liveness to go");
    assert.equal(leaving.forget("gone", "s-gone"), true, "a departure after leave() was not left to the sweep");
    assert.equal(leaving.forget("back", "s-back"), true);
    assert.equal((await peer.locate(["gone"])).has("gone"), false, "a leaving instance's account reads as online, so a seat it held is never released");
    assert.deepEqual(await peer.liveInstances(), [], "a leaving instance reads as a peer to hand work to");
    assert.deepEqual([...(await peer.departing(["gone", "early"]))], ["gone"]);
    peer.record("back", "s-back-2");
    await eventually(async () => (await peer.locate(["back"])).get("back")?.instance === peer.id, "the reconnect's entry");
    assert.deepEqual([...(await peer.departing(["back"]))], [], "an account that came back elsewhere reads as departing");
    await peer.beat();
    assert.deepEqual(reported, [], "a departure was reported inside the reconnect window");

    const window = await probe.pTTL(c.key(`instance-leaving:${leaving.id}`));
    assert.ok(window > DRAINING_SPREAD_MS && window <= LEAVING_MS, `the window is ${window} ms`);
    await probe.del(c.key(`instance-leaving:${leaving.id}`));
    await peer.beat();
    assert.deepEqual(reported, ["gone"]);
    const said = leftAt as Date | null;
    assert.ok(said && Math.abs(said.getTime() - leaveAt) < 2_000, `the sweep said the instance left at ${said?.toISOString()}`);
    assert.equal(await probe.exists(c.key(`instance-left:${leaving.id}`)), 0, "the leaving time outlived the final sweep");
    assert.equal((await peer.locate(["back"])).get("back")?.instance, peer.id, "the reconnect's entry was swept");
  });

  test("a departure after leave() whose connect never reached Redis is cleared at once, not left to a sweep", async () => {
    const c = cluster();
    const [peer, leaving] = [c.open(), c.open()];
    await redisReady();
    await Promise.all([peer.beat(), leaving.beat()]);
    const reported: string[] = [];
    peer.onLost((ids) => reported.push(...ids));
    leaving.record("fresh", "s-fresh");
    leaving.leave();
    assert.equal(leaving.forget("fresh", "s-fresh"), false, "a departure no sweep can see was left to one");
    await eventually(async () => (await probe.exists(c.key("online:fresh"))) === 0, "the entry to be cleared");
    await probe.del(c.key(`instance-leaving:${leaving.id}`));
    await peer.beat();
    assert.deepEqual(reported, []);
  });

  test("a clear that failed before leave() is made by leave(), with no beat left to retry it", async () => {
    const c = cluster();
    const proxy = await startProxy(targetOf(redisUrl, 6379));
    try {
      const peer = c.open();
      const x = openPresenceStore({ ns: c.ns, url: viaProxy(redisUrl, proxy), heartbeat: false });
      opened.push(x);
      await redisReady();
      await Promise.all([peer.beat(), x.beat()]);
      const reported: string[] = [];
      peer.onLost((ids) => reported.push(...ids));
      x.record("uli", "s-uli");
      await eventually(async () => (await peer.locate(["uli"])).has("uli"), "the entry");
      proxy.refuse(true);
      await eventually(() => x.locate(["uli"]).then(() => false, () => true), "reads to fail");
      assert.equal(x.forget("uli", "s-uli"), false);
      await settleInFlight(10_000);
      assert.equal(await probe.exists(c.key("online:uli")), 1, "the clear reached Redis while it was refused");
      proxy.refuse(false);
      await eventually(() => x.locate(["uli"]).then(() => true, () => false), "the link to come back");
      x.leave();
      await eventually(async () => (await probe.exists(c.key(`instance:${x.id}`))) === 0, "the liveness to go");
      assert.equal(await probe.exists(c.key("online:uli")), 0, "the failed clear was never retried");
      await probe.del(c.key(`instance-leaving:${x.id}`));
      await peer.beat();
      assert.deepEqual(reported, [], "an account cleared before leave() was announced again by the sweep");
    } finally {
      await proxy.close();
    }
  });

  test("an instance swept while its liveness lapsed puts its accounts back on its next beat", async () => {
    const c = cluster();
    const [a, stalled] = [c.open(), c.open()];
    await redisReady();
    await Promise.all([a.beat(), stalled.beat()]);
    stalled.record("dora", "s-dora");
    stalled.seat("s-dora", "room-s");
    await eventually(async () => (await a.locate(["dora"])).has("dora"), "the entry");

    await probe.del(c.key(`instance:${stalled.id}`));
    await a.beat();
    assert.equal((await a.locate(["dora"])).has("dora"), false, "the sweep did not run");

    await stalled.beat();
    await eventually(async () => (await a.locate(["dora"], { tables: true })).get("dora")?.table === "room-s", "the entry to come back");
    assert.equal(await probe.sIsMember(c.key(`instance-users:${stalled.id}`), "dora"), 1);
  });

  test("the social version moves with each change, and with the store's lifetime", async () => {
    const c = cluster();
    const x = c.open();
    await redisReady();
    await x.beat();
    const first = await x.social("fay");
    assert.ok(first, "no version for an account with no change yet");
    x.bumpSocial(["fay", "gil"]);
    const second = await eventually(async () => {
      const now = await x.social("fay");
      return now !== first ? now : null;
    }, "the version to move");
    assert.notEqual(await x.social("gil"), first);
    await probe.del(c.key("social-epoch"));
    assert.equal(await x.social("fay"), null, "a version read with no lifetime cannot be compared");
    await x.beat();
    const third = await x.social("fay");
    assert.ok(third && third !== second, "a version after the store lost its lifetime matched one from before");
  });

  test("with Redis stopped, both sweeps and a restore's presence answer null, and nothing is disposed or woken", async (t) => {
    const c = cluster();
    const proxy = await startProxy(targetOf(redisUrl, 6379));
    t.after(() => proxy.close());
    const store = openPresenceStore({ ns: c.ns, url: viaProxy(redisUrl, proxy), heartbeat: false });
    opened.push(store);
    await redisReady();
    store.record("ana", "s-ana");
    proxy.refuse(true);
    await eventually(() => store.locate(["ana"]).then(() => false, () => true), "reads to fail");

    const presence = storePresence((ids, opts) => store.locate(ids, opts));
    const { rt } = recordingRuntime({ presence });
    const ROOM = `stopped-${randomUUID()}`;
    const seats = ["Ana", "Besi"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));
    activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 0: "ana", 1: "besi" }, gameState: { ...startRound(seats, "free_for_all"), roundOver: true } }));
    t.after(() => activeGames.delete(ROOM));
    t.mock.method(activeGameStore, "listResumable", async () => [{ roomId: `${ROOM}-asleep`, userIds: ["ana"], roundOver: false, pending: false }]);
    const routed = t.mock.method(rt, "route", async () => ({ ok: true }));

    assert.equal(await presence.tablePresence(ROOM, ["ana", "besi"]), null, "a restore would read nobody at the table");
    await sweepFinishedTables(rt);
    assert.equal(activeGames.has(ROOM), true, "a finished table was disposed on a store that did not answer");
    await resumeOrphanedTables(rt);
    assert.equal(routed.mock.callCount(), 0, "a table was woken on a store that did not answer");
    proxy.refuse(false);
  });

  test("a clear whose link reconnects between its WATCH and its EXEC is tried again, not dropped", { timeout: 180_000 }, async () => {
    const c = cluster();
    const link = await startProxy(targetOf(redisUrl, 6379));
    let cut = false;
    const x = openPresenceStore({
      ns: c.ns,
      url: viaProxy(redisUrl, link),
      heartbeat: false,
      hooks: { beforeExec: async () => {
        if (cut) return;
        cut = true;
        link.refuse(true);
        await eventually(() => x.locate(["probe"]).then(() => false, () => true), "the cut link to go down");
        link.refuse(false);
        // Both of the store's links, its guarded one included, named to Redis again: past their handshake.
        await eventually(async () => {
          const ports = link.links.filter((l) => !l.dead).map((l) => l.server.localPort);
          const named = ((await probe.sendCommand(["CLIENT", "LIST"])) as string)
            .split("\n")
            .filter((line) => line.includes("name=murlan-presence") && ports.some((p) => line.includes(`addr=127.0.0.1:${p} `)));
          return ports.length >= 2 && named.length >= 2;
        }, "both cut links to come back");
        await eventually(() => x.locate(["probe"]).then(() => true, () => false), "the cut link to answer");
      } },
    });
    opened.push(x);
    try {
      await eventually(() => x.beat().then(() => true, () => false), "a first beat");
      x.record("hal", "s-hal");
      await eventually(async () => (await probe.exists(c.key("online:hal"))) === 1, "the entry");
      x.forget("hal", "s-hal");
      // Driven as the heartbeat would: a clear the cut failed outright is retried there, and one read as done never is.
      await eventually(async () => {
        await x.beat().catch(() => {});
        return (await probe.exists(c.key("online:hal"))) === 0;
      }, "the clear the cut interrupted to land", 15_000);
      assert.equal(cut, true, "the link was never cut between WATCH and EXEC");
    } finally {
      await link.close();
    }
  });

  test("an instance whose players a peer swept during its lapse says they are back", async () => {
    const c = cluster();
    const [a, stalled] = [c.open(), c.open()];
    await redisReady();
    await Promise.all([a.beat(), stalled.beat()]);
    stalled.record("ivo", "s-ivo");
    await eventually(async () => (await a.locate(["ivo"])).has("ivo"), "the entry");
    const lostHere: string[] = [];
    const back: string[] = [];
    a.onLost((ids) => lostHere.push(...ids));
    stalled.onRestored((ids) => back.push(...ids));

    await probe.del(c.key(`instance:${stalled.id}`));
    await a.beat();
    assert.deepEqual(lostHere, ["ivo"], "the sweep did not tell anyone the account went");
    await stalled.beat();
    assert.deepEqual(back, ["ivo"], "the instance did not say its account is back");
    assert.equal((await a.locate(["ivo"])).has("ivo"), true);
  });

  test("a mark that could not reach Redis is made on the next beat", async () => {
    const c = cluster();
    const proxy = await startProxy(targetOf(redisUrl, 6379));
    try {
      const x = openPresenceStore({ ns: c.ns, url: viaProxy(redisUrl, proxy), heartbeat: false });
      opened.push(x);
      await redisReady();
      await x.beat();
      const first = await x.social("kim");
      proxy.refuse(true);
      await eventually(() => x.locate(["kim"]).then(() => false, () => true), "reads to fail");
      x.bumpSocial(["kim"]);
      proxy.refuse(false);
      await eventually(() => x.beat().then(() => true, () => false), "a beat to land");
      assert.notEqual(await x.social("kim"), first, "the mark made while Redis was away was never made");
    } finally {
      await proxy.close();
    }
  });

  test("a refill whose socket went during its awaits writes nothing", async () => {
    const c = cluster();
    const link = await startProxy(targetOf(redisUrl, 6379));
    let x: PresenceStore | undefined;
    x = openPresenceStore({
      ns: c.ns,
      url: viaProxy(redisUrl, link),
      heartbeat: false,
      hooks: { beforeRefill: async (userId) => void (userId === "lea" && x?.forget("lea", "s-lea")) },
    });
    opened.push(x);
    try {
      await eventually(() => x.beat().then(() => true, () => false), "a first beat");
      link.refuse(true);
      await eventually(() => x.locate(["probe"]).then(() => false, () => true), "the link down");
      x.record("lea", "s-lea");
      link.refuse(false);
      await eventually(async () => {
        await x.beat().catch(() => {});
        return x.locate(["probe"]).then(() => true, () => false);
      }, "the link back and a beat landed");
      await x.beat();
      assert.equal(await probe.exists(c.key("online:lea")), 0, "a socket that went was put back online");
    } finally {
      await link.close();
    }
  });

  test("a sweep that fails part-way still reports the accounts it already cleared", async () => {
    const c = cluster();
    const users = Array.from({ length: 150 }, (_, i) => `w${i}`);
    const dead = c.open();
    let batches = 0;
    const a = openPresenceStore({
      ns: c.ns,
      heartbeat: false,
      hooks: { beforeExec: async (keys) => {
        if (keys.length > 1 && keys[0] === c.key(`instance:${dead.id}`) && ++batches === 2) throw new Error("the link went before the second batch");
      } },
    });
    opened.push(a);
    await redisReady();
    await Promise.all([a.beat(), dead.beat()]);
    for (const u of users) dead.record(u, `s-${u}`);
    await eventually(async () => (await a.locate(users)).size === users.length, "the dead instance's entries");
    const reported: string[] = [];
    a.onLost((ids) => reported.push(...ids));
    dead.close();
    await probe.del(c.key(`instance:${dead.id}`));
    await assert.rejects(a.beat());
    assert.equal(reported.length, 100, "the first batch's accounts were cleared and their friends never told");
    assert.equal(await probe.exists(reported.map((u) => c.key(`online:${u}`))), 0);
  });
});
