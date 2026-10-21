import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { armAfterMove, armTurn } from "../../server/game/gameTurn.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { botMoveDelayMs, clearRoomTimers } from "../../server/game/gameTimers.ts";
import { createDeck, startRound, type GameState } from "../../lib/game/gameEngine.ts";
import { LEG, exchangeAnnounceMs, exchangeGiveDelayMs, legPose, legShows, restPoint } from "../../lib/timeline/exchangeTimeline.ts";
import { dealEndMs } from "../../lib/timeline/dealTimeline.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";
import { Motion } from "../../lib/tokens.ts";

const ROOM = "exchange-rearm-room";
const { rt } = recordingRuntime();

function exchangeTable(loserHoldsBothJokers = false): OnlineGameState {
  const seats = [0, 1, 2, 3].map((i) => ({ name: `B${i}`, type: "bot" as const, id: `player_${i}` }));
  const deck = createDeck();
  const jokers = deck.filter((c) => c.isJoker);
  const rest = loserHoldsBothJokers ? deck.filter((c) => !c.isJoker) : deck;
  const hands = seats.map((_, s) => rest.filter((_, i) => i % seats.length === s));
  if (loserHoldsBothJokers) hands[3].push(...jokers);
  const gameState: GameState = startRound(seats, "free_for_all", {
    opening: { kind: "exchange", winnerSeat: 0, loserSeat: 3 },
    dealt: hands,
  });
  assert.equal(gameState.exchangePhase?.kind, loserHoldsBothJokers ? "twoJokers" : "open", "the rematch opens an exchange unless the loser holds both Jokers");
  const game: OnlineGameState = {
    roomId: ROOM,
    joinCode: "AAAAAA",
    playerMap: {},
    rematchVotes: new Set(),
    cumulativeScores: {},
    maxPlayers: 4,
    matchTarget: 21,
    matchLength: "match",
    roundsPlayed: 1,
    matchOver: false,
    roundFlags: {},
    abandonedSeats: new Map(),
    botSeatsAtStart: new Set(),
    releasedSeats: new Set(),
    vacatedSeats: new Map(),
    weakSeats: new Set(),
    endMatchVotes: new Set(),
    dealFirstSeat: 0,
    spectators: new Set(),
    moveLog: null,
    gameState,
  };
  activeGames.set(ROOM, game);
  return game;
}

test("a bot winner gives no earlier than the receive has landed and been read, and the next seat waits out the ceremony", (t) => {
  t.mock.method(activeGameStore, "write", async () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const game = exchangeTable();
  try {
    armTurn(rt, ROOM);
    const counts = game.gameState.players.map((p) => p.hand.length);
    const floor = exchangeGiveDelayMs(counts);
    const pile = restPoint();
    const drawn = Array.from({ length: 2 * LEG.end }, (_, ms) => legPose(ms, { from: pile, fromFace: false, rest: pile, to: pile, toFace: true }).visible);
    const received = dealEndMs(counts, Motion.duration.reveal) + legShows(null, false)[0] + drawn.lastIndexOf(true) + 1;
    assert.ok(floor >= received + Motion.exchange.read, `the receive is drawn until ${received}, and read after`);
    t.mock.timers.tick(floor - 1);
    assert.equal(game.gameState.exchangePhase?.kind, "open", "gave before the receive was read");
    t.mock.timers.tick(1);
    assert.equal(game.gameState.exchangePhase?.kind, "settled", "the bot winner gave");
    const after = structuredClone(game.gameState);
    t.mock.timers.tick(Math.max(botMoveDelayMs(), exchangeAnnounceMs(false)) - 1);
    assert.deepEqual(game.gameState, after, "the next seat moved during the ceremony");
    t.mock.timers.tick(1);
    assert.notDeepEqual(game.gameState, after, "the next seat never moved");
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});

test("after a giveback the next seat is re-armed on the giveback ceremony's own clock", (t) => {
  t.mock.method(activeGameStore, "write", async () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const game = exchangeTable();
  try {
    const phase = game.gameState.exchangePhase;
    assert.ok(phase?.kind === "open");
    const give = autoMoveForSeat(game.gameState, phase.winnerIdx, "floor");
    assert.equal(give?.move.kind, "giveback");
    game.gameState = give.state;
    assert.ok(exchangeAnnounceMs(false) > botMoveDelayMs(), "the ceremony is no longer than a bot's own delay, so this proves nothing");
    armAfterMove(rt, ROOM, game.gameState);
    const settled = structuredClone(game.gameState);
    t.mock.timers.tick(exchangeAnnounceMs(false) - 1);
    assert.deepEqual(game.gameState, settled, "the next seat moved during the ceremony");
    t.mock.timers.tick(1);
    assert.notDeepEqual(game.gameState, settled, "the next seat did not move when the ceremony ended");
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});

test("a bot opening a both-Jokers round waits out the deal and the ceremony it opens with", (t) => {
  t.mock.method(activeGameStore, "write", async () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const game = exchangeTable(true);
  try {
    armTurn(rt, ROOM);
    const counts = game.gameState.players.map((p) => p.hand.length);
    const shut = dealEndMs(counts, Motion.duration.reveal) + exchangeAnnounceMs(true);
    const dealt = structuredClone(game.gameState);
    t.mock.timers.tick(shut - 1);
    assert.deepEqual(game.gameState, dealt, "the opener played over the deal or the ceremony");
    t.mock.timers.tick(1);
    assert.notDeepEqual(game.gameState, dealt, "the opener never played");
    assert.equal(game.gameState.exchangePhase?.kind, "twoJokers");
    const opened = structuredClone(game.gameState);
    t.mock.timers.tick(botMoveDelayMs() - 1);
    assert.deepEqual(game.gameState, opened, "the next seat moved early");
    t.mock.timers.tick(1);
    assert.notDeepEqual(game.gameState, opened, "the next seat waited out the exchange floor again, after the round was played into");
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
