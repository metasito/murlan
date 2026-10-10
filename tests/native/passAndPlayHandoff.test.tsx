// tests/native/passAndPlayHandoff.test.tsx — pass and play hands the table to
// whichever human seat is on move (#1070).
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { activate } from './tapHelpers';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState } from '@/lib/game/gameEngine';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const card = (id: string, rank: Card['rank']): Card => ({ id, rank, suit: 'spades', isJoker: false });
const SEAT0_LEAD = card('s0-7', '7');
const SEAT0_REST = card('s0-4', '4');
const SEAT1_CARD = card('s1-9', '9');

/** Two humans at one device; seat 0 leads a fresh round. */
const mockTable: { state: GameState; rematchOpen: boolean } = {
  rematchOpen: false,
  state: {
    players: [
      { id: 'player_0', name: 'Ana', hand: [SEAT0_LEAD, SEAT0_REST], type: 'human' },
      { id: 'player_1', name: 'Besi', hand: [SEAT1_CARD, card('s1-5', '5')], type: 'human' },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: 'free_for_all',
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
  },
};

const mockPlayCards = jest.fn((_ids: string[]) => {
  const s = mockTable.state;
  mockTable.state = {
    ...s,
    players: [{ ...s.players[0], hand: [s.players[0].hand[1]] }, s.players[1]],
    currentTurnIndex: 1,
    lastPlayedCombination: { type: 'single', cards: [SEAT0_LEAD], strength: 7 },
    lastPlayedBy: 0,
  };
});

const mockAnswerRematch = jest.fn();

jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: mockTable.state,
    playCards: mockPlayCards,
    passTurn: () => {},
    resetGame: () => {},
    runAITurn: () => {},
    chooseExchangeCard: () => {},
    releaseStuckExchange: () => {},
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    acknowledgeExchange: () => {},
    rematchPromptOpen: mockTable.rematchOpen,
    rematchAnswers: {},
    rematchTally: { yes: 0, total: 0 },
    answerRematch: mockAnswerRematch,
    match: { length: 'single', target: 21 },
  }),
}));

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: jest.fn() }),
}));

import GameScreen, { HUMAN_TURN_SECONDS } from '@/app/game';
import { cardSpokenName } from '@/lib/cardNames';
import { t, tn } from '@/lib/i18n';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const screenTree = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameScreen />
  </SafeAreaProvider>
);

const cardShown = (c: Card) => screen.queryByLabelText(cardSpokenName(c, t)) !== null;
const pill = () =>
  within(screen.getByTestId('game-hud-stack')).getByText(/'s turn$/, { includeHiddenElements: true }).props.children;

describe('pass and play', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives seat 1 its own hand and an enabled pass at once, and its clock once the pill turns to it', async () => {
    jest.useFakeTimers();
    const view = await render(screenTree());
    expect(cardShown(SEAT0_REST)).toBe(true);
    expect(cardShown(SEAT1_CARD)).toBe(false);

    await act(async () => {
      await activate(screen.getByLabelText(cardSpokenName(SEAT0_LEAD, t)));
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('btn-gioca'));
    });
    expect(mockPlayCards).toHaveBeenCalledWith([SEAT0_LEAD.id]);
    await act(async () => {
      view.rerender(screenTree());
    });

    expect(cardShown(SEAT1_CARD)).toBe(true);
    expect(cardShown(SEAT0_REST)).toBe(false);
    expect(screen.getByTestId('btn-passa').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false })
    );
    expect(pill()).toBe("Ana's turn");
    await act(async () => {
      jest.advanceTimersByTime(2100);
    });
    expect(
      screen.getByLabelText(`${t('gameTable.a11yYourTurn')} ${tn('gameTable.a11ySecondsLeft', HUMAN_TURN_SECONDS - 2)}`)
    ).toBeTruthy();

    await view.unmount();
  });

  it('records a rematch tap under the seat on move', async () => {
    mockTable.state = { ...mockTable.state, currentTurnIndex: 1 };
    mockTable.rematchOpen = true;
    const view = await render(screenTree());

    await act(async () => {
      await fireEvent.press(screen.getByTestId('btn-rematch-yes'));
    });
    expect(mockAnswerRematch).toHaveBeenCalledWith('player_1', true);

    await view.unmount();
  });
});
