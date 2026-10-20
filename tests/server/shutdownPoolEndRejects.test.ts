// A file of its own: a shutdown cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import type { Server as HttpServer } from "node:http";
import type { Pool } from "pg";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { shutdown } from "../../server/http/shutdown.ts";
import { claimRoom, ownsRoom } from "../../server/game/gameOwnership.ts";

test("a pool close that rejects at once still hands the rooms back and exits 0", async (t) => {
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async () => ({ rows: [{ locked: true }] }));
  assert.equal(await claimRoom("pool-end-rejects-room"), true);
  const pool = {
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    end: () => Promise.reject(new Error("Called end on pool more than once")),
  } as unknown as Pool;
  const exits: number[] = [];
  await shutdown("SIGTERM", {
    io: { close: async () => {} },
    tables: recordingRuntime().rt,
    server: { listening: false } as unknown as HttpServer,
    pool,
    exit: (code) => exits.push(code),
  });
  assert.equal(ownsRoom("pool-end-rejects-room"), false, "the shutdown never reached closeOwnership");
  assert.deepEqual(exits, [0]);
});
