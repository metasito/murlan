// tests/integration/lockHolder.test.ts — who holds a room's lock, as real Postgres reports it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { claimRoom, closeOwnership, lockHolder, ownershipKey, releaseRoom, reopenOwnership } from "../../server/game/gameOwnership.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { closeDatabase, openDatabase } from "../../server/store/db.ts";

describe("the room's lock holder", { skip: hasDatabase() ? false : skipMessage() }, () => {
  const base = new URL(process.env.DATABASE_URL!);
  const otherDatabase = `${base.pathname.slice(1)}_lockholder`;
  const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const room = (name: string) => `lockholder-${name}-${tag}`;
  const sessions: pg.Client[] = [];

  /** A session that is not this process's ownership connection, holding `roomId`'s lock in `database`. */
  async function holdElsewhere(roomId: string, database = base.pathname.slice(1)): Promise<void> {
    const url = new URL(base);
    url.pathname = `/${database}`;
    const session = new pg.Client({ connectionString: url.toString() });
    await session.connect();
    sessions.push(session);
    await session.query("SELECT pg_advisory_lock($1::bigint)", [ownershipKey(roomId)]);
  }

  before(async () => {
    // Its own connection: it creates the second database the filter is proved against.
    const admin = new pg.Client({ connectionString: base.toString() });
    await admin.connect();
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [otherDatabase]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${otherDatabase}"`);
    await admin.end();
    openDatabase();
    reopenOwnership({ onRoomLost: () => {}, rows: activeGameStore });
  });

  after(async () => {
    for (const s of sessions) await s.end().catch(() => {});
    await closeOwnership();
    await (await closeDatabase()).ended;
  });

  test("is this process for a room it claimed", async () => {
    assert.equal(await claimRoom(room("mine")), true);
    assert.equal(await lockHolder(room("mine")), "mine");
    await releaseRoom(room("mine"));
    assert.equal(await lockHolder(room("mine")), "free");
  });

  test("is elsewhere for a room another session locked", async () => {
    await holdElsewhere(room("elsewhere"));
    assert.equal(await lockHolder(room("elsewhere")), "elsewhere");
  });

  test("is nobody for a room no session locked", async () => {
    assert.equal(await lockHolder(room("free")), "free");
  });

  test("is nobody for a room whose key is locked in another database", async () => {
    await holdElsewhere(room("other-database"), otherDatabase);
    assert.equal(await lockHolder(room("other-database")), "free");
  });
});
