import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import type { Server as HttpServer } from "node:http";
import { recordingRuntime, stubTransport } from "../helpers/recordingRuntime.ts";
import { shutdown } from "../../server/http/shutdown.ts";
import { __resetShutdown } from "../../server/game/gameRoom.ts";
import { openDatabase, pool } from "../../server/store/db.ts";
import { trackEvent } from "../../server/shared/events.ts";

test("a shutdown writes the queued telemetry before it closes the pool", async (t) => {
  t.after(__resetShutdown);
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async () => ({ rows: [] }));
  openDatabase();
  const order: string[] = [];
  t.mock.method(pool(), "query", async (sql: string) => {
    if (/INSERT INTO events/.test(sql)) order.push("events");
    return { rows: [] };
  });
  t.mock.method(pool(), "end", async () => void order.push("pool end"));

  trackEvent("lobby.entered", "leaving-user");
  const exits: number[] = [];
  await shutdown("SIGTERM", {
    io: stubTransport({ close: async () => {} }),
    tables: recordingRuntime().rt,
    server: { listening: false } as unknown as HttpServer,
    exit: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [0]);
  assert.deepEqual(order, ["events", "pool end"]);
});
