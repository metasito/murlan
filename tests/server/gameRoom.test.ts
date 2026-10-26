import { test } from "node:test";
import assert from "node:assert/strict";
import { onlineTable } from "../helpers/onlineTable.ts";
import { beginShutdown, isShuttingDown, seatName } from "../../server/game/gameRoom.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

test("a process is not shutting down until beginShutdown, and is from then on", () => {
  assert.equal(isShuttingDown(), false);
  beginShutdown();
  assert.equal(isShuttingDown(), true);
  beginShutdown();
  assert.equal(isShuttingDown(), true);
});

test("a seat's name is the one the round was dealt with; no seat, or one the table lacks, has none", () => {
  const seats = [
    { name: "Alice", type: "human" as const, id: "player_0" },
    { name: "Bora", type: "human" as const, id: "player_1" },
  ];
  const game = onlineTable({ roomId: "seat-name-room", gameState: startRound(seats, "free_for_all") });
  assert.equal(seatName(game, 0), "Alice");
  assert.equal(seatName(game, 1), "Bora");
  assert.equal(seatName(game, null), "");
  assert.equal(seatName(game, 7), "");
});
