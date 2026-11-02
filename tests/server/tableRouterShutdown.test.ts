// A file of its own: `beginShutdown` cannot be undone inside a process.
import { test, describe, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { applyOrForward } from "../../server/game/tableRouter.ts";
import { closeOwnership, reopenOwnership } from "../../server/game/gameOwnership.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { activeGames, beginShutdown } from "../../server/game/gameRoom.ts";
import type { TableActionDraft } from "../../server/game/tableActions.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { ownedElsewhere, recordingRuntime } from "../helpers/recordingRuntime.ts";

const ROOM = "table-router-shutdown-room";

beforeEach(() => reopenOwnership({ onRoomLost: () => {}, rows: activeGameStore }));
afterEach(async () => {
  activeGames.delete(ROOM);
  await closeOwnership();
});

/** The room's lock as `pg_locks` shows it; a shutting-down process never asks for it. */
function scriptLock(t: TestContext, heldElsewhere: boolean) {
  const lock = { taken: 0 };
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async (sql: string) => {
    if (/pg_try_advisory_lock/.test(sql)) lock.taken++;
    return { rows: /pg_locks/.test(sql) && heldElsewhere ? [{ current: false, pid: 7, started: "1" }] : [] };
  });
  return lock;
}

const reaction = { kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍" } as TableActionDraft;
const startMatch = { kind: "startMatch", roomId: ROOM, userId: "ana", fillWithBots: true } as TableActionDraft;

const disowned = { ok: false, code: "NOT_THIS_INSTANCE" } as const;

describe("a process on its way out", () => {
  test("still asks the instance that holds a table, and returns its answer", async (t) => {
    scriptLock(t, true);
    const { rt } = recordingRuntime({ peers: ownedElsewhere(() => ({ ok: false, code: "NOT_SEATED" })).peers });
    beginShutdown();
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: false, code: "NOT_SEATED" });
  });

  test("finds no game when the owner disowns the table and its lock is free, and deals none for a start", async (t) => {
    const lock = scriptLock(t, false);
    const { rt } = recordingRuntime({ peers: ownedElsewhere(() => disowned).peers });
    beginShutdown();
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: false, code: "NO_LIVE_GAME" });
    assert.deepEqual(await applyOrForward(rt, startMatch), { ok: false, code: "NO_LIVE_GAME" });
    assert.equal(activeGames.has(ROOM), false);
    assert.equal(lock.taken, 0);
  });

  test("does not read an owner that failed to answer as nobody holding the table", async (t) => {
    scriptLock(t, true);
    const { rt } = recordingRuntime({ peers: ownedElsewhere(() => "silent").peers });
    beginShutdown();
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: false, code: "TABLE_UNREACHABLE" });
    assert.deepEqual(await applyOrForward(rt, startMatch), { ok: false, code: "TABLE_UNREACHABLE" });
  });

  test("does not read a missing owner record as nobody holding the table", async (t) => {
    scriptLock(t, true);
    const { rt } = recordingRuntime();
    beginShutdown();
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: false, code: "TABLE_UNREACHABLE" });
  });

  test("still applies an action to a table it holds, without asking anyone", async () => {
    const { peers, asks } = ownedElsewhere(() => ({ ok: true }));
    const { rt, sent } = recordingRuntime({ peers });
    activeGames.set(
      ROOM,
      onlineTable({ roomId: ROOM, playerMap: { 0: "ana" }, gameState: { players: [{ name: "Ana" }] } as never })
    );
    beginShutdown();
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: true });
    assert.deepEqual(asks, []);
    assert.equal(sent.filter((e) => e.event === "game:reaction").length, 1);
  });
});
