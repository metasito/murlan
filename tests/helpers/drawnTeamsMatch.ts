import { resolveRoundEnd } from "../../server/game/onlineGameLogic.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { aThreePlayed } from "../support/game.ts";

function seat(id: string, name: string, team: "A" | "B", handSize: number): Player {
  return {
    id,
    name,
    hand: Array.from({ length: handSize }, () => ({ rank: "3", suit: "spades" }) as never),
    type: "human",
    team,
  };
}

/** Seats 0/2 are team A, 1/3 team B; this round's 3/2/1/0 lands both pairs on the final 51. */
export function drawnTeamsMatch() {
  const state: GameState = {
    players: [seat("p0", "A1", "A", 0), seat("p1", "B1", "B", 0), seat("p2", "A2", "A", 0), seat("p3", "B2", "B", 8)],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "teams",
    trickWinner: null,
    roundOver: true,
    finishingOrder: ["p0", "p1", "p2", "p3"],
    firstPlayMade: true,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: "deal" },
  };
  return resolveRoundEnd({
    state,
    playerMap: { 0: "a1", 1: "b1", 2: "a2", 3: "b2" },
    cumulativeScores: { a1: 24, b1: 25, a2: 23, b2: 24 },
    matchTarget: 51,
    matchLength: "match",
    gameMode: "teams",
    roundFlags: {},
    abandonedSeats: new Map(),
  });
}
