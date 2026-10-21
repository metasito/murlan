// tests/engine/teamsSingleRound.test.ts — a one-round teams match is won by
// a team, through the offline accounting GameContext.tsx runs.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyRoundToMatch } from "../../lib/game/matchFlow.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";
import { emptyRankTally } from "../../lib/game/gameEngine.ts";

const seat = (i: number, team: "A" | "B") => ({
  id: `player_${i}`,
  name: `p${i}`,
  hand: [],
  type: "human" as const,
  team,
});

const finished = (gameMode: GameState["gameMode"], finishingOrder: string[]): GameState => ({
  players: [seat(0, "A"), seat(1, "B"), seat(2, "A"), seat(3, "B")],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode,
  trickWinner: null,
  roundOver: true,
  finishingOrder,
  firstPlayMade: true,
  playedRanks: emptyRankTally(),
  lastMove: { seq: 0, kind: "deal" },
});

const single = { length: "single" as const, target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false };

describe("a single-round match", () => {
  test("credits both partners in teams mode", () => {
    const match = applyRoundToMatch(single, finished("teams", ["player_2", "player_1", "player_0", "player_3"]));
    assert.equal(match.over, true);
    assert.deepEqual([...match.winners].sort(), ["player_0", "player_2"]);
  });

  test("credits only the winner in free-for-all", () => {
    const match = applyRoundToMatch(single, finished("free_for_all", ["player_2", "player_1", "player_0", "player_3"]));
    assert.deepEqual(match.winners, ["player_2"]);
  });
});
