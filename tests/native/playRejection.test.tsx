// tests/native/playRejection.test.tsx — the GIOCA button says why it refused.
//
// Every rejection with a built combination used to read "TROPPO BASSA",
// including a pair offered against a single and the opening play without the
// 3♠ — the two cases where "too low" teaches the wrong rule.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import { GameTable } from '@/components/GameTable';
import { t } from '@/lib/i18n';
import type { Card, Combination, GameState, Player, Rank, Suit } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const card = (rank: Rank, suit: Suit): Card => ({
  id: `${rank}_${suit}`,
  rank,
  suit,
  isJoker: false,
});

const THREE_S = card('3', 'spades');
const SEVEN_H = card('7', 'hearts');
const SEVEN_C = card('7', 'clubs');
const HAND = [THREE_S, SEVEN_H, SEVEN_C];

const single = (c: Card): Combination => ({ type: 'single', cards: [c], strength: 9 });

const seat = (id: string, name: string): Player => ({ id, name, hand: HAND, type: 'human' });

const state = (over: Partial<GameState>): GameState => ({
  players: [seat('player_0', 'Ana'), seat('player_1', 'Besi')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
  ...over,
});

const noop = () => {};

const table = (gameState: GameState, selectedIds: string[]) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      selectedIds={selectedIds}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      roundLabel="Partita"
    />
  </SafeAreaProvider>
);

describe('the dim GIOCA label', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls a pair against a single the wrong type, not too low', async () => {
    const r = await render(
      table(
        state({ lastPlayedCombination: single(card('9', 'diamonds')), lastPlayedBy: 1 }),
        [SEVEN_H.id, SEVEN_C.id]
      )
    );

    expect(screen.getByText(t('gameTable.playLabelWrongType'))).toBeTruthy();
    expect(screen.queryByText(t('gameTable.playLabelTooLow'))).toBeNull();
    expect(screen.getByTestId('btn-gioca').props.accessibilityLabel).toContain(
      t('gameTable.playA11ySpokenWrongType')
    );

    await r.unmount();
  });

  it('tells the opening play it needs the start card, and names it', async () => {
    const r = await render(
      table(state({ firstPlayMade: false, startCard: THREE_S }), [SEVEN_H.id, SEVEN_C.id])
    );

    expect(
      screen.getByText(t('gameTable.playLabelStartCard', { rank: THREE_S.rank }))
    ).toBeTruthy();
    expect(screen.queryByText(t('gameTable.playLabelTooLow'))).toBeNull();

    await r.unmount();
  });

  it('still says too low when the selection really is too low', async () => {
    const r = await render(
      table(
        state({ lastPlayedCombination: single(card('9', 'diamonds')), lastPlayedBy: 1 }),
        [SEVEN_H.id]
      )
    );

    expect(screen.getByText(t('gameTable.playLabelTooLow'))).toBeTruthy();

    await r.unmount();
  });
});
