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

import { GameTable } from '@/components/GameTable';
import { handLabel } from '@/components/table/spokenLabels';
import { cardSpokenName } from '@/lib/cardNames';
import { t, tn } from '@/lib/i18n';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/game/gameEngine';

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

const SEVEN_H = card('7', 'hearts');
const SEVEN_C = card('7', 'clubs');
const NINE = card('9', 'spades');
/** The card the server moves for the viewer while it is staged. */
const CONSUMED = card('K', 'diamonds');
const HAND = [SEVEN_H, SEVEN_C, NINE, CONSUMED];

const seat = (id: string, name: string, hand: Card[]): Player => ({
  id,
  name,
  hand,
  type: 'human',
});

const stateWith = (hand: Card[]): GameState => ({
  players: [seat('player_0', 'Ana', hand), seat('player_1', 'Besi', [])],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

const noop = () => {};

const table = (hand: Card[], onPlay: (ids: string[]) => void = noop) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={stateWith(hand)}
      viewerSeat={0}
      onPlay={onPlay}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const tap = async (c: Card) => {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(cardSpokenName(c, t)));
  });
};
const selected = (c: Card) =>
  screen.getByLabelText(cardSpokenName(c, t)).props.accessibilityState?.selected === true;

describe('a staged card leaving the hand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is never sent: GIOCA emits only ids the hand still holds', async () => {
    const onPlay = jest.fn<(ids: string[]) => void>();
    const r = await render(table(HAND, onPlay));
    await tap(SEVEN_H);
    await tap(CONSUMED);
    await tap(SEVEN_C);
    await act(async () => r.rerender(table([SEVEN_H, SEVEN_C, NINE], onPlay)));

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect([...onPlay.mock.calls[0][0]].sort()).toEqual([SEVEN_C.id, SEVEN_H.id]);

    await r.unmount();
  });

  it('leaves the selection, and only it does', async () => {
    const r = await render(table(HAND));
    await tap(SEVEN_H);
    await tap(CONSUMED);
    await act(async () => r.rerender(table([SEVEN_H, SEVEN_C, NINE])));

    expect(selected(SEVEN_H)).toBe(true);
    expect(screen.getByLabelText(handLabel(3, 1, tn))).toBeTruthy();

    await r.unmount();
  });

  it('is a different case from a card arriving, which clears the whole selection', async () => {
    const r = await render(table([SEVEN_H, SEVEN_C, NINE]));
    await tap(SEVEN_H);
    await act(async () => r.rerender(table(HAND)));

    expect(selected(SEVEN_H)).toBe(false);

    await r.unmount();
  });
});
