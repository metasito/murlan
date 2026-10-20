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
const mockTable: { state: GameState; announcing: boolean } = {
  announcing: false,
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
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
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

jest.mock('@/context/GameContext', () =>
  (require('./helpers/localContextMock') as typeof import('./helpers/localContextMock')).localContextMock(() => ({
    gameState: mockTable.state,
    playCards: mockPlayCards,
    exchangeAnnouncing: mockTable.announcing,
    exchangeAnnounceData: null,
    match: { length: 'single', target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
  }))
);

jest.mock('@/context/NotificationContext', () =>
  (require('./helpers/notificationMock') as typeof import('./helpers/notificationMock')).notificationContextMock()
);

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

  it('keeps the table on the exchange winner while the exchange is announced, then hands it to the loser on move', async () => {
    const winnerCard = card('s0-8', '8');
    const loserCard = card('s1-6', '6');
    mockTable.state = {
      players: [
        { id: 'player_0', name: 'Ana', hand: [winnerCard], type: 'human' },
        { id: 'player_1', name: 'Besi', hand: [loserCard, card('s1-k', 'K')], type: 'human' },
      ],
      currentTurnIndex: 1,
      lastPlayedCombination: null,
      lastPlayedBy: 1,
      passCount: 0,
      gameMode: 'free_for_all',
      trickWinner: null,
      roundOver: false,
      finishingOrder: [],
      firstPlayMade: true,
      exchangePhase: {
        active: false,
        winnerIdx: 0,
        loserIdx: 1,
        cardFromLoser: card('s1-a', 'A'),
        cardToLoser: card('s1-k', 'K'),
        twoJokerException: false,
      },
    };
    mockTable.announcing = true;
    const view = await render(screenTree());
    expect(cardShown(winnerCard)).toBe(true);
    expect(cardShown(loserCard)).toBe(false);

    mockTable.announcing = false;
    await act(async () => {
      view.rerender(screenTree());
    });
    expect(cardShown(loserCard)).toBe(true);
    expect(cardShown(winnerCard)).toBe(false);

    await view.unmount();
  });
});
