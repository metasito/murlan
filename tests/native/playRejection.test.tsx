// tests/native/playRejection.test.tsx — the GIOCA button says why it refused.
//
// Every rejection with a built combination used to read "TROPPO BASSA",
// including a pair offered against a single and the opening play without the
// 3♠ — the two cases where "too low" teaches the wrong rule.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bootFeedback, haptics, sounds } from './helpers/feedback';
import { GameTable } from '@/components/GameTable';
import { t } from '@/lib/i18n';
import { cardSpokenName } from '@/lib/cardNames';
import {
  type Card,
  type Combination,
  type GameState,
  type Player,
  type Rank,
  type Suit,
} from '@/lib/game/gameEngine';

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

const table = (gameState: GameState, onPlay: (ids: string[]) => void = noop) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      onPlay={onPlay}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const mount = async (gameState: GameState, picked: Card[], onPlay?: (ids: string[]) => void) => {
  const r = await render(table(gameState, onPlay));
  for (const c of picked) {
    await act(async () => {
      fireEvent.press(screen.getByLabelText(cardSpokenName(c, t)));
    });
  }
  return r;
};

// The refusal reason is no longer the button's own label — a 56pt square
// cannot hold a sentence, so GIOCA says GIOCA and the reason reaches the player
// through the accessibility label and, on the press it refuses, through the
// hint beside the button (#199). Which reason is chosen is still the thing
// worth pinning, and this is where it is now readable.
describe('the refused GIOCA names the right reason', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const reasonOf = () => screen.getByTestId('btn-gioca').props.accessibilityLabel as string;

  it('calls a pair against a single the wrong type, not too low', async () => {
    const r = await mount(
      state({ lastPlayedCombination: single(card('9', 'diamonds')), lastPlayedBy: 1 }),
      [SEVEN_H, SEVEN_C]
    );

    expect(reasonOf()).toContain(t('gameTable.playA11ySpokenWrongType'));
    expect(reasonOf()).not.toContain(t('gameTable.playA11ySpokenTooLow'));

    await r.unmount();
  });

  it('tells the opening play it needs the start card, and names it', async () => {
    const r = await mount(state({ firstPlayMade: false, startCard: THREE_S }), [SEVEN_H, SEVEN_C]);

    expect(reasonOf()).toContain(
      t('gameTable.playA11ySpokenStartCard', { card: cardSpokenName(THREE_S, t) })
    );
    expect(reasonOf()).not.toContain(t('gameTable.playA11ySpokenTooLow'));

    await r.unmount();
  });

  it('names the actual 2-player fallback card, not the 3♠, when it opens instead', async () => {
    const FIVE_H = card('5', 'hearts');
    const r = await mount(state({ firstPlayMade: false, startCard: FIVE_H }), [SEVEN_H, SEVEN_C]);

    expect(reasonOf()).toContain(
      t('gameTable.playA11ySpokenStartCard', { card: cardSpokenName(FIVE_H, t) })
    );
    expect(reasonOf()).not.toContain('♠');

    await r.unmount();
  });

  it('still says too low when the selection really is too low', async () => {
    const r = await mount(
      state({ lastPlayedCombination: single(card('9', 'diamonds')), lastPlayedBy: 1 }),
      [SEVEN_H]
    );

    expect(reasonOf()).toContain(t('gameTable.playA11ySpokenTooLow'));

    await r.unmount();
  });

  it('says GIOCA on the button whatever the reason is', async () => {
    const r = await mount(
      state({ lastPlayedCombination: single(card('9', 'diamonds')), lastPlayedBy: 1 }),
      [SEVEN_H]
    );

    // What the button says, not what it announces: the word is the button's own
    // face and is hidden from the reader, which the label carries instead.
    expect(screen.getByText(t('gameTable.playLabelGioca'), { includeHiddenElements: true })).toBeTruthy();

    await r.unmount();
  });
});

describe('the start-card banner names the real fallback card', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const FIVE_H = card('5', 'hearts');

  it('the viewer opens: banner names the actual card, not the 3♠', async () => {
    const r = await render(table(state({ firstPlayMade: false, startCard: FIVE_H, currentTurnIndex: 0 })));

    const panel = within(screen.getByTestId('notice-whoStarts', { includeHiddenElements: true }));
    expect(panel.getByText('You start! You hold the 5♥', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('♠')).toBeNull();

    await r.unmount();
  });

  it('another seat opens: banner names the actual card, not the 3♠', async () => {
    const r = await render(table(state({ firstPlayMade: false, startCard: FIVE_H, currentTurnIndex: 1 })));

    const panel = within(screen.getByTestId('notice-whoStarts', { includeHiddenElements: true }));
    expect(panel.getByText('Besi starts — holds the 5♥', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('♠')).toBeNull();

    await r.unmount();
  });
});

describe('tapping an unavailable GIOCA', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await bootFeedback();
  });

  const refusedTable = () =>
    mount(
      state({ lastPlayedCombination: single(card('9', 'diamonds')), lastPlayedBy: 1 }),
      [SEVEN_H, SEVEN_C]
    );

  it('answers with the rigid haptic, the refusal sound and the reason in words', async () => {
    const r = await refusedTable();

    expect(screen.queryByText(t('gameTable.playA11ySpokenWrongType'))).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });

    expect(haptics()).toContain('rigid');
    expect(sounds().filter((s) => s === 'reject')).toHaveLength(1);
    expect(haptics()).not.toContain('notificationError');
    expect(screen.getByText(t('gameTable.playA11ySpokenWrongType'))).toBeTruthy();

    await r.unmount();
  });

  it('still reports itself unavailable to assistive tech', async () => {
    const r = await refusedTable();

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });

    // In its name, not as a disabled state: the press above was answered rather
    // than ignored, so the control is operable and `disabled` would be a lie.
    expect(screen.getByTestId('btn-gioca').props.accessibilityLabel).toBe(
      t('gameTable.playA11yUnavailable', { reason: t('gameTable.playA11ySpokenWrongType') })
    );
    expect(screen.getByTestId('btn-gioca').props.accessibilityState?.disabled).toBeUndefined();

    await r.unmount();
  });

  it('does not submit the refused selection', async () => {
    const onPlay = jest.fn<(ids: string[]) => void>();
    const r = await mount(
      state({ lastPlayedCombination: single(card('9', 'diamonds')), lastPlayedBy: 1 }),
      [SEVEN_H, SEVEN_C],
      onPlay
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });

    expect(onPlay).not.toHaveBeenCalled();

    await r.unmount();
  });
});

describe('tapping an available GIOCA', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await bootFeedback();
  });

  it('answers with a selection tick, leaving the weight to the landing', async () => {
    const r = await mount(state({}), [SEVEN_H]);
    const before = haptics().length;

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });

    expect(haptics().slice(before).filter((h) => h === 'selection')).toHaveLength(1);
    expect(haptics()).not.toContain('impactMedium');

    await r.unmount();
  });
});
