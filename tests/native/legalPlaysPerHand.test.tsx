// tests/native/legalPlaysPerHand.test.tsx — whether the hand can beat the pile is
// worked out once per hand, pile and turn; a tap on a card does not ask again.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import * as engine from '@/lib/game/gameEngine';
import type { Card, Combination, GameState, Player, Rank, Suit } from '@/lib/game/gameEngine';

jest.mock('@/lib/game/gameEngine', () => {
  const actual = jest.requireActual<typeof import('@/lib/game/gameEngine')>('@/lib/game/gameEngine');
  return { ...actual, getAllValidPlays: jest.fn(actual.getAllValidPlays) };
});

const legalPlays = engine.getAllValidPlays as jest.MockedFunction<typeof engine.getAllValidPlays>;

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });

const SEVEN_H = card('7', 'hearts');
const SEVEN_C = card('7', 'clubs');
const THREE_S = card('3', 'spades');
const HAND = [THREE_S, SEVEN_H, SEVEN_C];
const PILE = engine.buildCombination([card('5', 'diamonds')]) as Combination;
const JACKS = engine.buildCombination([card('J', 'spades'), card('J', 'hearts')]) as Combination;

const seat = (id: string, name: string): Player => ({ id, name, hand: HAND, type: 'human' });

const state = (over: Partial<GameState> = {}): GameState => ({
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
    />
  </SafeAreaProvider>
);

const onPile = (over: Partial<GameState> = {}) => state({ lastPlayedCombination: PILE, lastPlayedBy: 1, ...over });

const passaBorder = () => StyleSheet.flatten(screen.getByTestId('btn-passa').props.style).borderWidth;

describe('the legal plays of a hand', () => {
  beforeEach(() => {
    legalPlays.mockClear();
  });

  it('are not counted again when a card is selected', async () => {
    const game = onPile();
    const r = await render(table(game, []));
    expect(legalPlays).toHaveBeenCalled();
    legalPlays.mockClear();

    await r.rerender(table(game, [SEVEN_H.id]));
    await r.rerender(table(game, [SEVEN_H.id, SEVEN_C.id]));

    expect(screen.getByTestId('btn-gioca')).toBeTruthy();
    expect(legalPlays).not.toHaveBeenCalled();
    await r.unmount();
  });

  it('are not counted at all for a lead, where PASSA is not offered', async () => {
    const r = await render(table(state(), [SEVEN_H.id]));

    expect(screen.getByTestId('btn-passa')).toBeTruthy();
    expect(legalPlays).not.toHaveBeenCalled();
    await r.unmount();
  });

  it('are counted again when the pile changes', async () => {
    const r = await render(table(onPile(), []));
    legalPlays.mockClear();

    await r.rerender(table(onPile({ lastPlayedCombination: JACKS }), []));

    expect(legalPlays).toHaveBeenCalled();
    await r.unmount();
  });

  it('still mark PASSA as the only move when nothing beats the pile', async () => {
    const r = await render(table(onPile(), []));
    expect(passaBorder()).toBeUndefined();

    await r.rerender(table(onPile({ lastPlayedCombination: JACKS }), []));

    expect(passaBorder()).toBe(2);
    await r.unmount();
  });

  it('follow the start card and whether the opening play is made', async () => {
    const r = await render(table(onPile({ firstPlayMade: false, startCard: SEVEN_H }), []));
    expect(passaBorder()).toBeUndefined();

    await r.rerender(table(onPile({ firstPlayMade: false, startCard: THREE_S }), []));
    expect(passaBorder()).toBe(2);

    await r.rerender(table(onPile({ firstPlayMade: true, startCard: THREE_S }), []));
    expect(passaBorder()).toBeUndefined();
    await r.unmount();
  });
});
