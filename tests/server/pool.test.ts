// tests/server/pool.test.ts — pg emits `error` on a checked-out client when its backend dies, and
// an `error` event nobody listens for exits the process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createClient, createPool } from "../../server/store/pool.ts";

class FakeClient extends EventEmitter {
  _queryable = true;
  connection = { stream: { unref() {}, ref() {} } };
  connect(cb: (err?: Error) => void) {
    setImmediate(() => cb());
  }
  end(cb?: () => void) {
    cb?.();
    return Promise.resolve();
  }
  ref() {}
  unref() {}
}

const terminated = () => new Error("terminating connection due to administrator command");

test("a checked-out client's error is handled, not thrown", async () => {
  const pool = createPool("test", { Client: FakeClient as never, max: 1 });
  const client = await pool.connect();
  assert.equal(client.listenerCount("error"), 1, "createPool left the checked-out client with no error listener");
  assert.doesNotThrow(() => client.emit("error", terminated()));
  client.release(terminated());
  await pool.end();
});

test("an idle client's error is handled, not thrown", async () => {
  const pool = createPool("test", { Client: FakeClient as never, max: 1 });
  const client = await pool.connect();
  client.release();
  assert.equal(pool.idleCount, 1, "the fake client was not returned idle, so this tests nothing");
  assert.doesNotThrow(() => client.emit("error", terminated()));
  assert.equal(pool.totalCount, 0, "the pool kept a client whose backend died");
  await pool.end();
});

test("createClient hands every error to the caller's handler", () => {
  const seen: Error[] = [];
  const client = createClient({}, (err) => seen.push(err));
  assert.doesNotThrow(() => client.emit("error", terminated()));
  assert.equal(seen.length, 1);
});
