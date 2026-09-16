// tests/native/passAndPlayHandoff.test.tsx — pass and play hands the table to
// whichever human seat is on move (#1070).
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState } from '@/lib/gameEngine';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/lib/sounds', () => ({
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playYourTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playUrgentTick: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playGameWin: jest.fn(async () => {}),
  playGameLose: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  unloadSounds: jest.fn(() => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
  ensureAudioMode: jest.fn(async () => {}),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

const card = (id: string, rank: Card['rank']): Card => ({ id, rank, suit: 'spades', isJoker: false });
const SEAT0_LEAD = card('s0-7', '7');
const SEAT0_REST = card('s0-4', '4');
const SEAT1_CARD = card('s1-9', '9');

/** Two humans at one device; seat 0 leads a fresh round. */
const mockTable: { state: GameState } = {
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

const mockPlaySelected = jest.fn(() => {
  const s = mockTable.state;
  mockTable.state = {
    ...s,
    players: [{ ...s.players[0], hand: [s.players[0].hand[1]] }, s.players[1]],
    currentTurnIndex: 1,
    lastPlayedCombination: { type: 'single', cards: [SEAT0_LEAD], strength: 7 },
    lastPlayedBy: 0,
  };
});

jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: mockTable.state,
    selectedCards: mockTable.state.currentTurnIndex === 0 ? ['s0-7'] : [],
    selectCard: () => {},
    playSelected: mockPlaySelected,
    passTurn: () => {},
    resetGame: () => {},
    runAITurn: () => {},
    chooseExchangeCard: () => {},
    releaseStuckExchange: () => {},
    exchangeAnnouncing: false,
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

import GameScreen from '@/app/game';
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

describe('pass and play', () => {
  it('gives seat 1 its own hand, an enabled pass and a running clock once the turn reaches it', async () => {
    const view = await render(screenTree());
    expect(cardShown(SEAT0_REST)).toBe(true);
    expect(cardShown(SEAT1_CARD)).toBe(false);

    await act(async () => {
      await fireEvent.press(screen.getByTestId('btn-gioca'));
    });
    expect(mockPlaySelected).toHaveBeenCalledTimes(1);
    await act(async () => {
      view.rerender(screenTree());
    });

    expect(cardShown(SEAT1_CARD)).toBe(true);
    expect(cardShown(SEAT0_REST)).toBe(false);
    expect(screen.getByTestId('btn-passa').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false })
    );
    expect(
      screen.getByLabelText(`${t('gameTable.a11yYourTurn')} ${tn('gameTable.a11ySecondsLeft', 20)}`)
    ).toBeTruthy();

    await view.unmount();
  });
});
