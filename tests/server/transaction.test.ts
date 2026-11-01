// tests/server/transaction.test.ts — a transaction owns its client from connect to release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPool, inTransaction } from "../../server/store/pool.ts";

type Script = Partial<Record<"begin" | "commit" | "rollback", Error>>;

const scripts: Script[] = [];

class FakeClient extends EventEmitter {
  _queryable = true;
  connection = { stream: { unref() {}, ref() {} } };
  readonly script = scripts.shift() ?? {};
  readonly ran: string[] = [];
  connect(cb: (err?: Error) => void) {
    setImmediate(() => cb());
  }
  async query(config: string | { text: string }) {
    const text = (typeof config === "string" ? config : config.text).trim().toLowerCase();
    this.ran.push(text);
    const failure = this.script[text as keyof Script];
    if (failure) throw failure;
    return { rows: [], rowCount: 0, command: text.toUpperCase(), fields: [] };
  }
  end(cb?: () => void) {
    this._queryable = false;
    cb?.();
    return Promise.resolve();
  }
  ref() {}
  unref() {}
}

function fakePool(...clients: Script[]) {
  scripts.length = 0;
  scripts.push(...clients);
  const pool = createPool("app", { Client: FakeClient as never, max: 1, connectionTimeoutMillis: 200 });
  const released: (Error | undefined)[] = [];
  pool.on("release", (err: Error | undefined) => released.push(err));
  return { pool, released };
}

test("a BEGIN that fails releases its client with the error, and the pool serves the next transaction", async () => {
  const refused = new Error("Query read timeout");
  const { pool, released } = fakePool({ begin: refused });

  await assert.rejects(inTransaction(pool, async () => "unreached"), refused);
  assert.deepEqual(released, [refused], "the client was not released with the error that broke it");
  assert.equal(await inTransaction(pool, async () => "served"), "served");
  await pool.end();
});

test("a rollback that fails too leaves the body's error, with the rollback's as its cause", async () => {
  const lost = new Error("rollback: Query read timeout");
  const { pool, released } = fakePool({ rollback: lost });
  const own = new Error("the body's own failure");

  await assert.rejects(
    inTransaction(pool, async () => {
      throw own;
    }),
    (err: unknown) => {
      assert.equal(err, own, "the caller got the rollback's error instead of the body's");
      assert.equal((err as Error).cause, lost);
      return true;
    }
  );
  assert.deepEqual(released, [lost], "a client that could not roll back went back to the pool");
  await pool.end();
});

test("a rollback that fails extends a body error's own cause chain rather than replacing it", async () => {
  const lost = new Error("rollback failed");
  const { pool } = fakePool({ rollback: lost });
  const pgError = new Error("duplicate key");
  const own = new Error("Failed query", { cause: pgError });

  await assert.rejects(
    inTransaction(pool, async () => {
      throw own;
    }),
    (err: unknown) => {
      assert.equal(err, own);
      assert.equal((err as Error).cause, pgError);
      assert.equal(pgError.cause, lost);
      return true;
    }
  );
  await pool.end();
});

test("a body that fails is rolled back, and a client that answered the rollback is kept", async () => {
  const { pool, released } = fakePool({});
  const own = new Error("no such seat");
  await assert.rejects(
    inTransaction(pool, async () => {
      throw own;
    }),
    own
  );
  assert.deepEqual(released, [undefined]);
  assert.equal(pool.idleCount, 1);
  await pool.end();
});

test("a body that succeeds is committed and its result returned", async () => {
  const { pool, released } = fakePool({});
  let client: FakeClient | undefined;
  const result = await inTransaction(pool, async (c) => {
    client = c as unknown as FakeClient;
    await c.query("SELECT 1");
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(client?.ran, ["begin", "select 1", "commit"]);
  assert.deepEqual(released, [undefined]);
  await pool.end();
});

test("a COMMIT that fails releases its client with the error", async () => {
  const failed = new Error("could not serialize access");
  const { pool, released } = fakePool({ commit: failed });
  await assert.rejects(inTransaction(pool, async () => 1), failed);
  assert.deepEqual(released, [failed]);
  await pool.end();
});
