// #830: the online opener's first turn of a manche carries the announcement's
// reading time (`Reading.notice`) on top of the normal AFK window, so a client
// holding the table behind the opening gate does not spend its own turn clock
// on time the game itself imposed. Derived from state the server already
// holds (`openingIsPending`, shared with the client) rather than a signal a
// client sends — so what has to be pinned here is the derivation's shape:
// granted once, on the opener's own first turn, and nowhere else.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import type { Server as SocketServer } from "socket.io";

import { armTurn, armTurnIfIdle } from "../server/gameTurn.ts";
import { afkTimers, afkTimeoutMs, clearRoomTimers } from "../server/gameTimers.ts";
import { activeGames } from "../server/gameRoom.ts";
import type { OnlineGameState } from "../server/gameRoom.ts";
import { emptyRankTally } from "../lib/gameEngine.ts";
import type { GameState, Player } from "../lib/gameEngine.ts";
import { Reading } from "../lib/tokens.ts";

const ROOM = "opening-grace-room";
const OPENER = "opening-grace-opener";
const OTHER = "opening-grace-other";

/** A stub io that records nothing — armTurn's emits are not under test here. */
const io = { to: () => ({ emit: () => {} }) } as unknown as SocketServer;

function player(id: string, name: string): Player {
  return { id, name, hand: [], type: "human" };
}

/** A freshly dealt manche, opener at seat 0, nothing played yet. */
function freshManche(): GameState {
  return {
    players: [player("p0", "Opener"), player("p1", "Other")],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: false,
    startReason: { type: "start_card", playerIdx: 0 },
    playedRanks: emptyRankTally(),
  };
}

function seat(gameState: GameState, playerMap: Record<number, string>): OnlineGameState {
  const game = { roomId: ROOM, gameState, playerMap } as unknown as OnlineGameState;
  activeGames.set(ROOM, game);
  return game;
}

function teardown() {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
}

describe("the opener's first-turn AFK grace (#830)", () => {
  test("grants Reading.notice on the opener's first turn, and never again once the manche has a play in it", () => {
    const game = seat(freshManche(), { 0: OPENER, 1: OTHER });
    try {
      const before = Date.now();
      armTurn(io, ROOM);
      const openingWindowMs = game.turnDeadlineMs! - before;
      assert.ok(
        Math.abs(openingWindowMs - (afkTimeoutMs() + Reading.notice)) < 200,
        `opener's first turn: expected afkTimeoutMs() + Reading.notice (${
          afkTimeoutMs() + Reading.notice
        }ms), got ${openingWindowMs}ms`
      );

      // The opener has now played — the rank tally is no longer all zero, so
      // `openingIsPending` reads this manche as past its opening even though
      // nothing else about the turn changed.
      game.gameState.playedRanks![0] = 1;

      const before2 = Date.now();
      armTurn(io, ROOM);
      const laterWindowMs = game.turnDeadlineMs! - before2;
      assert.ok(
        Math.abs(laterWindowMs - afkTimeoutMs()) < 200,
        `a later turn must carry only afkTimeoutMs() (${afkTimeoutMs()}ms), got ${laterWindowMs}ms — the grant must not renew`
      );
    } finally {
      teardown();
    }
  });

  test("a seat vacated to a bot gets no grant and no AFK timer, even on the opener's own turn", () => {
    // No entry for seat 0: the opener's seat is vacant.
    const game = seat(freshManche(), { 1: OTHER });
    try {
      armTurn(io, ROOM);
      assert.equal(
        game.turnDeadlineMs,
        undefined,
        "a vacant opener's turn carries no deadline — a bot has no clock to grant a window on"
      );
      assert.deepEqual(
        [...afkTimers.keys()].filter((k) => k.startsWith(`${ROOM}:`)),
        [],
        "a vacant seat must not arm a human AFK timer"
      );
    } finally {
      teardown();
    }
  });

  test("a rejoin mid-opening does not renew the grant, and nobody but the opener carries a timer", async () => {
    const game = seat(freshManche(), { 0: OPENER, 1: OTHER });
    try {
      armTurn(io, ROOM);
      const granted = game.turnDeadlineMs;
      assert.equal(typeof granted, "number");

      // A real gap, not zero: `Date.now()` in a re-arm that ignored the idle
      // guard would land in the same millisecond as the call above and pass
      // this assertion by accident. Advancing the clock first is what makes a
      // silent renewal show up as a changed deadline instead of a coincidence.
      await setTimeoutPromise(20);

      // Simulates the opener's own client reconnecting while its AFK timer is
      // still pending — the path `game:rejoin` takes.
      armTurnIfIdle(io, ROOM);
      assert.equal(
        game.turnDeadlineMs,
        granted,
        "a rejoin while the grant is still running must not recompute a fresh window"
      );

      assert.deepEqual(
        [...afkTimers.keys()].filter((k) => k.startsWith(`${ROOM}:`)),
        [`${ROOM}:${OPENER}`],
        "only the acting seat carries a timer — a spectator or the seat not yet on turn gets nothing"
      );
    } finally {
      teardown();
    }
  });
});
