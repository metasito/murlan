// #830: the online opener's first turn of a round carries the announcement's
// reading time (`Reading.notice`) on top of the normal AFK window, so a client
// holding the table behind the opening gate does not spend its own turn clock
// on time the game itself imposed. Derived from state the server already
// holds (`openingIsPending`, shared with the client) rather than a signal a
// client sends — so what has to be pinned here is the derivation's shape:
// granted once, on the opener's own first turn, and nowhere else.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";

import { armTurn, armTurnIfIdle } from "../../server/game/gameTurn.ts";
import {
  afkTimeoutMs,
  clearRoomTimers,
  pending,
  pendingKeys,
  seatKey,
  setClock,
} from "../../server/game/gameTimers.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { emptyRankTally } from "../../lib/game/gameEngine.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { Reading } from "../../lib/tokens.ts";

const ROOM = "opening-grace-room";
const OPENER = "opening-grace-opener";
const OTHER = "opening-grace-other";

/** A stub io that records nothing — armTurn's emits are not under test here. */
const io = { to: () => ({ emit: () => {} }) } as unknown as SocketServer;

function player(id: string, name: string): Player {
  return { id, name, hand: [], type: "human" };
}

/** A freshly dealt round, opener at seat 0, nothing played yet. */
function freshRound(): GameState {
  return {
    players: [player("p0", "Opener"), player("p1", "Other")],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
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
  setClock();
}

const afkKeysInRoom = () => pendingKeys("afk").filter((k) => k.startsWith(`${ROOM}:`));

describe("the opener's first-turn AFK grace (#830)", () => {
  test("grants Reading.notice on the opener's first turn, and never again once the round has a play in it", () => {
    const clock = fakeClock();
    setClock(clock);
    const game = seat(freshRound(), { 0: OPENER, 1: OTHER });
    try {
      armTurn(io, ROOM);
      assert.equal(
        game.turnDeadlineMs! - clock.now(),
        afkTimeoutMs() + Reading.notice,
        "opener's first turn: expected afkTimeoutMs() + Reading.notice"
      );

      // The opener has now played — the rank tally is no longer all zero, so
      // `openingIsPending` reads this round as past its opening even though
      // nothing else about the turn changed.
      game.gameState.playedRanks![0] = 1;

      clock.advance(1_000);
      armTurn(io, ROOM);
      assert.equal(
        game.turnDeadlineMs! - clock.now(),
        afkTimeoutMs(),
        "a later turn must carry only afkTimeoutMs() — the grant must not renew"
      );
    } finally {
      teardown();
    }
  });

  test("a seat vacated to a bot gets no grant and no AFK timer, even on the opener's own turn", () => {
    // No entry for seat 0: the opener's seat is vacant.
    const game = seat(freshRound(), { 1: OTHER });
    try {
      armTurn(io, ROOM);
      assert.equal(
        game.turnDeadlineMs,
        undefined,
        "a vacant opener's turn carries no deadline — a bot has no clock to grant a window on"
      );
      assert.deepEqual(afkKeysInRoom(), [], "a vacant seat must not arm a human AFK timer");
    } finally {
      teardown();
    }
  });

  test("a rejoin mid-opening does not renew the grant, and nobody but the opener carries a timer", () => {
    const clock = fakeClock();
    setClock(clock);
    const game = seat(freshRound(), { 0: OPENER, 1: OTHER });
    try {
      armTurn(io, ROOM);
      const granted = game.turnDeadlineMs;
      assert.equal(typeof granted, "number");

      // A re-arm that ignored the idle guard would land on the same instant
      // without this, and pass by coincidence.
      clock.advance(20);

      // Simulates the opener's own client reconnecting while its AFK timer is
      // still pending — the path `game:rejoin` takes.
      armTurnIfIdle(io, ROOM);
      assert.equal(
        game.turnDeadlineMs,
        granted,
        "a rejoin while the grant is still running must not recompute a fresh window"
      );

      assert.deepEqual(
        afkKeysInRoom(),
        [seatKey(ROOM, OPENER)],
        "only the acting seat carries a timer — a spectator or the seat not yet on turn gets nothing"
      );
    } finally {
      teardown();
    }
  });

  test("the opener's AFK timer expires at the granted deadline, not at the bare AFK window", () => {
    const clock = fakeClock();
    setClock(clock);
    const game = seat(freshRound(), { 0: OPENER, 1: OTHER });
    try {
      armTurn(io, ROOM);
      // The expiry auto-passes against this stub table, which has nothing to pass.
      game.gameState.roundOver = true;

      clock.advance(afkTimeoutMs());
      assert.equal(pending("afk", seatKey(ROOM, OPENER)), true, "expired without the opening grant");

      clock.advance(Reading.notice);
      assert.equal(pending("afk", seatKey(ROOM, OPENER)), false, "still pending past its deadline");
    } finally {
      teardown();
    }
  });
});
