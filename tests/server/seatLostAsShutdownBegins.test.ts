// A file of its own: `beginShutdown` cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTableAction } from "../../server/game/tableHandlers.ts";
import { activeGames, beginShutdown } from "../../server/game/gameRoom.ts";
import { clearRoomTimers, usersInLobbyGrace } from "../../server/game/gameTimers.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import type { TableAction } from "../../server/game/tableActions.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { seat, state } from "../support/game.ts";

const ROOM = "seat-lost-as-shutdown-begins-room";

test("a seat lost between hands as the shutdown begins is released, and the loss is answered", async (t) => {
  const { rt } = recordingRuntime({
    presence: {
      isAtTable: async () => {
        beginShutdown();
        return false;
      },
    },
  });
  const released = t.mock.method(roomStore, "releaseSeat", async () => null);
  t.mock.method(rt, "route", async () => ({ ok: true as const }));
  activeGames.set(
    ROOM,
    onlineTable({
      roomId: ROOM,
      playerMap: { 0: "ana", 1: "besi" },
      gameState: state({
        players: [seat(0, [], { name: "Ana" }), seat(1, [], { name: "Besi" })],
        lastPlayedBy: -1,
        roundOver: true,
        finishingOrder: ["p0", "p1"],
        openingCard: null,
      }),
    })
  );
  try {
    const lost = { id: "a1", kind: "seatLost", roomId: ROOM, userId: "besi" } as unknown as TableAction;
    assert.deepEqual(await applyTableAction(rt, lost), { ok: true });
    assert.deepEqual(released.mock.calls.map((c) => c.arguments), [[ROOM, "besi"]]);
    assert.deepEqual(usersInLobbyGrace(ROOM), []);
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
