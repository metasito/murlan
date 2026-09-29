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
import type { GameState } from '@/lib/game/gameEngine';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const mockRunAITurn = jest.fn();
const mockChoose = jest.fn();
const mockTable: { props: { onExchangeReady?: () => void } } = { props: {} };

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

/** A bot won the last hand and owes the human a card back. */
const CHOOSING: GameState = {
  ...STATE,
  players: [
    { id: 'player_0', name: 'Ana', hand: [{ id: '4_clubs', suit: 'clubs', rank: '4', isJoker: false }], type: 'human' },
    { id: 'player_1', name: 'Luan', hand: [{ id: '6_clubs', suit: 'clubs', rank: '6', isJoker: false }], type: 'ai' },
  ],
  exchangePhase: { active: true, winnerIdx: 1, loserIdx: 0, cardFromLoser: { id: '2_clubs', suit: 'clubs', rank: '2', isJoker: false }, bothJokersException: false },
};

/** Flipped between renders: prefixed so jest.mock may close over it. */
const mockCeremony = { announcing: false, state: STATE };

jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: mockCeremony.state,
    chooseExchangeCard: mockChoose,
    releaseStuckExchange: () => {},
    selectedCards: [],
    selectCard: () => {},
    playSelected: () => {},
    passTurn: () => {},
    resetGame: () => {},
    runAITurn: mockRunAITurn,
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
  return {
    GameTable: (props: { onExchangeReady?: () => void }) => {
      mockTable.props = props;
      return react.createElement(rn.View, { testID: 'table' });
    },
  };
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

  it('a bot winner gives when the table opens the choice, not on a clock of its own', async () => {
    mockCeremony.state = CHOOSING;
    const view = await render(<GameScreen />);
    await act(async () => {
      jest.advanceTimersByTime(PAST_THE_THINK * 4);
    });
    expect(mockChoose).not.toHaveBeenCalled();
    await act(async () => mockTable.props.onExchangeReady?.());
    expect(mockChoose).toHaveBeenCalledWith('6_clubs');
    await view.unmount();
    mockCeremony.state = STATE;
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
