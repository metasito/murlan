// tests/native/drawnMancheCelebration.test.tsx — a 3-3 manche in teams mode
// (RULES.md §11) has no seat or team to celebrate: first-and-fourth (3+0)
// pays the same total as second-and-third (2+1). Nobody is congratulated and
// no winning haptic fires, offline and online alike.
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
import { t } from '@/lib/i18n';
import type { GameState, Player } from '@/lib/gameEngine';
import type { MatchState } from '@/context/GameContext';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (id: string, name: string, team: 'A' | 'B'): Player => ({
  id,
  name,
  hand: [],
  type: 'human',
  team,
});

const notificationAsync = Haptics.notificationAsync as unknown as ReturnType<typeof jest.fn>;

// First-and-fourth (3+0) against second-and-third (2+1): both pay 3, a draw.
const drawnRankings = ['player_0', 'player_1', 'player_2', 'player_3'];
const drawnHandScores = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };

let mockState: GameState;
let mockMatch: MatchState;

describe('a drawn manche in teams mode congratulates nobody', () => {
  beforeEach(() => {
    notificationAsync.mockClear();
  });

  it('offline: fires no haptic for the seat that finished first', async () => {
    mockState = {
      players: [
        seat('player_0', 'Ana', 'A'),
        seat('player_1', 'Besi', 'B'),
        seat('player_2', 'Cveta', 'B'),
        seat('player_3', 'Dritan', 'A'),
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: 0,
      passCount: 0,
      gameMode: 'teams',
      roundWinner: null,
      gameOver: true,
      rankings: drawnRankings,
      firstPlayMade: true,
    };
    mockMatch = {
      length: 'match',
      target: 21,
      scores: { player_0: 3, player_1: 2, player_2: 1, player_3: 0 },
      hands: [{ rankings: drawnRankings, pointsAwarded: drawnHandScores }],
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

    expect(notificationAsync.mock.calls).toEqual([]);
    expect(view.getByText(t('result.handDrawTitle'))).toBeTruthy();
    expect(view.getByText(t('result.handDrawSubtitle'))).toBeTruthy();
    expect(view.queryByText(t('result.handWinner'))).toBeNull();
    await view.unmount();
  });

  it('online: fires no haptic for the seat that finished first', async () => {
    const gameState: GameState = {
      players: [
        seat('player_0', 'Ana', 'A'),
        seat('player_1', 'Besi', 'B'),
        seat('player_2', 'Cveta', 'B'),
        seat('player_3', 'Dritan', 'A'),
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: 0,
      passCount: 0,
      gameMode: 'teams',
      roundWinner: null,
      gameOver: true,
      rankings: drawnRankings,
      firstPlayMade: true,
    };

    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameOverOverlay
          gameState={gameState}
          topPad={0}
          bottomPad={0}
          onLeave={() => {}}
          onVoteRematch={() => {}}
          voteState={null}
          myUserId="u1"
          mySeatIndex={0}
          cumulativeScores={drawnHandScores}
          handScores={drawnHandScores}
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

    expect(notificationAsync.mock.calls).toEqual([]);
    expect(view.getByText(t('result.handDrawTitle'))).toBeTruthy();
    expect(view.getByText(t('result.handDrawSubtitle'))).toBeTruthy();
    expect(view.queryByText(t('result.handWinner'))).toBeNull();
    await view.unmount();
  });
});
