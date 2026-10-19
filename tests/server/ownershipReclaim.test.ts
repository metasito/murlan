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
  setRoomLostHandler,
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
  setRoomLostHandler((roomId) => lost.push(roomId));
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
