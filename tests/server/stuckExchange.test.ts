// A stuck exchange on the server closes through lib/game/autoMove.ts's
// `resolveStuckExchange`, reached via gameTurn.ts's `autoMoveForSeat`; the
// lead it hands over must land on a seat that can play (docs/GAME-RULES.md §9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { autoMoveForSeat } from "../../server/game/gameTurn.ts";
import type { Card, GameState, Player } from "../../lib/game/gameEngine.ts";

const card = (id: string, rank: Card["rank"]): Card => ({ id, rank, suit: "clubs", isJoker: false });

function player(id: string, hand: Card[]): Player {
  return { id, name: id, hand, type: "human" };
}

test("a stuck exchange with an empty-handed loser hands the turn to a seat holding cards", () => {
  const gameState: GameState = {
    players: [
      player("winner", []),
      player("loser", []),
      player("c", [card("5_clubs", "5")]),
      player("d", [card("6_clubs", "6")]),
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: true,
    exchangePhase: {
      active: true,
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: card("A_spades", "A"),
      twoJokerException: false,
    },
  };

  const next = autoMoveForSeat({ gameState, roundFlags: {}, moveLog: null }, 0, true)?.next;

  assert.ok(next, "the exchange winner's seat must resolve the stuck phase");
  assert.equal(next.exchangePhase?.active, false);
  assert.ok(next.players[next.currentTurnIndex].hand.length > 0, `seat ${next.currentTurnIndex} holds no cards`);
  assert.equal(next.currentTurnIndex, 3);
  assert.equal(next.lastPlayedBy, 3);
});
