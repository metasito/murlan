// A lock query that fails says nothing about who holds the lock, so a reclaim that meets one
// keeps the room and asks again rather than disposing a table it may still own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Client } from "pg";
import {
  claimRoom,
  closeOwnership,
  ownsRoom,
  releaseRoom,
  releaseRoomAfter,
  reopenOwnership,
  unclaimedRooms,
} from "../../server/game/gameOwnership.ts";
import { eventually } from "../helpers/client.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { activeGames } from "../../server/game/gameRoom.ts";

test("a lock query that throws once does not give the room up", async (t) => {
  const clients: EventEmitter[] = [];
  let lockQueries = 0;
  let throwNext = false;
  t.mock.method(Client.prototype, "connect", async function (this: EventEmitter) {
    clients.push(this);
  });
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async (sql: string) => {
    if (!/pg_try_advisory_lock/.test(sql)) return { rows: [] };
    lockQueries++;
    if (throwNext) {
      throwNext = false;
      throw new Error("Query read timeout");
    }
    return { rows: [{ locked: true }] };
  });
  const lost: string[] = [];
  reopenOwnership({ onRoomLost: (roomId) => lost.push(roomId) });
  t.after(() => closeOwnership());

  assert.equal(await claimRoom("reclaim-room"), true);

  throwNext = true;
  clients[0].emit("error", new Error("Connection terminated unexpectedly"));
  await eventually(() => lockQueries >= 3, "the reclaim asking for the lock again after the failed query");

  assert.deepEqual(lost, [], "a failed lock query was read as the room being held elsewhere");
  assert.equal(ownsRoom("reclaim-room"), true);
  assert.ok(lockQueries >= 3, "the reclaim never asked for the lock again after the failed query");
});

test("a release while the room's delete is pending does not unlock it early", async (t) => {
  let unlocks = 0;
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async (sql: string) => {
    if (/pg_advisory_unlock/.test(sql)) unlocks++;
    if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
    return { rows: [] };
  });
  reopenOwnership({ onRoomLost: () => {} });
  t.after(() => closeOwnership());

  assert.equal(await claimRoom("dying-room"), true);
  let deleteLands!: () => void;
  const released = releaseRoomAfter("dying-room", new Promise<void>((r) => (deleteLands = r)));

  await releaseRoom("dying-room");
  assert.equal(unlocks, 0, "the room was unlocked before its row delete landed");

  deleteLands();
  await released;
  assert.equal(unlocks, 1);
  assert.equal(ownsRoom("dying-room"), false);
});

test("an earlier pending release does not unlock under a later one", async (t) => {
  let unlocks = 0;
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async (sql: string) => {
    if (/pg_advisory_unlock/.test(sql)) unlocks++;
    if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
    return { rows: [] };
  });
  reopenOwnership({ onRoomLost: () => {} });
  t.after(() => closeOwnership());

  assert.equal(await claimRoom("twice-dying-room"), true);
  let firstLands!: () => void;
  let secondLands!: () => void;
  const first = releaseRoomAfter("twice-dying-room", new Promise<void>((r) => (firstLands = r)));
  const second = releaseRoomAfter("twice-dying-room", new Promise<void>((r) => (secondLands = r)));

  firstLands();
  await first;
  assert.equal(unlocks, 0, "the first release unlocked while the second delete was still pending");
  assert.equal(ownsRoom("twice-dying-room"), true);

  secondLands();
  await second;
  assert.equal(unlocks, 1);
  assert.equal(ownsRoom("twice-dying-room"), false);
});

test("a close cancels the reclaim still waiting to retry, so it does not reach into the next run", async (t) => {
  const pg = fakePostgres(t);
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  openOwnership(t);

  await claimRoom("own-before-close");
  pg.refuseConnect = true;
  pg.clients[0].emit("error", new Error("Connection terminated unexpectedly"));
  await settle();

  await closeOwnership();
  pg.refuseConnect = false;
  reopenOwnership({ onRoomLost: () => {} });
  assert.equal(await claimRoom("own-after-close"), true);
  const locks = pg.sent(/pg_try_advisory_lock/).length;

  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(pg.sent(/pg_try_advisory_lock/).length, locks, "a retry from before the close ran after it");
});

type Wire = EventEmitter & { ended: number };
type Query = { sql: string; params: unknown[] | undefined; client: Wire };

/**
 * Postgres as ownership sees it: every connection it opens, every statement it sends, and a
 * `lockAnswer` the test sets to say who holds a room. `fail` makes statements matching it throw.
 */
function fakePostgres(t: import("node:test").TestContext) {
  const clients: Wire[] = [];
  const queries: Query[] = [];
  const pg = {
    clients,
    queries,
    connects: 0,
    refuseConnect: false,
    endRejects: false,
    gateConnect: null as Promise<void> | null,
    lockAnswer: (_roomKey: unknown): boolean => true,
    fail: null as RegExp | null,
    sent: (re: RegExp) => queries.filter((q) => re.test(q.sql)),
  };
  t.mock.method(Client.prototype, "connect", async function (this: Wire) {
    pg.connects++;
    clients.push(this);
    this.ended = 0;
    await pg.gateConnect;
    if (pg.refuseConnect) throw new Error("connection refused");
  });
  t.mock.method(Client.prototype, "end", async function (this: Wire) {
    this.ended++;
    if (pg.endRejects) throw new Error("already closed");
  });
  t.mock.method(Client.prototype, "query", async function (this: Wire, sql: string, params?: unknown[]) {
    queries.push({ sql, params, client: this });
    if (pg.fail?.test(sql)) throw new Error("query failed");
    if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: pg.lockAnswer(params?.[0]) }] };
    return { rows: [] };
  });
  return pg;
}

/** Lets promise chains and the connections they open run to a rest; timers are mocked, so no waiting. */
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
}

function openOwnership(t: import("node:test").TestContext, lost: string[] = []) {
  reopenOwnership({ onRoomLost: (roomId) => lost.push(roomId) });
  t.after(() => closeOwnership());
  return lost;
}

test("a room taken is not asked for again, and one release hands it back to be claimed again", async (t) => {
  const pg = fakePostgres(t);
  openOwnership(t);

  assert.equal(await claimRoom("own-twice"), true);
  assert.equal(await claimRoom("own-twice"), true);
  assert.equal(pg.sent(/pg_try_advisory_lock/).length, 1, "a room already held was asked for again");

  await releaseRoom("own-twice");
  assert.equal(ownsRoom("own-twice"), false);
  assert.equal(pg.sent(/pg_advisory_unlock/).length, 1);
  await releaseRoom("own-twice");
  assert.equal(pg.sent(/pg_advisory_unlock/).length, 1, "a room not held was unlocked");

  assert.equal(await claimRoom("own-twice"), true);
  assert.equal(ownsRoom("own-twice"), true);
});

test("a room held elsewhere is refused and not owned, and is asked for again next time", async (t) => {
  const pg = fakePostgres(t);
  pg.lockAnswer = () => false;
  openOwnership(t);

  assert.equal(await claimRoom("own-elsewhere"), false);
  assert.equal(ownsRoom("own-elsewhere"), false);
  assert.equal(await claimRoom("own-elsewhere"), false);
  assert.equal(pg.sent(/pg_try_advisory_lock/).length, 2);

  pg.lockAnswer = () => true;
  assert.equal(await claimRoom("own-elsewhere"), true);
});

test("a lock and its unlock name the same room, and two rooms name different ones", async (t) => {
  const pg = fakePostgres(t);
  openOwnership(t);

  await claimRoom("own-key-a");
  await claimRoom("own-key-b");
  await releaseRoom("own-key-a");

  const [lockA, lockB] = pg.sent(/pg_try_advisory_lock/).map((q) => q.params?.[0]);
  const [unlockA] = pg.sent(/pg_advisory_unlock/).map((q) => q.params?.[0]);
  assert.notEqual(lockA, lockB);
  assert.equal(unlockA, lockA);
});

test("a database that cannot be reached refuses the claim, and the next claim tries the connection again", async (t) => {
  const pg = fakePostgres(t);
  pg.refuseConnect = true;
  openOwnership(t);

  assert.equal(await claimRoom("own-down"), false);
  assert.equal(ownsRoom("own-down"), false);
  assert.equal(pg.clients[0].ended, 1, "the connection that failed was left open");

  pg.refuseConnect = false;
  assert.equal(await claimRoom("own-down"), true);
  assert.equal(pg.connects, 2);
});

test("a lock query that fails refuses the claim", async (t) => {
  const pg = fakePostgres(t);
  pg.fail = /pg_try_advisory_lock/;
  openOwnership(t);

  assert.equal(await claimRoom("own-query-fails"), false);
  assert.equal(ownsRoom("own-query-fails"), false);
});

test("a server that refuses the keepalive settings still lets the room be claimed", async (t) => {
  const pg = fakePostgres(t);
  pg.fail = /tcp_keepalives/;
  openOwnership(t);

  assert.equal(await claimRoom("own-keepalive"), true);
  assert.equal(ownsRoom("own-keepalive"), true);
  assert.equal(pg.clients[0].ended, 0);
});

test("one connection serves every room, and claims racing its opening share it", async (t) => {
  const pg = fakePostgres(t);
  openOwnership(t);

  const claims = await Promise.all([claimRoom("own-share-a"), claimRoom("own-share-b")]);
  assert.deepEqual(claims, [true, true]);
  await claimRoom("own-share-c");
  assert.equal(pg.connects, 1);
});

test("a close that lands while the connection is opening leaves nothing open and refuses the claim", async (t) => {
  const pg = fakePostgres(t);
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  let opened!: () => void;
  pg.gateConnect = new Promise<void>((resolve) => (opened = resolve));
  openOwnership(t);

  const claim = claimRoom("own-closing");
  await settle();
  const closing = closeOwnership();
  opened();
  await closing;

  assert.equal(await claim, false);
  assert.equal(ownsRoom("own-closing"), false);
  assert.equal(pg.clients[0].ended, 1, "the connection that arrived after the close was left open");
  t.mock.timers.tick(60_000);
  assert.equal(pg.sent(/SELECT 1/).length, 0, "a connection the close refused went on checking in");
});

test("a close ends the connection once, stops the heartbeat, and a reopened ownership claims again", async (t) => {
  const pg = fakePostgres(t);
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  openOwnership(t);

  await claimRoom("own-close");
  await closeOwnership();
  assert.equal(pg.clients[0].ended, 1);
  assert.equal(ownsRoom("own-close"), false);
  t.mock.timers.tick(60_000);
  assert.equal(pg.sent(/SELECT 1/).length, 0, "the heartbeat outlived the close");

  assert.equal(await claimRoom("own-close"), false, "a closed ownership granted a claim");

  reopenOwnership({ onRoomLost: () => {} });
  assert.equal(await claimRoom("own-close"), true);
  assert.equal(pg.connects, 2);
});

test("a connection that will not close does not fail the close", async (t) => {
  const pg = fakePostgres(t);
  openOwnership(t);

  await claimRoom("own-close-fails");
  pg.endRejects = true;
  await closeOwnership();
  assert.equal(ownsRoom("own-close-fails"), false);
});

test("a heartbeat that goes unanswered gives up a room held elsewhere once, and keeps one still held", async (t) => {
  const pg = fakePostgres(t);
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const lost = openOwnership(t);

  await claimRoom("own-beat-kept");
  await claimRoom("own-beat-taken");
  t.mock.timers.tick(15_000);
  await settle();
  assert.equal(pg.sent(/SELECT 1/).length, 1, "the heartbeat did not check the connection");
  assert.deepEqual(lost, []);
  t.mock.timers.tick(15_000);
  assert.equal(pg.sent(/SELECT 1/).length, 2, "the heartbeat stopped after one check");

  pg.fail = /SELECT 1/;
  pg.lockAnswer = (key) => key !== pg.sent(/pg_try_advisory_lock/)[1].params?.[0];
  t.mock.timers.tick(15_000);
  await settle();
  pg.fail = null;

  assert.deepEqual(lost, ["own-beat-taken"]);
  assert.equal(ownsRoom("own-beat-taken"), false);
  assert.equal(ownsRoom("own-beat-kept"), true);
  assert.equal(pg.clients[0].ended, 1, "the dead connection was not closed");
  assert.equal(pg.clients[1].ended, 0);

  const beats = pg.sent(/SELECT 1/).filter((q) => q.client === pg.clients[0]).length;
  t.mock.timers.tick(30_000);
  assert.equal(
    pg.sent(/SELECT 1/).filter((q) => q.client === pg.clients[0]).length,
    beats,
    "the dead connection kept its heartbeat"
  );
});

test("a connection lost twice over, or a dead one reporting late, is reclaimed once", async (t) => {
  const pg = fakePostgres(t);
  pg.endRejects = true;
  const lost = openOwnership(t);

  await claimRoom("own-lost-once");
  pg.lockAnswer = () => false;
  pg.clients[0].emit("error", new Error("Connection terminated unexpectedly"));
  pg.clients[0].emit("error", new Error("Connection terminated unexpectedly"));
  await settle();

  assert.deepEqual(lost, ["own-lost-once"]);
  assert.equal(ownsRoom("own-lost-once"), false);
  assert.equal(await claimRoom("own-lost-once"), false);
});

test("an error from a connection already replaced leaves the live one alone", async (t) => {
  const pg = fakePostgres(t);
  const lost = openOwnership(t);

  await claimRoom("own-stale");
  pg.clients[0].emit("error", new Error("Connection terminated unexpectedly"));
  await settle();
  assert.equal(pg.clients.length, 2);

  const locks = pg.sent(/pg_try_advisory_lock/).length;
  pg.clients[0].emit("error", new Error("late"));
  await settle();

  assert.equal(pg.clients[1].ended, 0, "a stale error closed the live connection");
  assert.equal(pg.sent(/pg_try_advisory_lock/).length, locks, "a stale error started another reclaim");
  assert.deepEqual(lost, []);
  assert.equal(ownsRoom("own-stale"), true);
});

test("a reclaim that cannot reach Postgres keeps the room and asks again in a second", async (t) => {
  const pg = fakePostgres(t);
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const lost = openOwnership(t);

  await claimRoom("own-retry");
  pg.refuseConnect = true;
  pg.clients[0].emit("error", new Error("Connection terminated unexpectedly"));
  await settle();
  const attempts = pg.connects;
  assert.deepEqual(lost, []);
  assert.equal(ownsRoom("own-retry"), true);

  pg.refuseConnect = false;
  pg.lockAnswer = () => false;
  t.mock.timers.tick(1_000);
  await settle();

  assert.equal(pg.connects, attempts + 1, "the reclaim did not try again");
  assert.deepEqual(lost, ["own-retry"]);
  assert.equal(ownsRoom("own-retry"), false);
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(pg.connects, attempts + 1, "a reclaim that settled went on retrying");
});

test("a room whose delete fails is still handed back, and claims on it are refused until then", async (t) => {
  const pg = fakePostgres(t);
  openOwnership(t);

  assert.equal(await claimRoom("own-after"), true);
  let settledAt!: () => void;
  const released = releaseRoomAfter("own-after", new Promise<void>((_, reject) => (settledAt = () => reject(new Error("delete failed")))));
  assert.equal(await claimRoom("own-after"), false, "a claim landed while the delete was pending");

  settledAt();
  await released;
  assert.equal(pg.sent(/pg_advisory_unlock/).length, 1);
  assert.equal(await claimRoom("own-after"), true);
});

test("a release that cannot reach Postgres, or is refused by it, still lets go of the room", async (t) => {
  const pg = fakePostgres(t);
  openOwnership(t);

  await claimRoom("own-unlock-fails");
  pg.fail = /pg_advisory_unlock/;
  await releaseRoom("own-unlock-fails");
  assert.equal(ownsRoom("own-unlock-fails"), false);

  await claimRoom("own-no-connection");
  pg.refuseConnect = true;
  pg.clients[0].emit("error", new Error("Connection terminated unexpectedly"));
  await settle();
  await releaseRoom("own-no-connection");
  assert.equal(ownsRoom("own-no-connection"), false);
  await closeOwnership();
});

test("a game in memory is unclaimed until its room is claimed, and again once it is released", async (t) => {
  fakePostgres(t);
  openOwnership(t);
  activeGames.set("own-memory", onlineTable({ roomId: "own-memory" }));
  t.after(() => activeGames.delete("own-memory"));

  assert.deepEqual(unclaimedRooms(), ["own-memory"]);
  await claimRoom("own-memory");
  assert.deepEqual(unclaimedRooms(), []);
  await releaseRoom("own-memory");
  assert.deepEqual(unclaimedRooms(), ["own-memory"]);
});

test("the connection asks for quick keepalives before it takes a lock, and bounds every query", async (t) => {
  const pg = fakePostgres(t);
  openOwnership(t);

  await claimRoom("own-config");

  const sent = pg.queries.map((q) => q.sql);
  const keepalives = sent.findIndex((sql) => /tcp_keepalives_idle/.test(sql) && /tcp_keepalives_count/.test(sql));
  assert.ok(keepalives !== -1, "no keepalive settings were sent");
  assert.ok(keepalives < sent.findIndex((sql) => /pg_try_advisory_lock/.test(sql)));
  const { query_timeout, statement_timeout } = (pg.clients[0] as unknown as { connectionParameters: Record<string, unknown> })
    .connectionParameters;
  assert.ok(Number(query_timeout) > 0, "a query on a half-open socket would hang");
  assert.ok(Number(statement_timeout) > 0);
});

test("a reclaim that finds every room still held does not come back for them", async (t) => {
  const pg = fakePostgres(t);
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const lost = openOwnership(t);

  await claimRoom("own-all-held");
  pg.clients[0].emit("error", new Error("Connection terminated unexpectedly"));
  await settle();
  const locks = pg.sent(/pg_try_advisory_lock/).length;
  assert.equal(locks, 2);

  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(pg.sent(/pg_try_advisory_lock/).length, locks, "a settled reclaim asked again");
  assert.deepEqual(lost, []);
});
