import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyRoundToMatch, freshMatch } from "../../lib/game/matchFlow.ts";
import { resolveRoundEnd } from "../../server/game/onlineGameLogic.ts";
import { initializeGame, teamForSeat, type GameMode } from "../../lib/game/gameEngine.ts";
import { simulateOfflineMatch } from "../helpers/offlineMatch.ts";
import { mulberry32 } from "../support/game.ts";

// The offline table scores a round in lib/game/matchFlow.ts and the server in
// server/game/onlineGameLogic.ts. A table of bots plays the same match on both:
// every round, every seat's points, the target, the verdict and the winners
// must agree.

const SEEDS = 12;
const TABLES: { players: number; mode: GameMode }[] = [
  { players: 2, mode: "free_for_all" },
  { players: 3, mode: "free_for_all" },
  { players: 4, mode: "free_for_all" },
  { players: 4, mode: "teams" },
];

for (const { players, mode } of TABLES) {
  describe(`${players} seats, ${mode}`, () => {
    const setup = Array.from({ length: players }, (_, i) => ({ name: `P${i}`, type: "bot" as const, team: teamForSeat(i, players, mode) }));
    const template = initializeGame(setup, mode, 0);
    const allSeats = new Set(setup.map((_, i) => i));

    for (let seed = 1; seed <= SEEDS; seed++) {
      test(`seed ${seed}: the server and the offline table score the match alike`, () => {
        const played = simulateOfflineMatch({ seed, players: setup, gameMode: mode, length: "match", botRng: (s) => mulberry32(s + 1) });

        let offline = freshMatch("match", players);
        let cumulativeScores: Record<string, number> = {};
        let matchTarget = offline.target;

        for (const [index, round] of played.rounds.entries()) {
          const state = { ...template, finishingOrder: round.finishingOrder };
          offline = applyRoundToMatch(offline, state);
          const server = resolveRoundEnd({
            state,
            playerMap: {},
            cumulativeScores,
            matchTarget,
            matchLength: "match",
            gameMode: mode,
            roundFlags: {},
            abandonedSeats: new Map(),
            botSeatsAtStart: allSeats,
          });
          cumulativeScores = server.cumulativeScores;
          matchTarget = server.matchTarget;

          const at = `round ${index + 1}`;
          const pointsAwarded = offline.rounds[offline.rounds.length - 1].pointsAwarded;
          assert.deepEqual({ at, points: server.detailed.map((row) => row.points) }, { at, points: state.players.map((p) => pointsAwarded[p.id] ?? 0) });
          assert.deepEqual({ at, totals: server.detailed.map((row) => row.total) }, { at, totals: state.players.map((p) => offline.scores[p.id] ?? 0) });
          assert.deepEqual(
            { at, target: server.matchTarget, over: server.matchOver, draw: server.isDraw },
            { at, target: offline.target, over: offline.over, draw: offline.isDraw },
          );
          assert.deepEqual({ at, winners: [...server.winnerEngineIds].sort() }, { at, winners: [...offline.winners].sort() });
          assert.deepEqual({ at, harness: round.cumulativeAfter }, { at, harness: offline.scores });
        }
        assert.equal(offline.over, true);
      });
    }
  });
}
