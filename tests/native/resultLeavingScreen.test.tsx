// tests/native/resultLeavingScreen.test.tsx — the tap that starts the next match also leaves this
// screen, and on Android a leaving screen's views are mid-transition: a re-sorted row there is a
// remove-and-reinsert the native view cannot take, and the app dies (#1193).
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
const mockStartNewMatch = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: mockReplace, push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/lib/device/haptics', () => ({
  setHapticsMasterEnabled: jest.fn(),
  hapticsEnabled: () => false,
  hapticSelection: jest.fn(),
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticHeavy: jest.fn(),
  hapticRigid: jest.fn(),
  hapticSuccess: jest.fn(),
  hapticError: jest.fn(),
  hapticWarn: jest.fn(),
}));

jest.mock('@/lib/device/sounds', () => ({ holdSounds: () => () => {}, ensureAudioMode: jest.fn() }));

const mockPlayers = [
  { id: 'player_0', name: 'Ana', type: 'human', cards: [] },
  { id: 'player_1', name: 'Bot', type: 'ai', cards: [] },
];

const mockWonByBot = {
  over: true,
  isDraw: false,
  length: 'match',
  target: 21,
  winners: ['player_1'],
  scores: { player_0: 5, player_1: 21 },
  hands: [{ rankings: ['player_1', 'player_0'], pointsAwarded: { player_1: 3 } }],
};

const mockFresh = { ...mockWonByBot, over: false, winners: [], scores: {}, hands: [] };

jest.mock('@/context/gameHooks', () => {
  const { useState } = jest.requireActual<typeof React>('react');
  const gameState = { players: mockPlayers, gameMode: 'free_for_all', gameOver: false };
  return {
    useLocalTable: () => ({ gameState }),
    useLocalMatch: () => {
      const [match, setMatch] = useState<object>(mockWonByBot);
      return {
        match,
        tableWantsRematch: true,
        startNextHand: jest.fn(),
        startNewMatch: () => {
          mockStartNewMatch();
          setMatch(mockFresh);
        },
      };
    },
    useLocalSession: () => ({ resetGame: jest.fn() }),
  };
});

const ResultScreen = (require('@/app/result') as { default: React.ComponentType }).default;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const rankedTotals = (view: Awaited<ReturnType<typeof render>>) =>
  view.getAllByTestId('rank-total').map((total) => total.props.children);

describe('ResultBoard RankCards on the result screen a new match leaves behind', () => {
  it('are neither re-sorted nor re-rendered while the screen goes', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ResultScreen />
      </SafeAreaProvider>
    );
    expect(rankedTotals(view)).toEqual([21, 5]);

    await fireEvent.press(view.getByTestId('btn-nuova-partita'));

    expect(mockReplace).toHaveBeenCalledWith('/game');
    expect(rankedTotals(view)).toEqual([21, 5]);
    expect(view.getByTestId('btn-nuova-partita')).toBeTruthy();
    await view.unmount();
  });

  it('start the new match once however often the leaving button is tapped', async () => {
    mockStartNewMatch.mockClear();
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ResultScreen />
      </SafeAreaProvider>
    );

    await fireEvent.press(view.getByTestId('btn-nuova-partita'));
    await fireEvent.press(view.getByTestId('btn-nuova-partita'));

    expect(mockStartNewMatch).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
