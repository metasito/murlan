// A file of its own: closing the database cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, db, openDatabase, pool } from "../../server/store/db.ts";
import { installServerErrorRecorder } from "../../server/http/serverErrors.ts";
import { setErrorRecorder } from "../../server/shared/logger.ts";

test("a pool still busy after the drain is recorded, and ended is held until the pool ends", async (t) => {
  openDatabase();
  const messages: string[] = [];
  t.mock.method(db(), "insert", () => ({
    values: async (row: { message: string }) => {
      messages.push(row.message);
    },
  }));
  t.mock.getter(pool(), "totalCount", () => 1);
  t.mock.getter(pool(), "idleCount", () => 0);
  let release = () => {};
  t.mock.method(pool(), "end", () => new Promise<void>((resolve) => (release = resolve)));
  t.mock.method(process.stderr, "write", () => true);
  installServerErrorRecorder();
  t.after(() => setErrorRecorder(undefined));

  const { ended } = await closeDatabase({ drainMs: 30 });
  assert.ok(
    messages.some((m) => m.includes("still busy after the drain window")),
    `the busy pool never reached server_errors: ${JSON.stringify(messages)}`
  );

  let settled = false;
  void ended.then(() => (settled = true));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false, "ended settled before the pool had ended");
  release();
  await ended;
  assert.equal(settled, true);
});
