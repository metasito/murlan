// A file of its own: a shutdown cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import type { Server as HttpServer } from "node:http";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { shutdown } from "../../server/http/shutdown.ts";
import { openDatabase, pool } from "../../server/store/db.ts";

test("a pool that drained but never finishes closing still lets the shutdown exit 0", { timeout: 5_000 }, async (t) => {
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async () => ({ rows: [] }));
  openDatabase();
  t.mock.method(pool(), "end", () => new Promise<void>(() => {}));
  const exits: number[] = [];
  await shutdown("SIGTERM", {
    io: { close: async () => {} },
    tables: recordingRuntime().rt,
    server: { listening: false } as unknown as HttpServer,
    exit: (code) => exits.push(code),
  });
  assert.deepEqual(exits, [0]);
});
