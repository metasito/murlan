// tests/native/stagedSelection.test.tsx — a play can be staged while somebody
// else is thinking.
//
// With three opponents the viewer spends three-odd seconds a round holding a
// hand they were not allowed to touch, and then starts the turn clock from a blank
// selection. Selection is now open at all times; only the submission is gated
// on the turn, which `playBtnValid` already does.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bootFeedback, haptics, sounds } from './helpers/feedback';
import { GameTable } from '@/components/GameTable';
import { cardSpokenName } from '@/lib/cardNames';
import { t, type TranslationKey } from '@/lib/i18n';
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
const HAND = [SEVEN_H, SEVEN_C, card('9', 'spades')];
const BOT_HAND = [card('4', 'clubs'), card('5', 'clubs')];

const seat = (id: string, name: string, hand: Card[]): Player => ({
  id,
  name,
  hand,
  type: 'human',
});

const state = (currentTurnIndex: number, over: Partial<GameState> = {}): GameState => ({
  players: [seat('player_0', 'Ana', HAND), seat('player_1', 'Besi', BOT_HAND)],
  currentTurnIndex,
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

const table = (opts: {
  gameState: GameState;
  spectating?: boolean;
  onPlay?: (ids: string[]) => void;
}) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={opts.gameState}
      viewerSeat={0}
      spectating={opts.spectating}
      onPlay={opts.onPlay ?? noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const pressCard = async (c: Card) => {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(cardSpokenName(c, t)));
  });
};
const selected = (c: Card) =>
  screen.getByLabelText(cardSpokenName(c, t)).props.accessibilityState?.selected === true;

const gioca = () => screen.getByTestId('btn-gioca').props;
/** GIOCA is pressable whatever it says, so its name is where availability lives. */
const giocaSays = () => gioca().accessibilityLabel;
const unavailable = (reason: TranslationKey) =>
  t('gameTable.playA11yUnavailable', { reason: t(reason) });

describe('selecting a card out of turn', () => {
  const count = (id: string) => sounds().filter((s) => s === id).length;

  beforeEach(async () => {
    jest.clearAllMocks();
    await bootFeedback();
  });

  it('is accepted, with the usual haptic and select sound', async () => {
    // Seat 1 is on move; the viewer sits at seat 0.
    const r = await render(table({ gameState: state(1) }));

    await pressCard(SEVEN_H);

    expect(selected(SEVEN_H)).toBe(true);
    expect(count('select')).toBe(1);
    expect(count('deselect')).toBe(0);
    expect(haptics().filter((h) => h === 'selection')).toHaveLength(1);

    await r.unmount();
  });

  it('sounds a deselect apart from a select', async () => {
    const r = await render(table({ gameState: state(1) }));
    await pressCard(SEVEN_H);

    await pressCard(SEVEN_H);

    expect(selected(SEVEN_H)).toBe(false);
    expect(count('deselect')).toBe(1);
    expect(count('select')).toBe(1);

    await r.unmount();
  });

  it('leaves GIOCA dim until the turn arrives, then lights it without a re-tap', async () => {
    const onPlay = jest.fn<(ids: string[]) => void>();
    const r = await render(table({ gameState: state(1), onPlay }));
    await pressCard(SEVEN_H);
    await pressCard(SEVEN_C);
    expect(giocaSays()).toBe(unavailable('gameTable.playA11ySpokenNotYourTurn'));
    expect(gioca().accessibilityState?.disabled).toBeUndefined();

    await act(async () => r.rerender(table({ gameState: state(0), onPlay })));
    expect(giocaSays()).toBe(t('gameTable.playA11yValid'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect([...onPlay.mock.calls[0][0]].sort()).toEqual([SEVEN_C.id, SEVEN_H.id]);

    await r.unmount();
  });

  it('stays shut for a spectator, whose seat is on move', async () => {
    // Opening selection outside the turn must not open it to a watcher. A
    // spectator is sent no cards at all, so the row is face down: no press
    // target, and neither play control is rendered.
    const r = await render(table({ gameState: state(0), spectating: true }));

    expect(screen.queryByLabelText(cardSpokenName(SEVEN_H, t))).toBeNull();
    expect(screen.queryByTestId('btn-gioca')).toBeNull();
    expect(screen.queryByTestId('btn-passa')).toBeNull();
    expect(count('select')).toBe(0);

    await r.unmount();
  });
});

describe('another seat taking its turn', () => {
  it('leaves the staged selection alone', async () => {
    const r = await render(table({ gameState: state(1) }));
    await pressCard(SEVEN_H);

    const played = state(0, {
      players: [seat('player_0', 'Ana', HAND), seat('player_1', 'Besi', [BOT_HAND[1]])],
      lastPlayedCombination: { type: 'single', cards: [BOT_HAND[0]], strength: 2 },
      lastPlayedBy: 1,
    });
    await act(async () => r.rerender(table({ gameState: played })));

    expect(selected(SEVEN_H)).toBe(true);

    await r.unmount();
  });
});
