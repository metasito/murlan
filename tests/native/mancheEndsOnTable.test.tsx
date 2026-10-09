// tests/native/mancheEndsOnTable.test.tsx — offline, a manche ends on the table and the next one
// is dealt from the landing that ended it; only a partita still leaves for /result.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { GameState } from '@/lib/game/gameEngine';
import { MancheEnding } from '@/lib/tokens';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const mockStartNextHand = jest.fn();
const mockTable: { props: { onMancheLanded?: (landsAt: number) => void } } = { props: {} };
const mockMatch = { over: false };

const OVER: GameState = {
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human' },
    { id: 'player_1', name: 'Luan', hand: [], type: 'ai' },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings: ['player_0', 'player_1'],
  firstPlayMade: true,
};

jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: OVER,
    chooseExchangeCard: () => {},
    releaseStuckExchange: () => {},
    playCards: () => {},
    passTurn: () => {},
    resetGame: () => {},
    runAITurn: () => {},
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    acknowledgeExchange: () => {},
    rematchPromptOpen: false,
    rematchAnswers: {},
    rematchTally: { yes: 0, total: 0 },
    answerRematch: () => {},
    startNextHand: mockStartNextHand,
    match: { length: 'match', target: 21, over: mockMatch.over, scores: {}, hands: [] },
  }),
}));

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: jest.fn() }),
}));

jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: { onMancheLanded?: (landsAt: number) => void }) => {
      mockTable.props = props;
      return react.createElement(rn.View, { testID: 'table' });
    },
  };
});

import GameScreen from '@/app/game';

const LONG_AFTER = 10_000;

describe('the end of a manche, offline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockMatch.over = false;
    mockTable.props = {};
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('deals the next manche once, at the ending landing plus the deal onset, and never routes to /result', async () => {
    const view = await render(<GameScreen />);
    await act(async () => {
      jest.advanceTimersByTime(LONG_AFTER);
    });
    expect(router.replace).not.toHaveBeenCalledWith('/result');
    expect(mockStartNextHand).not.toHaveBeenCalled();

    await act(async () => mockTable.props.onMancheLanded?.(performance.now()));
    await act(async () => {
      jest.advanceTimersByTime(MancheEnding.deal - 1);
    });
    expect(mockStartNextHand).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockStartNextHand).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(LONG_AFTER);
    });
    expect(mockStartNextHand).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalledWith('/result');
    await view.unmount();
  });

  it('a landing reported late still deals at its own onset', async () => {
    const view = await render(<GameScreen />);
    const landedAt = performance.now();
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    await act(async () => mockTable.props.onMancheLanded?.(landedAt));
    await act(async () => {
      jest.advanceTimersByTime(MancheEnding.deal - 1_000);
    });
    expect(mockStartNextHand).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('leaving before the deal cancels it', async () => {
    const view = await render(<GameScreen />);
    await act(async () => mockTable.props.onMancheLanded?.(performance.now()));
    await view.unmount();
    jest.advanceTimersByTime(LONG_AFTER);
    expect(mockStartNextHand).not.toHaveBeenCalled();
  });

  it('a partita still ends on /result, and the table is not asked to deal', async () => {
    mockMatch.over = true;
    const view = await render(<GameScreen />);
    expect(mockTable.props.onMancheLanded).toBeUndefined();
    await act(async () => {
      jest.advanceTimersByTime(LONG_AFTER);
    });
    expect(router.replace).toHaveBeenCalledWith('/result');
    expect(mockStartNextHand).not.toHaveBeenCalled();
    await view.unmount();
  });
});
