// tests/native/teamsSingleRound.test.tsx — a one-round teams game is won by
// a pair. `applyRoundToMatch` lives in a .tsx context module, so it is only
// reachable from the jest-expo suite; tests/engine/teams.test.ts covers the
// full-match arithmetic in the node suite.
import { describe, it, expect } from '@jest/globals';
import { applyRoundToMatch } from '@/context/GameContext';
import type { GameState } from '@/lib/game/gameEngine';

const seat = (i: number, team: 'A' | 'B') => ({
  id: `player_${i}`,
  name: `p${i}`,
  hand: [],
  type: 'human' as const,
  team,
});

const finished = (gameMode: GameState['gameMode'], finishingOrder: string[]): GameState => ({
  players: [seat(0, 'A'), seat(1, 'B'), seat(2, 'A'), seat(3, 'B')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode,
  trickWinner: null,
  roundOver: true,
  finishingOrder,
  firstPlayMade: true,
});

const single = { length: 'single' as const, target: 21, scores: {}, hands: [], over: false, winners: [], isDraw: false };

describe('a single-round match', () => {
  it('credits both partners in teams mode', () => {
    const match = applyRoundToMatch(single, finished('teams', ['player_2', 'player_1', 'player_0', 'player_3']));
    expect(match.over).toBe(true);
    expect([...match.winners].sort()).toEqual(['player_0', 'player_2']);
  });

  it('credits only the winner in free-for-all', () => {
    const match = applyRoundToMatch(single, finished('free_for_all', ['player_2', 'player_1', 'player_0', 'player_3']));
    expect(match.winners).toEqual(['player_2']);
  });
});
