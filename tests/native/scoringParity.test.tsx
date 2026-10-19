import { describe, it, expect } from '@jest/globals';
import { applyRoundToMatch, freshMatch } from '@/context/GameContext';
import { resolveRoundEnd } from '@/server/game/onlineGameLogic';
import { initializeGame, teamForSeat, type GameMode } from '@/lib/game/gameEngine';
import { simulateOfflineMatch } from '../helpers/offlineMatch';
import { mulberry32 } from '../support/game';

// The offline table scores a round in context/GameContext.tsx and the server
// in server/game/onlineGameLogic.ts. A table of bots plays the same match on
// both: every round, every seat's points, the target, the verdict and the
// winners must agree. Here rather than under node --test because GameContext
// imports React Native.

const SEEDS = 12;
const TABLES: { players: number; mode: GameMode }[] = [
  { players: 2, mode: 'free_for_all' },
  { players: 3, mode: 'free_for_all' },
  { players: 4, mode: 'free_for_all' },
  { players: 4, mode: 'teams' },
];

describe.each(TABLES)('$players seats, $mode', ({ players, mode }) => {
  const setup = Array.from({ length: players }, (_, i) => ({ name: `P${i}`, type: 'bot' as const, team: teamForSeat(i, players, mode) }));
  const template = initializeGame(setup, mode, 0);
  const allSeats = new Set(setup.map((_, i) => i));

  it.each(Array.from({ length: SEEDS }, (_, i) => i + 1))('seed %i: the server and the offline table score the match alike', (seed) => {
    const played = simulateOfflineMatch({ seed, players: setup, gameMode: mode, length: 'match', botRng: (s) => mulberry32(s + 1) });

    let offline = freshMatch('match', players);
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
        matchLength: 'match',
        gameMode: mode,
        roundFlags: {},
        abandonedSeats: new Map(),
        botSeatsAtStart: allSeats,
      });
      cumulativeScores = server.cumulativeScores;
      matchTarget = server.matchTarget;

      const at = `round ${index + 1}`;
      const pointsAwarded = offline.rounds[offline.rounds.length - 1].pointsAwarded;
      expect({ at, points: server.detailed.map((row) => row.points) })
        .toEqual({ at, points: state.players.map((p) => pointsAwarded[p.id] ?? 0) });
      expect({ at, totals: server.detailed.map((row) => row.total) })
        .toEqual({ at, totals: state.players.map((p) => offline.scores[p.id] ?? 0) });
      expect({ at, target: server.matchTarget, over: server.matchOver, draw: server.isDraw })
        .toEqual({ at, target: offline.target, over: offline.over, draw: offline.isDraw });
      expect({ at, winners: [...server.winnerEngineIds].sort() }).toEqual({ at, winners: [...offline.winners].sort() });
      expect({ at, harness: round.cumulativeAfter }).toEqual({ at, harness: offline.scores });
    }
    expect(offline.over).toBe(true);
  });
});
