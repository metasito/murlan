// tests/native/selectionIntegrity.test.tsx — what the table sends, and what it
// keeps selected, can only ever be cards the hand actually holds.
//
// The server takes the strict view of a `game:play`: if any named id is missing
// from the hand it returns without emitting anything at all, so a request built
// from a stale selection is a lit GIOCA that does nothing and never explains
// itself. Card ids are deterministic (`${rank}_${suit}`), so a leftover id also
// matches a card in the next manche and renders it pre-selected.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
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
import type { Card, GameState, Player, Rank, Suit } from '@/lib/gameEngine';

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

/** Both sevens are in the hand; the king is the id the server already consumed. */
const HAND = [card('7', 'hearts'), card('7', 'clubs'), card('9', 'spades')];
const CONSUMED = card('K', 'diamonds');

const seat = (id: string, name: string, hand: Card[]): Player => ({
  id,
  name,
  hand,
  type: 'human',
});

const gameState: GameState = {
  players: [seat('player_0', 'Ana', HAND), seat('player_1', 'Besi', [])],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};

const noop = () => {};

const table = (selectedIds: string[], handlers: {
  onPlay?: (ids: string[]) => void;
  onSelectCard?: (id: string) => void;
}) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      selectedIds={selectedIds}
      onSelectCard={handlers.onSelectCard ?? noop}
      onPlay={handlers.onPlay ?? noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      roundLabel="Partita"
    />
  </SafeAreaProvider>
);

describe('a selection that has gone stale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is never sent: GIOCA emits only ids the hand still holds', async () => {
    const onPlay = jest.fn<(ids: string[]) => void>();
    const r = await render(table(['7_hearts', CONSUMED.id, '7_clubs'], { onPlay }));

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });

    expect(onPlay).toHaveBeenCalledTimes(1);
    const sent = onPlay.mock.calls[0][0];
    expect([...sent].sort()).toEqual(['7_clubs', '7_hearts']);
    expect(sent).not.toContain(CONSUMED.id);

    await r.unmount();
  });

  it('is dropped from the selection, and only the stale part of it', async () => {
    const onSelectCard = jest.fn<(id: string) => void>();
    const r = await render(table(['7_hearts', CONSUMED.id], { onSelectCard }));

    // onSelectCard toggles, so being called with the consumed id removes it.
    expect(onSelectCard.mock.calls.map(([id]) => id)).toEqual([CONSUMED.id]);

    await r.unmount();
  });

  it('leaves a selection the hand still holds alone', async () => {
    const onSelectCard = jest.fn<(id: string) => void>();
    const r = await render(table(['7_hearts', '7_clubs'], { onSelectCard }));

    expect(onSelectCard).not.toHaveBeenCalled();

    await r.unmount();
  });
});
