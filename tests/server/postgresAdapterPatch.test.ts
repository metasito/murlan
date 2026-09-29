// tests/server/postgresAdapterPatch.test.ts — patches/@socket.io+postgres-adapter+0.5.0.patch: the
// adapter hands back every LISTEN client it loses, and has one reconnection pending at most.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Pool, type PoolClient } from "pg";
import { PubSubClient } from "@socket.io/postgres-adapter/dist/util.js";

let listen: (client: EventEmitter) => Promise<unknown> = async () => ({ rows: [] });

class FakeClient extends EventEmitter {
  _queryable = true;
  connection = { stream: { unref() {}, ref() {} } };
  connect(cb: (err?: Error) => void) {
    setImmediate(() => cb());
  }
  query(text: string) {
    return text.startsWith("LISTEN") ? listen(this) : Promise.resolve({ rows: [] });
  }
  end(cb?: () => void) {
    this._queryable = false;
    setImmediate(() => this.emit("end"));
    cb?.();
    return Promise.resolve();
  }
  ref() {}
  unref() {}
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

function start(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const pool = new Pool({ Client: FakeClient as never, max: 4 });
  const acquired: PoolClient[] = [];
  pool.on("acquire", (c) => acquired.push(c));
  const opts = { channelPrefix: "c", tableName: "t", payloadThreshold: 8_000, cleanupInterval: 30_000, errorHandler() {} };
  const pubsub = new PubSubClient(pool, opts as never, () => false, () => {});
  pubsub.addNamespace("/");
  t.after(() => pubsub.close());
  return { pool, pubsub, acquired, checkedOut: () => pool.totalCount - pool.idleCount };
}

test("a LISTEN refused on a live connection hands its client back", async (t) => {
  let calls = 0;
  listen = async () => {
    calls += 1;
    if (calls === 1) throw new Error("LISTEN refused");
    return { rows: [] };
  };
  const { checkedOut } = start(t);
  await settle();
  assert.equal(checkedOut(), 0, "the client whose LISTEN failed is still checked out");
  t.mock.timers.tick(3_000);
  await settle();
  assert.equal(calls, 2);
  assert.equal(checkedOut(), 1);
});

test("a backend dying mid-LISTEN is handed back once and reconnected once", async (t) => {
  let calls = 0;
  listen = async (client) => {
    calls += 1;
    if (calls > 1) return { rows: [] };
    client.emit("end");
    throw new Error("Connection terminated unexpectedly");
  };
  const { checkedOut } = start(t);
  await settle();
  assert.equal(checkedOut(), 0, "the dead client is still checked out");
  t.mock.timers.tick(3_000);
  await settle();
  assert.equal(calls, 2, `${calls - 1} reconnections ran: each extra LISTEN client delivers every broadcast again`);
  assert.equal(checkedOut(), 1);
});

test("an established LISTEN client that ends gives its slot back, every time", async (t) => {
  listen = async () => ({ rows: [] });
  const { pool, pubsub, acquired, checkedOut } = start(t);
  await settle();
  for (const round of [1, 2]) {
    assert.equal(checkedOut(), 1, `round ${round}: no LISTEN client`);
    acquired.at(-1)!.emit("end");
    await settle();
    assert.equal(checkedOut(), 0, `round ${round}: the ended client still holds its slot`);
    t.mock.timers.tick(3_000);
    await settle();
  }
  pubsub.close();
  assert.equal(pool.idleCount, 1, "close() did not hand the LISTEN client back idle, so pool.end() tests nothing");
  await pool.end();
});

test("close() leaves no reconnection behind", async (t) => {
  let calls = 0;
  listen = async (client) => {
    calls += 1;
    client.emit("end");
    throw new Error("Connection terminated unexpectedly");
  };
  const { pubsub } = start(t);
  await settle();
  pubsub.close();
  t.mock.timers.tick(3_000);
  await settle();
  assert.equal(calls, 1, "a reconnection scheduled before close() ran after it");
});
