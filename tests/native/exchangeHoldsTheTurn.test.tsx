// tests/native/exchangeHoldsTheTurn.test.tsx — the table waits for the trade.
//
// The exchange closes its own phase the moment the card is chosen, so
// `exchangePhase.active` is already false while the two cards are still
// crossing the felt. A turn loop reading only that flag starts a bot's
// "thinking" timer over the top of the ceremony every seat is watching.
//
// What is under test is the gate, not the clock: `runAITurn` is the context's,
// and whether the screen ever calls it is the whole question.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { GameState } from '@/lib/gameEngine';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/lib/sounds', () => ({
  playCardPass: jest.fn(async () => {}),
  ensureAudioMode: jest.fn(async () => {}),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

const mockRunAITurn = jest.fn();

/** The bot is on move and the exchange has just resolved. */
const STATE: GameState = {
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human' },
    { id: 'player_1', name: 'Luan', hand: [], type: 'ai' },
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};

/** Flipped between renders: prefixed so jest.mock may close over it. */
const mockCeremony = { announcing: false };

jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: STATE,
    selectedCards: [],
    selectCard: () => {},
    playSelected: () => {},
    passTurn: () => {},
    resetGame: () => {},
    runAITurn: mockRunAITurn,
    chooseExchangeCard: () => {},
    exchangeAnnouncing: mockCeremony.announcing,
    exchangeAnnounceData: null,
    acknowledgeExchange: () => {},
    rematchPromptOpen: false,
    rematchAnswers: {},
    rematchTally: { yes: 0, total: 0 },
    answerRematch: () => {},
    match: { length: 'single', target: 21 },
  }),
}));

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: jest.fn() }),
}));

// The table draws nothing here: every path under test is the screen's own
// effect, and a real table would bring the whole felt with it.
jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return { GameTable: () => react.createElement(rn.View, { testID: 'table' }) };
});

import GameScreen from '@/app/game';

/** Comfortably past AI_DELAY, whatever it is set to (app/game.tsx). */
const PAST_THE_THINK = 5_000;

describe('a bot on move while the exchange is being announced', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not play until the ceremony is over', async () => {
    mockCeremony.announcing = true;
    const view = await render(<GameScreen />);

    await act(async () => {
      jest.advanceTimersByTime(PAST_THE_THINK);
    });
    // A call here is a card thrown over the ceremony every seat is watching.
    expect(mockRunAITurn).not.toHaveBeenCalled();

    mockCeremony.announcing = false;
    await act(async () => {
      view.rerender(<GameScreen />);
    });
    await act(async () => {
      jest.advanceTimersByTime(PAST_THE_THINK);
    });
    // …and no call here is a table that never takes its turn back.
    expect(mockRunAITurn).toHaveBeenCalled();

    await view.unmount();
  });
});
