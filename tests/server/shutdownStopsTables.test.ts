// A file of its own: a shutdown cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import type { Server as HttpServer } from "node:http";
import type { Pool } from "pg";
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import { shutdown } from "../../server/http/shutdown.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { arm, pending } from "../../server/game/gameTimers.ts";
import { claimRoom, ownsRoom } from "../../server/game/gameOwnership.ts";

const ROOM = "shutdown-stops-tables-room";

test("a shutdown stops every table before the drain, and drops the locks only after it", async (t) => {
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async () => ({ rows: [{ locked: true }] }));
  assert.equal(await claimRoom(ROOM), true);

  activeGames.set(ROOM, { roomId: ROOM, playerMap: {} } as unknown as OnlineGameState);
  let botMoved = false;
  arm("bot", ROOM, 60_000, () => {
    botMoved = true;
  });

  const atPoolEnd: { botArmed?: boolean; locked?: boolean } = {};
  const pool = {
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    end: async () => {
      atPoolEnd.botArmed = pending("bot", ROOM);
      atPoolEnd.locked = ownsRoom(ROOM);
    },
  } as unknown as Pool;
  const exits: number[] = [];
  await shutdown("SIGTERM", {
    io: { close: async () => {} } as unknown as SocketServer,
    server: { listening: false } as unknown as HttpServer,
    pool,
    exit: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [0]);
  assert.equal(atPoolEnd.botArmed, false, "a table was still playing while the pool drained");
  assert.equal(atPoolEnd.locked, true, "the room's lock was gone before the pool had drained");
  assert.equal(ownsRoom(ROOM), false, "the shutdown never handed the room back");
  assert.equal(botMoved, false);
});
