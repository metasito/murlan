// tests/native/resultNewMatchUnasked.test.tsx — the end of an offline partita offers a new one
// without anyone having been asked about it first (docs/GAME-RULES.md § Decisions).
import { it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
const mockStartNewMatch = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: mockReplace, push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/context/gameHooks', () => {
  const gameState = {
    players: [
      { id: 'player_0', name: 'Ana', type: 'human', cards: [] },
      { id: 'player_1', name: 'Bot', type: 'ai', cards: [] },
    ],
    gameMode: 'free_for_all',
    gameOver: true,
  };
  const match = {
    over: true,
    isDraw: false,
    length: 'single',
    target: 21,
    winners: ['player_0'],
    scores: { player_0: 3, player_1: 0 },
    hands: [{ rankings: ['player_0', 'player_1'], pointsAwarded: { player_0: 3 } }],
  };
  return {
    useLocalTable: () => ({ gameState }),
    useLocalMatch: () => ({ match, startNextHand: jest.fn(), startNewMatch: mockStartNewMatch }),
    useLocalSession: () => ({ resetGame: jest.fn() }),
  };
});

const ResultScreen = (require('@/app/result') as { default: React.ComponentType }).default;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

it('offers Nuova partita after a finished partita, and it starts one', async () => {
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ResultScreen />
    </SafeAreaProvider>
  );

  await fireEvent.press(view.getByTestId('btn-nuova-partita'));

  expect(mockStartNewMatch).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith('/game');
  await view.unmount();
});
