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
import { openPresenceStore, type PresenceStore } from "../../server/store/presence.ts";
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
    a.onLost((ids) => reported.push(...ids));
    b.onLost((ids) => reported.push(...ids));
    dead.close();
    await probe.del(c.key(`instance:${dead.id}`));
    await Promise.all([a.beat(), b.beat(), a.beat(), b.beat()]);

    assert.deepEqual([...reported].sort(), [...users].sort(), "an account was reported twice, or not at all");
    assert.equal((await a.locate(users)).size, 0);
    assert.equal(await probe.exists(users.map((u) => c.key(`online:${u}`))), 0);
    assert.equal(await probe.exists(users.map((u) => c.key(`table:s-${u}`))), 0);
    assert.equal(await probe.exists(c.key(`instance-users:${dead.id}`)), 0);
    assert.equal(await probe.sIsMember(c.key("instances"), dead.id), 0);
    assert.equal((await a.locate(["alive"])).has("alive"), true, "a live instance's account was swept");
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

  test("an entry in the hash format an older instance still writes is left alone, and costs no error", async () => {
    const c = cluster();
    const x = c.open();
    await redisReady();
    await x.beat();
    await probe.hSet(c.key("presence:eli"), { instance: "old-instance", socket: "old-sock" });
    x.record("eli", "new-sock");
    await eventually(async () => (await x.locate(["eli"])).get("eli")?.socket === "new-sock", "the new entry");
    x.forget("eli", "new-sock");
    await eventually(async () => (await probe.exists(c.key("online:eli"))) === 0, "the new entry to clear");
    assert.deepEqual(await probe.hGetAll(c.key("presence:eli")), { instance: "old-instance", socket: "old-sock" });
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

  test("a clear whose link reconnects between its WATCH and its EXEC is tried again, not dropped", async () => {
    const c = cluster();
    let cut = false;
    const ids = async () =>
      ((await probe.sendCommand(["CLIENT", "LIST"])) as string)
        .split("\n")
        .filter((line) => line.includes("name=murlan-presence"))
        .map((line) => /id=(\d+)/.exec(line)![1]!);
    const before = new Set(await ids());
    const x = openPresenceStore({
      ns: c.ns,
      heartbeat: false,
      beforeExec: async () => {
        if (cut) return;
        cut = true;
        // This store's two links are the newest; killing both takes the guarded one with it.
        for (const id of (await ids()).filter((i) => !before.has(i))) await probe.sendCommand(["CLIENT", "KILL", "ID", id]);
        await eventually(async () => (await ids()).filter((i) => !before.has(i)).length >= 2, "the links to reconnect");
      },
    });
    opened.push(x);
    await redisReady();
    await x.beat();
    x.record("hal", "s-hal");
    await eventually(async () => (await probe.exists(c.key("online:hal"))) === 1, "the entry");
    x.forget("hal", "s-hal");
    await eventually(async () => (await probe.exists(c.key("online:hal"))) === 0, "the clear to land after its link came back", 10_000);
    assert.equal(cut, true, "the link was never cut between WATCH and EXEC");
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

  test("an account with no entry yet on an older instance's hash is found there", async () => {
    const c = cluster();
    const x = c.open();
    await redisReady();
    await x.beat();
    await probe.hSet(c.key("presence:jon"), { instance: "older", socket: "s-old" });
    assert.deepEqual((await x.locate(["jon"], { tables: true })).get("jon"), { instance: "older", socket: "s-old", table: null });
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
});
