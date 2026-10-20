// A seat the vote deadline vacates can be reclaimed while its row is still being
// released; the seat row is then put back, through the runtime's room port.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearAllTimersForUser, clearRoomTimers } from "../../server/game/gameTimers.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

const ROOM = "vote-deadline-rejoin-room";
const SEATS = ["Ana", "Besi"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));

afterEach(() => {
  for (const userId of ["ana", "besi"]) clearAllTimersForUser(userId, ROOM);
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
});

test("a rejoin inside the deadline's seat release keeps the seat row", async (t) => {
  const { seats } = useMemoryTableStores(t, {
    rooms: [[ROOM, { code: "AAAAAA", gameMode: "free_for_all", maxPlayers: 2, status: "finished", hostUserId: "ana" }]],
    seats: [
      [
        ROOM,
        [
          { userId: "ana", seatIndex: 0, user: { id: "ana", username: "Ana" } as never },
          { userId: "besi", seatIndex: 1, user: { id: "besi", username: "Besi" } as never },
        ],
      ],
    ],
  });
  const { rt, writes } = recordingRuntime();
  const release = roomStore.releaseSeat;
  let rejoined: Promise<unknown> | undefined;
  t.mock.method(roomStore, "releaseSeat", async (...args: Parameters<typeof release>) => {
    rejoined = rt.route({ kind: "rejoin", roomId: ROOM, userId: "besi" });
    await rejoined;
    return release(...args);
  });
  const restored = t.mock.method(roomStore, "restoreSeat", roomStore.restoreSeat);
  activeGames.set(
    ROOM,
    onlineTable({
      roomId: ROOM,
      maxPlayers: 2,
      roundsPlayed: 1,
      playerMap: { 0: "ana", 1: "besi" },
      rematchVotes: new Set(["ana"]),
      gameState: { ...startRound(SEATS, "free_for_all"), roundOver: true, finishingOrder: ["player_0", "player_1"] },
    })
  );

  await rt.expireVoteDeadline(ROOM);

  assert.ok(rejoined, "the deadline never released besi's seat");
  assert.deepEqual(await rejoined, { ok: true });
  assert.deepEqual(activeGames.get(ROOM)?.playerMap, { 0: "ana", 1: "besi" }, "the rejoin did not reclaim the seat");
  assert.deepEqual(
    restored.mock.calls.map((c) => c.arguments),
    [[ROOM, "besi", 1, false]]
  );
  assert.deepEqual(
    seats.get(ROOM)?.map((s) => [s.userId, s.seatIndex]).sort(),
    [
      ["ana", 0],
      ["besi", 1],
    ],
    "the release's delete outlived the reclaim"
  );
  assert.ok(writes("persistGameState").length > 0, "the vacate and the reclaim wrote no row");
});
