// A file of its own: `beginShutdown` cannot be undone inside a process.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { applyOrForward } from "../../server/game/tableRouter.ts";
import { activeGames, beginShutdown } from "../../server/game/gameRoom.ts";
import type { TableActionDraft } from "../../server/game/tableActions.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";

const ROOM = "table-router-shutdown-room";

afterEach(() => activeGames.delete(ROOM));

const reaction = { kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍" } as TableActionDraft;
const startMatch = { kind: "startMatch", roomId: ROOM, userId: "ana", fillWithBots: true } as TableActionDraft;

const answers = (replies: unknown[], err: unknown = null) => ({
  serverSideEmit: (_event: string, _action: unknown, ack: (e: unknown, r: unknown[]) => void) => {
    ack(err, replies);
    return true;
  },
});
const disowned = { ok: false, code: "NOT_THIS_INSTANCE" };

describe("a process on its way out", () => {
  test("still asks the instance that holds a table, and returns its answer", async () => {
    const { rt } = recordingRuntime({ transport: answers([disowned, { ok: false, code: "NOT_SEATED" }]) });
    beginShutdown();
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: false, code: "NOT_SEATED" });
  });

  test("finds no game when every instance disowns the table, and deals none for a start", async () => {
    const { rt } = recordingRuntime({ transport: answers([disowned]) });
    beginShutdown();
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: false, code: "NO_LIVE_GAME" });
    assert.deepEqual(await applyOrForward(rt, startMatch), { ok: false, code: "NO_LIVE_GAME" });
    assert.equal(activeGames.has(ROOM), false);
  });

  test("does not read an instance that failed to answer as nobody holding the table", async () => {
    const { rt } = recordingRuntime({ transport: answers([disowned], new Error("timeout")) });
    beginShutdown();
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: false, code: "TABLE_UNREACHABLE" });
    assert.deepEqual(await applyOrForward(rt, startMatch), { ok: false, code: "TABLE_UNREACHABLE" });
  });

  test("still applies an action to a table it holds, without asking anyone", async () => {
    let asked = 0;
    const { rt, sent } = recordingRuntime({
      transport: {
        serverSideEmit: () => {
          asked++;
          return true;
        },
      },
    });
    activeGames.set(
      ROOM,
      onlineTable({ roomId: ROOM, playerMap: { 0: "ana" }, gameState: { players: [{ name: "Ana" }] } as never })
    );
    beginShutdown();
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: true });
    assert.equal(asked, 0);
    assert.equal(sent.filter((e) => e.event === "game:reaction").length, 1);
  });
});
