// The server holds the first move of a one-way exchange's loser until the table's ceremony has told it,
// as it holds the opener's after two Jokers: a bot waits it out, a human's AFK window starts after it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";

import { armTurn } from "../../server/game/gameTurn.ts";
import { afkTimeoutMs, botMoveDelayMs, clearRoomTimers, deadline } from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { createDeck, emptyRankTally } from "../../lib/game/gameEngine.ts";
import type { Card, GameState, Player } from "../../lib/game/gameEngine.ts";
import { exchangeGiveDelayMs } from "../../lib/timeline/exchangeTimeline.ts";
import { gateMs } from "../../lib/timeline/turnGates.ts";

const ROOM = "one-way-hold-room";
const WINNER = 0;
const LOSER = 1;
const SIX = 6;
const TAKEN: Card = { id: "2_spades", suit: "spades", rank: "2", isJoker: false };
const { rt } = recordingRuntime();
let restoreClock = () => {};

function dealt(seats: number, phase: GameState["exchangePhase"], played = false): GameState {
  const deck = createDeck();
  const players: Player[] = Array.from({ length: seats }, (_, s) => ({
    id: `player_${s}`,
    name: `P${s}`,
    type: "bot",
    hand: deck.filter((_, i) => i % seats === s),
  }));
  const playedRanks = emptyRankTally();
  if (played) playedRanks[SIX] = 1;
  return {
    players,
    currentTurnIndex: LOSER,
    lastPlayedCombination: null,
    lastPlayedBy: LOSER,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    lastMove: played ? { seq: 1, kind: "play", seat: LOSER } : { seq: 0, kind: "deal" },
    startReason: { type: "lost_round", playerIdx: LOSER },
    playedRanks,
    exchangePhase: phase,
  };
}

const oneWay = { kind: "settled", winnerIdx: WINNER, loserIdx: LOSER, cardFromLoser: TAKEN } as const;
const twoWay = { ...oneWay, cardToLoser: { id: "5_hearts", suit: "hearts", rank: "5", isJoker: false } } as const;

function seat(gameState: GameState, playerMap: Record<number, string>): OnlineGameState {
  const game = { roomId: ROOM, gameState, playerMap } as unknown as OnlineGameState;
  activeGames.set(ROOM, game);
  return game;
}
function arm(gameState: GameState, playerMap: Record<number, string> = {}) {
  const clock = fakeClock();
  restoreClock = installClock(clock);
  const game = seat(gameState, playerMap);
  armTurn(rt, ROOM);
  return { clock, game, counts: gameState.players.map((p) => p.hand.length) };
}
function teardown() {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  restoreClock();
}

describe("a one-way exchange's loser leads once the ceremony has told it", () => {
  for (const seats of [4, 3]) {
    test(`${seats} seats: a bot loser's first move waits the deal, the receive and the beat, then thinks`, () => {
      const { clock, counts } = arm(dealt(seats, oneWay));
      try {
        const gates = gateMs(["deal", "oneWay"], counts, false);
        assert.ok(gates > exchangeGiveDelayMs(counts), "longer than a giveback's own wait");
        assert.equal(deadline("bot", ROOM)! - clock.now(), gates + botMoveDelayMs());
      } finally {
        teardown();
      }
    });
  }

  test("a human loser's window runs on its own: the ceremony is inside it, as for two Jokers", () => {
    const { clock, game } = arm(dealt(3, oneWay), { [LOSER]: "u1" });
    try {
      assert.equal(game.turnDeadlineMs! - clock.now(), gateMs(["opening"], [], false) + afkTimeoutMs());
    } finally {
      teardown();
    }
  });

  test("a round already in play keeps the bot's own delay", () => {
    const { clock } = arm(dealt(4, oneWay, true));
    try {
      assert.equal(deadline("bot", ROOM)! - clock.now(), botMoveDelayMs());
    } finally {
      teardown();
    }
  });

  test("a two-way exchange's close is not held as a one-way one", () => {
    const { clock, counts } = arm(dealt(4, twoWay));
    try {
      const waited = deadline("bot", ROOM)! - clock.now();
      assert.ok(waited < gateMs(["deal", "oneWay"], counts, false), `${waited} ms`);
    } finally {
      teardown();
    }
  });
});
