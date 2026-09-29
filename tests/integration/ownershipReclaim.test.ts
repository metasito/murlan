// tests/integration/ownershipReclaim.test.ts — a restarting Postgres refuses connections for a while:
// the ownership connection must keep its rooms through that, and lock them again once it is back.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import pg from "pg";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import {
  claimRoom,
  closeOwnership,
  ownershipKey,
  ownsRoom,
  setRoomLostHandler,
} from "../../server/game/gameOwnership.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("rooms outlast a stretch of refused connections and are locked again", {
  skip: hasDatabase() ? false : skipMessage(),
}, async () => {
  const target = new URL(process.env.DATABASE_URL!);
  let refusing = false;
  const open = new Set<net.Socket>();
  const proxy = net.createServer((inbound) => {
    if (refusing) return void inbound.destroy();
    const outbound = net.connect(Number(target.port), target.hostname);
    for (const s of [inbound, outbound]) {
      open.add(s);
      s.on("error", () => {}).on("close", () => {
        open.delete(s);
        inbound.destroy();
        outbound.destroy();
      });
    }
    inbound.pipe(outbound).pipe(inbound);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const via = new URL(target);
  via.host = `127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
  process.env.DATABASE_URL = via.toString();

  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  after(async () => {
    await closeOwnership();
    for (const s of open) s.destroy();
    proxy.close();
    await admin.end();
    process.env.DATABASE_URL = target.toString();
  });

  const room = `reclaim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const key = BigInt(ownershipKey(room));
  const lockHeld = async () => {
    const { rowCount } = await admin.query(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND objsubid = 1
         AND classid = $1::bigint::oid AND objid = $2::bigint::oid`,
      [String(BigInt.asUintN(64, key) >> 32n), String(BigInt.asUintN(32, key))]
    );
    return rowCount === 1;
  };
  const lost: string[] = [];
  setRoomLostHandler((roomId) => lost.push(roomId));

  assert.equal(await claimRoom(room), true);
  assert.equal(await lockHeld(), true, "the lock query does not see the claim, so it proves nothing below");

  refusing = true;
  for (const s of open) s.destroy();
  await sleep(2_500);
  assert.equal(await lockHeld(), false, "the ownership connection never died, so nothing was refused");
  assert.deepEqual(lost, [], "a room was given up because Postgres could not be reached");
  assert.equal(ownsRoom(room), true);

  refusing = false;
  const deadline = Date.now() + 10_000;
  while (!(await lockHeld())) {
    assert.ok(Date.now() < deadline, "the room's lock was never taken again once Postgres was back");
    await sleep(100);
  }
  assert.deepEqual(lost, []);
});
