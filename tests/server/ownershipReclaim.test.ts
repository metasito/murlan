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
} from "../../server/game/gameOwnership.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const deadline = Date.now() + 3_000;
  while (lockQueries < 3 && Date.now() < deadline) await sleep(50);

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
