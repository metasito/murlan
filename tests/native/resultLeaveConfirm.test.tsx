// tests/native/resultLeaveConfirm.test.tsx — going home between hands discards
// a running match, so it asks first. What the screen renders is the whole
// claim: a source scan cannot tell a wired dialog from a defined one.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { en as locale } from '@/locales/en';

const mockReplace = jest.fn();
const mockResetGame = jest.fn();

let mockMatch: Record<string, unknown>;

jest.mock('expo-router', () => ({
  router: { replace: mockReplace, push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/lib/haptics', () => ({
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

jest.mock('@/lib/sounds', () => ({ holdSounds: () => () => {} }));

const PLAYERS = [
  { id: 'player_0', name: 'Ana', type: 'human', cards: [] },
  { id: 'player_1', name: 'Bot', type: 'ai', cards: [] },
];

jest.mock('@/context/gameHooks', () => ({
  useLocalTable: () => ({
    gameState: { players: PLAYERS, gameMode: 'free_for_all', gameOver: true },
  }),
  useLocalMatch: () => ({
    match: mockMatch,
    tableWantsRematch: true,
    startNextHand: jest.fn(),
    startNewMatch: jest.fn(),
  }),
  useLocalSession: () => ({ resetGame: mockResetGame }),
}));

const ResultScreen = (require('@/app/result') as { default: React.ComponentType }).default;

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function matchThat(over: boolean) {
  return {
    over,
    isDraw: false,
    length: 'match',
    target: 21,
    winners: over ? ["player_0"] : [],
    scores: { player_0: 1, player_1: 0 },
    hands: [{ rankings: ['player_0', 'player_1'], pointsAwarded: { player_0: 1 } }],
  };
}

const renderResult = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ResultScreen />
    </SafeAreaProvider>
  );

describe('leaving from the between-hands screen', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockResetGame.mockClear();
  });

  it('asks before discarding a match still being played', async () => {
    mockMatch = matchThat(false);
    const view = await renderResult();

    await fireEvent.press(view.getByTestId('btn-home'));
    expect(mockResetGame).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    expect(view.getByText(locale['result.leaveConfirmTitle'])).toBeTruthy();
    await fireEvent.press(view.getByTestId('confirm-accept'));
    expect(mockResetGame).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');

    await view.unmount();
  });

  it('keeps the match when the question is declined', async () => {
    mockMatch = matchThat(false);
    const view = await renderResult();

    await fireEvent.press(view.getByTestId('btn-home'));
    await fireEvent.press(view.getByTestId('confirm-cancel'));
    expect(mockResetGame).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    await view.unmount();
  });

  it('asks nothing once the match is over — there is nothing left to discard', async () => {
    mockMatch = matchThat(true);
    const view = await renderResult();

    await fireEvent.press(view.getByTestId('btn-home'));
    expect(view.queryByText(locale['result.leaveConfirmTitle'])).toBeNull();
    expect(mockResetGame).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');

    await view.unmount();
  });
});
