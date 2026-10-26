// A file of its own: `beginShutdown` cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTableAction } from "../../server/game/tableHandlers.ts";
import { activeGames, beginShutdown } from "../../server/game/gameRoom.ts";
import { clearRoomTimers, pending, usersInLobbyGrace } from "../../server/game/gameTimers.ts";
import type { TableAction } from "../../server/game/tableActions.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { aThreePlayed, card, seat, state } from "../support/game.ts";

const ROOM = "table-handlers-shutdown-room";

test("a shutdown drops every socket, and a seat lost mid-round is not held or announced", async () => {
  const { rt, sent } = recordingRuntime();
  activeGames.set(
    ROOM,
    onlineTable({
      roomId: ROOM,
      playerMap: { 0: "ana", 1: "besi" },
      gameState: state({
        players: [seat(0, [card("5", "spades")], { name: "Ana" }), seat(1, [card("6", "spades")], { name: "Besi" })],
        lastPlayedBy: -1,
        openingCard: null,
        playedRanks: aThreePlayed(),
      }),
    })
  );
  try {
    beginShutdown();
    const lost = { id: "a1", kind: "seatLost", roomId: ROOM, userId: "besi" } as unknown as TableAction;
    assert.deepEqual(await applyTableAction(rt, lost), { ok: true });
    assert.deepEqual(sent, []);
    assert.equal(pending("disconnect", "besi"), false);
    assert.deepEqual(usersInLobbyGrace(ROOM), []);
    assert.deepEqual(activeGames.get(ROOM)!.playerMap, { 0: "ana", 1: "besi" });
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
