// A file of its own: a shutdown cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import type { Server as HttpServer } from "node:http";
import { stubTransport } from "../helpers/recordingRuntime.ts";
import { DRAINING_SPREAD_MS, drainingReconnectAfterMs, shutdown } from "../../server/http/shutdown.ts";
import { openDatabase, pool } from "../../server/store/db.ts";

test("every socket is told when to reconnect after the hand-off and before io.close()", { timeout: 10_000 }, async (t) => {
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async () => ({ rows: [] }));
  openDatabase();
  t.mock.method(pool(), "end", async () => {});

  const order: string[] = [];
  const notices: number[] = [];
  const sockets = new Map(
    ["a", "b", "c"].map((id) => [
      id,
      {
        id,
        conn: { writeBuffer: [] as unknown[] },
        emit(event: string, notice: { reconnectAfterMs: number }) {
          order.push(`${event}:${id}`);
          notices.push(notice.reconnectAfterMs);
        },
      },
    ])
  );
  const io = stubTransport({
    sockets: { adapter: { rooms: new Map() }, sockets },
    close: async () => void order.push("io.close"),
  });
  const exits: number[] = [];
  await shutdown("SIGTERM", {
    io,
    tables: { handOffTables: async () => void order.push("handOff"), stopTables: async () => {} },
    server: { listening: false } as unknown as HttpServer,
    exit: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [0]);
  assert.deepEqual(order, ["handOff", "server:draining:a", "server:draining:b", "server:draining:c", "io.close"]);
  for (const ms of notices) assert.ok(Number.isInteger(ms) && ms >= 0 && ms < DRAINING_SPREAD_MS, `reconnectAfterMs ${ms}`);
});

test("reconnectAfterMs is uniform over 0-10 s", () => {
  const SAMPLES = 1_000;
  const BUCKETS = 10;
  const counts = new Array<number>(BUCKETS).fill(0);
  for (let i = 0; i < SAMPLES; i++) {
    const ms = drainingReconnectAfterMs();
    assert.ok(Number.isInteger(ms) && ms >= 0 && ms < DRAINING_SPREAD_MS, `reconnectAfterMs ${ms}`);
    counts[Math.floor(ms / (DRAINING_SPREAD_MS / BUCKETS))]!++;
  }
  const expected = SAMPLES / BUCKETS;
  const chiSquare = counts.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
  // Nine degrees of freedom: a uniform draw exceeds 37.7 once in a hundred thousand runs.
  assert.ok(chiSquare < 37.7, `buckets ${counts.join(" ")} are not uniform (chi-square ${chiSquare.toFixed(1)})`);
  assert.equal(drainingReconnectAfterMs(() => 0), 0);
  assert.equal(drainingReconnectAfterMs(() => 0.999_999_9), DRAINING_SPREAD_MS - 1);
});
