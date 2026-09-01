// tests/native/losingSeatHaptic.test.tsx — the manche's success haptic goes
// only to the seat ResultBoard is celebrating, offline and online alike.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

// Hoisted above the imports, so it reads these back at render time rather than
// closing over them — which is what the `mock` prefix permits.
jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: mockState,
    match: mockMatch,
    tableWantsRematch: false,
    startNextHand: () => {},
    startNewMatch: () => {},
    chooseExchangeCard: () => {},
    resetGame: () => {},
  }),
}));

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import ResultScreen from '@/app/result';
import { GameOverOverlay } from '@/components/GameOverOverlay';
import type { GameState, Player } from '@/lib/gameEngine';
import type { MatchState } from '@/context/GameContext';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (
  id: string,
  name: string,
  type: Player['type'] = 'human',
  team?: 'A' | 'B'
): Player => ({ id, name, hand: [], type, team });

const notificationAsync = Haptics.notificationAsync as unknown as ReturnType<typeof jest.fn>;
const firedSuccess = () =>
  notificationAsync.mock.calls.some(
    (call) => call[0] === Haptics.NotificationFeedbackType.Success
  );

// Read back by the mocked GameContext above, at render time.
let mockState: GameState;
let mockMatch: MatchState;

describe('the success haptic goes only to the celebrated seat', () => {
  beforeEach(() => {
    notificationAsync.mockClear();
  });

  it('offline: stays silent on the human seat that lost the hand', async () => {
    mockState = {
      players: [seat('player_0', 'Bot', 'ai'), seat('player_1', 'You', 'human')],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: 0,
      passCount: 0,
      gameMode: 'free_for_all',
      roundWinner: null,
      gameOver: true,
      rankings: ['player_0', 'player_1'],
      firstPlayMade: true,
    };
    mockMatch = {
      length: 'match',
      target: 21,
      scores: { player_0: 3, player_1: 0 },
      hands: [
        { rankings: ['player_0', 'player_1'], pointsAwarded: { player_0: 3, player_1: 0 } },
      ],
      over: false,
      winners: [],
      isDraw: false,
    };

    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ResultScreen />
      </SafeAreaProvider>
    );
    await act(async () => {});

    expect(firedSuccess()).toBe(false);
    await view.unmount();
  });

  it('offline: still fires for the human seat that won the hand', async () => {
    mockState = {
      players: [seat('player_0', 'You', 'human'), seat('player_1', 'Bot', 'ai')],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: 0,
      passCount: 0,
      gameMode: 'free_for_all',
      roundWinner: null,
      gameOver: true,
      rankings: ['player_0', 'player_1'],
      firstPlayMade: true,
    };
    mockMatch = {
      length: 'match',
      target: 21,
      scores: { player_0: 3, player_1: 0 },
      hands: [
        { rankings: ['player_0', 'player_1'], pointsAwarded: { player_0: 3, player_1: 0 } },
      ],
      over: false,
      winners: [],
      isDraw: false,
    };

    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ResultScreen />
      </SafeAreaProvider>
    );
    await act(async () => {});

    expect(firedSuccess()).toBe(true);
    await view.unmount();
  });

  const twoSeatState = (): GameState => ({
    players: [seat('player_0', 'Ana'), seat('player_1', 'Besi')],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: 'free_for_all',
    roundWinner: null,
    gameOver: true,
    rankings: ['player_0', 'player_1'],
    firstPlayMade: true,
  });

  it('online: stays silent on the seat that placed last', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameOverOverlay
          gameState={twoSeatState()}
          topPad={0}
          bottomPad={0}
          onLeave={() => {}}
          onVoteRematch={() => {}}
          voteState={null}
          myUserId="u2"
          mySeatIndex={1}
          cumulativeScores={{ player_0: 3, player_1: 0 }}
          handScores={{ player_0: 3, player_1: 0 }}
          ratingDelta={null}
          handRecorded={true}
          match={{
            target: 21,
            length: 'match',
            handsPlayed: 1,
            over: false,
            winners: [],
            isDraw: false,
            continues: true,
          }}
        />
      </SafeAreaProvider>
    );
    await act(async () => {});

    expect(firedSuccess()).toBe(false);
    await view.unmount();
  });

  it('online: still fires for the seat that placed first', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameOverOverlay
          gameState={twoSeatState()}
          topPad={0}
          bottomPad={0}
          onLeave={() => {}}
          onVoteRematch={() => {}}
          voteState={null}
          myUserId="u1"
          mySeatIndex={0}
          cumulativeScores={{ player_0: 3, player_1: 0 }}
          handScores={{ player_0: 3, player_1: 0 }}
          ratingDelta={null}
          handRecorded={true}
          match={{
            target: 21,
            length: 'match',
            handsPlayed: 1,
            over: false,
            winners: [],
            isDraw: false,
            continues: true,
          }}
        />
      </SafeAreaProvider>
    );
    await act(async () => {});

    expect(firedSuccess()).toBe(true);
    await view.unmount();
  });

  it('online: fires for every member of the team that won the match, not only the seat that finished first', async () => {
    const gameState: GameState = {
      players: [
        seat('player_0', 'Ana', 'human', 'A'),
        seat('player_1', 'Besi', 'human', 'B'),
        seat('player_2', 'Cveta', 'human', 'A'),
        seat('player_3', 'Dritan', 'human', 'B'),
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: 0,
      passCount: 0,
      gameMode: 'teams',
      roundWinner: null,
      gameOver: true,
      rankings: ['player_0', 'player_1', 'player_2', 'player_3'],
      firstPlayMade: true,
    };

    // player_2 is Ana's teammate: it placed third, not first, but team A
    // (player_0 + player_2) took the match.
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameOverOverlay
          gameState={gameState}
          topPad={0}
          bottomPad={0}
          onLeave={() => {}}
          onVoteRematch={() => {}}
          voteState={null}
          myUserId="u3"
          mySeatIndex={2}
          cumulativeScores={{ player_0: 21, player_1: 10, player_2: 21, player_3: 10 }}
          handScores={{ player_0: 3, player_1: 0, player_2: 1, player_3: 0 }}
          ratingDelta={null}
          handRecorded={true}
          match={{
            target: 21,
            length: 'match',
            handsPlayed: 5,
            over: true,
            winners: ['player_0', 'player_2'],
            isDraw: false,
            continues: false,
          }}
        />
      </SafeAreaProvider>
    );
    await act(async () => {});

    expect(firedSuccess()).toBe(true);
    await view.unmount();
  });
});
