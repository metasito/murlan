// tests/integration/ownerEpoch.test.ts — against Postgres and Redis: each claim moves a table's
// row to the next epoch and names its owner in Redis, and a holder whose epoch has moved on
// writes nothing over the row.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createClient } from "redis";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { eventually } from "../helpers/client.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { claimRoom, ownershipKey, ownsRoom, releaseRoom } from "../../server/game/gameOwnership.ts";
import { rehydrateGame } from "../../server/game/tableLifecycle.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { toEnvelope } from "../../server/game/tableState.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { instanceId } from "../../server/store/redis.ts";
import { tableOwnerKey } from "../../server/store/tableOwners.ts";
import { shutdown } from "../../server/http/shutdown.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

const SEATS = ["Ana", "Besi"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));
const table = (roomId: string) =>
  onlineTable({ roomId, playerMap: { 0: "ana", 1: "besi" }, gameState: startRound(SEATS, "free_for_all") });
const newRoom = (tag: string) => `epoch-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe("the owner epoch", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let redis: ReturnType<typeof createClient>;

  before(async () => {
    server = await startTestServer();
    redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
  });

  after(async () => {
    await redis?.quit();
    // The last test shuts the app down itself.
    await server?.stop().catch(() => {});
  });

  const rowOf = async (roomId: string) =>
    (
      await server.query<{ owner_epoch: number; game_state: unknown; updated_at: Date }>(
        "SELECT owner_epoch::float8 AS owner_epoch, game_state, updated_at FROM active_games WHERE room_id = $1",
        [roomId]
      )
    )[0];

  test("each claim moves the row to a new epoch, and a holder left behind writes nothing over it", async () => {
    const roomId = newRoom("fence");
    await server.query("INSERT INTO active_games (room_id, game_state) VALUES ($1, $2)", [
      roomId,
      JSON.stringify(toEnvelope(table(roomId))),
    ]);
    assert.equal((await rowOf(roomId)).owner_epoch, 0);

    assert.equal(await claimRoom(roomId), true);
    assert.equal((await rowOf(roomId)).owner_epoch, 0, "the lock alone moved the epoch");
    assert.equal(await rehydrateGame(server.rt, roomId, null), "restored");
    const mine = (await rowOf(roomId)).owner_epoch;
    assert.ok(mine > 0, "entering left the row at epoch 0");
    const game = activeGames.get(roomId)!;

    // Another instance's claim, as it would run once this one's lock was gone.
    const theirEpoch = (await activeGameStore.claim(roomId)).epoch;
    assert.ok(theirEpoch > mine);
    const theirs = await rowOf(roomId);
    assert.equal(theirs.owner_epoch, theirEpoch);

    const envelope = toEnvelope(game);
    assert.equal(await activeGameStore.write(roomId, envelope, mine), false);
    assert.equal(await activeGameStore.remove(roomId, mine), false);
    assert.deepEqual(await rowOf(roomId), theirs, "a write or delete at the old epoch changed the row");

    const written: string[] = [];
    const write = activeGameStore.write;
    const remove = activeGameStore.remove;
    activeGameStore.write = async (...args) => {
      written.push("write");
      return write.apply(activeGameStore, args);
    };
    activeGameStore.remove = async (...args) => {
      written.push("remove");
      return remove.apply(activeGameStore, args);
    };
    try {
      await server.rt.writers.persistGameState(roomId, game);
      assert.equal(activeGames.has(roomId), false, "the stale holder kept playing the table");
      assert.equal(ownsRoom(roomId), false);
      await server.rt.writers.discardGame(roomId);
      await server.rt.writers.persistGameState(roomId, game);
    } finally {
      activeGameStore.write = write;
      activeGameStore.remove = remove;
      clearRoomTimers(roomId);
    }
    assert.deepEqual(written, ["write"], "the stale holder wrote after it was refused");
    assert.deepEqual(await rowOf(roomId), theirs);

    const key = BigInt(ownershipKey(roomId));
    const observer = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await observer.connect();
    try {
      const { rowCount } = await observer.query(
        `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND objsubid = 1
           AND classid = $1::bigint::oid AND objid = $2::bigint::oid`,
        [String(BigInt.asUintN(64, key) >> 32n), String(BigInt.asUintN(32, key))]
      );
      assert.equal(rowCount, 0, "the stale holder kept the lock on a table it gave up");
    } finally {
      await observer.end();
    }
  });

  test("two claims of a room with no row never share an epoch, so the first cannot write over the second", async () => {
    const roomId = newRoom("norow");
    const a = await activeGameStore.claim(roomId);
    const b = await activeGameStore.claim(roomId);
    assert.equal(a.row, undefined);
    assert.equal(b.row, undefined);
    assert.ok(b.epoch > a.epoch, `claims of a missing row took epochs ${a.epoch} and ${b.epoch}`);

    assert.equal(await activeGameStore.write(roomId, toEnvelope(table(roomId)), b.epoch), true);
    const theirs = await rowOf(roomId);
    assert.equal(await activeGameStore.write(roomId, toEnvelope(table(roomId)), a.epoch), false);
    assert.deepEqual(await rowOf(roomId), theirs, "the earlier claim wrote over the later one's row");
  });

  test("a row deleted and made again never takes back an epoch a former holder still has", async () => {
    const roomId = newRoom("remade");
    const first = await activeGameStore.claim(roomId);
    assert.equal(await activeGameStore.write(roomId, toEnvelope(table(roomId)), first.epoch), true);
    const second = await activeGameStore.claim(roomId);
    assert.ok(second.row, "the second claim did not find the row");
    assert.equal(await activeGameStore.remove(roomId, second.epoch), true);

    const third = await activeGameStore.claim(roomId);
    assert.equal(third.row, undefined);
    assert.ok(third.epoch > second.epoch && second.epoch > first.epoch, `epochs ${first.epoch}, ${second.epoch}, ${third.epoch}`);
    assert.equal(await activeGameStore.write(roomId, toEnvelope(table(roomId)), third.epoch), true);
    const theirs = await rowOf(roomId);
    assert.equal(await activeGameStore.write(roomId, toEnvelope(table(roomId)), first.epoch), false);
    assert.deepEqual(await rowOf(roomId), theirs, "the first holder's late write landed on the new match");
  });

  test("a row deleted under its holder is written again at the holder's epoch, and only then", async () => {
    const roomId = newRoom("purged");
    const envelope = toEnvelope(table(roomId));
    assert.equal(await activeGameStore.write(roomId, envelope, 3), true);
    await server.query("DELETE FROM active_games WHERE room_id = $1", [roomId]);

    assert.equal(await activeGameStore.write(roomId, envelope, 3), true);
    assert.equal((await rowOf(roomId)).owner_epoch, 3);
    assert.equal(await activeGameStore.write(roomId, envelope, 2), false);
    assert.equal(await activeGameStore.remove(roomId, 2), false);
    assert.equal(await activeGameStore.remove(roomId, 3), true);
    assert.equal(await activeGameStore.remove(roomId, 3), true, "a delete that finds the row gone read as another owner");
  });

  test("the owner record names this instance and the claim's epoch, and goes with the release", async () => {
    const roomId = newRoom("record");
    assert.equal(await claimRoom(roomId), true);
    assert.equal(await redis.get(tableOwnerKey(roomId)), null, "the lock alone recorded an owner");
    assert.equal(await rehydrateGame(server.rt, roomId, null), "missing");
    await eventually(
      async () => new RegExp(`^${instanceId}:[1-9][0-9]*$`).test((await redis.get(tableOwnerKey(roomId))) ?? ""),
      "the claim recorded as this instance's, at its epoch"
    );

    await releaseRoom(roomId);
    await eventually(async () => (await redis.get(tableOwnerKey(roomId))) === null, "the record cleared on release");
  });

  test("a release leaves a later owner's record alone", async () => {
    const roomId = newRoom("later");
    assert.equal(await claimRoom(roomId), true);
    await rehydrateGame(server.rt, roomId, null);
    await eventually(async () => (await redis.get(tableOwnerKey(roomId))) !== null, "the claim recorded");
    await redis.set(tableOwnerKey(roomId), "another-instance:2");

    await releaseRoom(roomId);
    // One connection carries every record and clear in order: once a later clear has landed,
    // this one has too.
    const marker = newRoom("marker");
    assert.equal(await claimRoom(marker), true);
    await rehydrateGame(server.rt, marker, null);
    await releaseRoom(marker);
    await eventually(async () => (await redis.get(tableOwnerKey(marker))) === null, "the later clear to land");
    assert.equal(await redis.get(tableOwnerKey(roomId)), "another-instance:2");
  });

  test("an owner record expires unless the ownership heartbeat renews it", { timeout: 40_000 }, async () => {
    const roomId = newRoom("ttl");
    assert.equal(await claimRoom(roomId), true);
    await rehydrateGame(server.rt, roomId, null);
    await eventually(async () => (await redis.get(tableOwnerKey(roomId))) !== null, "the claim recorded");
    const first = await redis.pTTL(tableOwnerKey(roomId));
    const recordedAt = Date.now();
    assert.ok(first > 0 && first <= 45_000, `the record's time to live is ${first} ms`);

    // Renewed: it has more time left than it would have had, untouched, by some seconds.
    await eventually(
      async () => (await redis.pTTL(tableOwnerKey(roomId))) > first - (Date.now() - recordedAt) + 5_000,
      "the heartbeat to renew the record",
      20_000
    );
    await releaseRoom(roomId);
  });

  test("a shutdown clears the owner record of every table it held", { timeout: 30_000 }, async () => {
    const roomId = newRoom("shutdown");
    assert.equal(await claimRoom(roomId), true);
    await rehydrateGame(server.rt, roomId, null);
    await eventually(async () => (await redis.get(tableOwnerKey(roomId))) !== null, "the claim recorded");

    await shutdown("SIGTERM", { io: server.io, server: server.httpServer, tables: server.rt, exit: () => {} });
    assert.equal(await redis.get(tableOwnerKey(roomId)), null, "a clean shutdown left its table's owner record");
  });
});
