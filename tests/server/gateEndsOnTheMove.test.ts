// tests/server/gateEndsOnTheMove.test.ts — a re-arm later in a turn waits out only what is left of a gate, never all of it again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { armTurn, vacateSeat } from "../../server/game/gameTurn.ts";
import { commitMove } from "../../server/game/tableMoves.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { botMoveDelayMs, clearRoomTimers, deadline } from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { createDeck, startRound } from "../../lib/game/gameEngine.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";
import { exchangeAnnounceMs } from "../../lib/timeline/exchangeTimeline.ts";

const ROOM = "gate-ends-on-the-move";
const { rt } = recordingRuntime();

function afterGiveback() {
  const seats = ["Ana", "Ben", "Cai", "Dee"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));
  const deck = createDeck();
  const gameState = startRound(seats, "free_for_all", {
    opening: { kind: "exchange", winnerSeat: 0, loserSeat: 3 },
    dealt: seats.map((_, s) => deck.filter((_, i) => i % seats.length === s)),
  });
  const game = onlineTable({ roomId: ROOM, roundsPlayed: 1, gameState, playerMap: { 0: "ana", 1: "ben", 2: "cai", 3: "dee" } });
  activeGames.set(ROOM, game);
  const give = autoMoveForSeat(gameState, 0, "floor");
  assert.equal(give?.move.kind, "giveback");
  void commitMove(rt, game, give);
  const settledAt = game.gameState.exchangePhase?.kind === "settled" ? game.gameState.exchangePhase.settledAt : undefined;
  assert.equal(typeof settledAt, "number", "publishing the giveback stamps when it settled");
  assert.equal(game.gameState.currentTurnIndex, 3, "the loser leads");
  return { game, ceremonyEnds: settledAt! + exchangeAnnounceMs(false) };
}

for (const walkoutMs of [1_000, 10_000]) {
  test(`a human opener who walks out ${walkoutMs} ms after a giveback hands the bot what is left of the ceremony, then the think`, async (t) => {
    t.mock.method(activeGameStore, "write", async () => {});
    const clock = fakeClock();
    const restoreClock = installClock(clock);
    try {
      const { ceremonyEnds } = afterGiveback();
      clock.advance(walkoutMs);
      await vacateSeat(rt, ROOM, "dee");
      assert.equal(deadline("bot", ROOM)! - clock.now(), Math.max(0, ceremonyEnds - clock.now()) + botMoveDelayMs());
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
      restoreClock();
    }
  });
}

test("a giveback with no settle stamp, as a restore before the first broadcast holds it, is timed from the re-arm", (t) => {
  t.mock.method(activeGameStore, "write", async () => {});
  const clock = fakeClock();
  const restoreClock = installClock(clock);
  try {
    const { game } = afterGiveback();
    const phase = game.gameState.exchangePhase;
    assert.ok(phase?.kind === "settled");
    delete phase.settledAt;
    delete (game.playerMap as Record<number, string>)[3];
    armTurn(rt, ROOM);
    assert.equal(deadline("bot", ROOM)! - clock.now(), exchangeAnnounceMs(false) + botMoveDelayMs());
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
    restoreClock();
  }
});
