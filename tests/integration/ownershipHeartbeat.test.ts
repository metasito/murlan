// tests/integration/ownershipHeartbeat.test.ts — the ownership connection's flow dies while Postgres
// keeps its backend, and with it every lock, alive: the process must not lose its rooms to its own
// orphaned session. And a server that accepts and never answers must not hang a claim.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { eventually } from "../helpers/client.ts";
import { startProxy, targetOf, viaProxy, type Proxy } from "../helpers/tcpProxy.ts";
import { claimRoom, closeOwnership, ownershipKey, ownsRoom, reopenOwnership } from "../../server/game/gameOwnership.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";

const skip = hasDatabase() ? false : skipMessage();
const direct = process.env.DATABASE_URL ?? "";
const proxies: Proxy[] = [];
let admin: pg.Client | undefined;

after(async () => {
  await closeOwnership();
  for (const p of proxies) await p.close();
  await admin?.end();
  process.env.DATABASE_URL = direct;
});

async function throughProxy(): Promise<Proxy> {
  await closeOwnership();
  const proxy = await startProxy(targetOf(direct, 5432));
  proxies.push(proxy);
  process.env.DATABASE_URL = viaProxy(direct, proxy);
  return proxy;
}

/** The backend holding each room's advisory lock, or null for a room nobody holds. */
async function lockHolders(rooms: string[]): Promise<(number | null)[]> {
  return Promise.all(
    rooms.map(async (room) => {
      const key = BigInt(ownershipKey(room));
      const { rows } = await admin!.query<{ pid: number }>(
        `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted AND objsubid = 1
           AND classid = $1::bigint::oid AND objid = $2::bigint::oid`,
        [String(BigInt.asUintN(64, key) >> 32n), String(BigInt.asUintN(32, key))]
      );
      return rows[0]?.pid ?? null;
    })
  );
}

const present = async (pid: number) =>
  ((await admin!.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1", [pid])).rowCount ?? 0) > 0;

test("a heartbeat lost to a half-open flow keeps every room, on a new session, with the old one ended", { skip, timeout: 60_000 }, async () => {
  admin = new pg.Client({ connectionString: direct });
  await admin.connect();
  const proxy = await throughProxy();
  const lost: string[] = [];
  reopenOwnership({ onRoomLost: (roomId) => lost.push(roomId), rows: activeGameStore });

  const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const rooms = ["a", "b", "c"].map((r) => `heartbeat-${r}-${tag}`);
  for (const room of rooms) assert.equal(await claimRoom(room), true);
  const [oldPid, ...others] = await lockHolders(rooms);
  assert.ok(oldPid, "the lock query does not see the claims, so it proves nothing below");
  assert.deepEqual(others, [oldPid, oldPid]);

  assert.equal(proxy.blackholeExisting(), 1, "the ownership connection was not the one link through the proxy");
  await eventually(
    async () => (await lockHolders(rooms)).every((pid) => pid !== null && pid !== oldPid),
    "every lock to be taken again on a new session",
    40_000
  );

  assert.deepEqual(lost, [], "a room was given up to this process's own orphaned session");
  assert.deepEqual(rooms.map(ownsRoom), [true, true, true]);
  assert.equal(await present(oldPid), false, "the orphaned session is still in pg_stat_activity");
  const holders = await lockHolders(rooms);
  assert.equal(new Set(holders).size, 1, "the locks are spread over more than one session");
});

// The test's own timeout is the bound: the connect gives up at 3 s; without it the claim never settles.
test("a server that accepts and never answers refuses the claim within the connect timeout", { skip, timeout: 4_000 }, async () => {
  const proxy = await throughProxy();
  proxy.blackholeNew(true);
  reopenOwnership({ onRoomLost: () => {}, rows: activeGameStore });

  assert.equal(await claimRoom(`blackholed-${Date.now()}`), false);
});
