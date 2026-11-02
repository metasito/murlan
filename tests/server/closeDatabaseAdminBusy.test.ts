// A file of its own: closing the database cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminPool, closeDatabase, openDatabase } from "../../server/store/db.ts";
import { logger } from "../../server/shared/logger.ts";

// The drain window outlasts the test's own timeout, so a close that waits on the admin pool for it fails here.
test("a busy admin pool neither holds the shutdown's drain nor goes unreported", { timeout: 20_000 }, async (t) => {
  openDatabase();
  t.mock.getter(adminPool(), "totalCount", () => 1);
  t.mock.getter(adminPool(), "idleCount", () => 0);
  t.mock.method(adminPool(), "end", async () => {});
  const warned: string[] = [];
  t.mock.method(logger, "warn", (_obj: unknown, msg: string) => void warned.push(msg));

  const { ended } = await closeDatabase({ drainMs: 10 * 60_000 });
  await ended;
  assert.ok(warned.some((m) => /admin/i.test(m)), `the abandoned admin reads were not logged: ${JSON.stringify(warned)}`);
});
