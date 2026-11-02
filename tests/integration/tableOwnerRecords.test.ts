// tests/integration/tableOwnerRecords.test.ts — a table's owner record on the real store: a clear or
// a refresh touches it only while it still names the claim that sends it, and a refresh puts back
// a record the store lost.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import {
  clearTableOwner,
  closeTableOwners,
  openTableOwners,
  refreshTableOwner,
  tableOwnerKey,
  tableOwnerValue,
} from "../../server/store/tableOwners.ts";
import { closeRedis, redisReady } from "../../server/store/redis.ts";

describe("a table's owner record", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3Downers_${Date.now()}`;
  let redis: ReturnType<typeof createClient>;
  let rooms = 0;
  const newRoom = () => `owner-record-${++rooms}`;

  before(async () => {
    process.env.DATABASE_URL = scoped;
    openTableOwners();
    redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    assert.ok(await redisReady(), "the owner records' connection never came up");
  });

  after(async () => {
    closeTableOwners();
    closeRedis();
    await redis?.quit();
    await dropKeyspace(scoped);
    process.env.DATABASE_URL = baseUrl;
  });

  test("a late clear from a former owner leaves the new owner's record", async () => {
    const roomId = newRoom();
    await redis.set(tableOwnerKey(roomId), "next-instance:8", { expiration: { type: "PX", value: 30_000 } });
    await clearTableOwner(roomId, 7);
    assert.equal(await redis.get(tableOwnerKey(roomId)), "next-instance:8");
  });

  test("a clear by the owner it names removes the record", async () => {
    const roomId = newRoom();
    await redis.set(tableOwnerKey(roomId), tableOwnerValue(3), { expiration: { type: "PX", value: 30_000 } });
    await clearTableOwner(roomId, 3);
    assert.equal(await redis.exists(tableOwnerKey(roomId)), 0);
  });

  test("a refresh by a non-owner changes nothing", async () => {
    const roomId = newRoom();
    await redis.set(tableOwnerKey(roomId), "next-instance:8", { expiration: { type: "PX", value: 30_000 } });
    await refreshTableOwner(roomId, 7, 600_000);
    assert.equal(await redis.get(tableOwnerKey(roomId)), "next-instance:8");
    const ttl = await redis.pTTL(tableOwnerKey(roomId));
    assert.ok(ttl > 0 && ttl <= 30_000, `the other owner's record now lives ${ttl} ms`);
  });

  test("a refresh by the owner extends its record", async () => {
    const roomId = newRoom();
    await redis.set(tableOwnerKey(roomId), tableOwnerValue(4), { expiration: { type: "PX", value: 5_000 } });
    await refreshTableOwner(roomId, 4, 600_000);
    assert.equal(await redis.get(tableOwnerKey(roomId)), tableOwnerValue(4));
    assert.ok((await redis.pTTL(tableOwnerKey(roomId))) > 500_000, "the refresh did not extend the record");
  });

  test("a refresh after the record was lost puts it back", async () => {
    const roomId = newRoom();
    await refreshTableOwner(roomId, 5, 600_000);
    assert.equal(await redis.get(tableOwnerKey(roomId)), tableOwnerValue(5));
    const ttl = await redis.pTTL(tableOwnerKey(roomId));
    assert.ok(ttl > 500_000 && ttl <= 600_000, `the record put back lives ${ttl} ms`);
  });

  test("a clear sent while a refresh is putting back a lost record leaves no record", async () => {
    const roomId = newRoom();
    const refreshed = refreshTableOwner(roomId, 6, 600_000);
    await clearTableOwner(roomId, 6);
    await refreshed;
    assert.equal(await redis.exists(tableOwnerKey(roomId)), 0, "a released table's record came back for a whole TTL");
  });
});
