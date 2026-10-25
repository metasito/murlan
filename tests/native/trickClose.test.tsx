// tests/native/trickClose.test.tsx — winning a trick pays off on the cards
// that won it.
//
// `processPass` clears `lastPlayedCombination` and records the closing pass in the
// same transition, so the table sees both on one commit. Taken naively that
// wipes the felt at the exact moment the winner tag goes up, and plays the
// new-round sting ahead of the trick-win sting.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';

// Reduced motion collapses the card's flight to a single timer, so the pile
// reaches its settled state on a tick rather than on a spring callback.
import { bootFeedback, startsOf } from './helpers/feedback';
import { newEpoch } from './mocks/audioApi';
import { GameTable } from '@/components/GameTable';
import { TRICK_WINNER_MS } from '@/components/table/pile';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import { Motion } from '@/lib/theme';
import type { Card, Combination, GameState, Player } from '@/lib/game/gameEngine';
import { setMotion } from './harness/env';
import { BOT_THINK_MS } from '@/lib/game/turnSchedule';
import { aThreePlayed } from '../support/game';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const KING: Card = { id: 'K_hearts', rank: 'K', suit: 'hearts', isJoker: false };
const ACE: Card = { id: 'A_spades', rank: 'A', suit: 'spades', isJoker: false };

const single = (card: Card): Combination => ({
  type: 'single',
  cards: [card],
  strength: 13,
});

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

const state = (over: Partial<GameState>): GameState => ({
  players: [seat('player_0', 'Ana'), seat('player_1', 'Besi')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
  ...over,
});

const noop = () => {};

const table = (gameState: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

/** The named card, as drawn on the felt rather than anywhere else on screen. */
const onFelt = (card: Card) =>
  within(screen.getByTestId('pile-area')).queryByLabelText(cardSpokenName(card, t));

/** Seat 1 leads the King; seat 0's pass closes the trick in seat 1's favour. */
const LED = state({ lastPlayedCombination: single(KING), lastPlayedBy: 1, currentTurnIndex: 0, lastMove: { seq: 1, kind: 'play', seat: 1 } });
const CLOSED = state({ lastPlayedCombination: null, lastPlayedBy: 1, lastMove: { seq: 2, kind: 'pass', seat: 0, closedTrick: true } });

beforeEach(() => setMotion('on'));

describe('the pass that closes a trick', () => {
  it("is held longer than a bot takes to lead, so a bot winner's lead lands inside the hold", () => {
    expect(BOT_THINK_MS).toBeLessThan(TRICK_WINNER_MS);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds the winning cards on the felt, then clears them', async () => {
    const r = await render(table(LED));
    // Let the played card finish its (collapsed) flight onto the pile.
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(onFelt(KING)).toBeTruthy();

    await act(async () => r.rerender(table(CLOSED)));
    expect(onFelt(KING)).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(TRICK_WINNER_MS - 1);
    });
    expect(onFelt(KING)).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(2);
    });
    expect(onFelt(KING)).toBeNull();

    await r.unmount();
  });

  it('holds and sounds a close that reaches the table with a move it never saw', async () => {
    // A reconnect, or two commits in one update: the pass before the close is never drawn.
    const r = await render(table(LED));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    newEpoch();

    await act(async () => r.rerender(table({ ...CLOSED, lastMove: { seq: 3, kind: 'pass', seat: 0, closedTrick: true } })));
    expect(startsOf('trick_win')).toHaveLength(1);
    await act(async () => {
      jest.advanceTimersByTime(TRICK_WINNER_MS - 1);
    });
    expect(onFelt(KING)).toBeTruthy();

    await r.unmount();
  });

  it('plays the trick-win sting before the new-round sting', async () => {
    const r = await render(table(LED));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    newEpoch();

    await act(async () => r.rerender(table(CLOSED)));
    expect(startsOf('trick_win')).toHaveLength(1);
    expect(startsOf('trick_start')).toEqual([]);

    await act(async () => {
      jest.advanceTimersByTime(TRICK_WINNER_MS + 1);
    });
    expect(startsOf('trick_start')).toHaveLength(1);
    expect(startsOf('trick_win')[0]).toBeLessThan(startsOf('trick_start')[0]);

    await r.unmount();
  });

  it('lets the next lead end the hold early, landing on a cleared pile', async () => {
    const r = await render(table(LED));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await act(async () => r.rerender(table(CLOSED)));
    // Seat 1 won the trick, so seat 1 leads the next one — well inside the hold.
    await act(async () => {
      jest.advanceTimersByTime(200);
      r.rerender(
        table(state({ lastPlayedCombination: single(ACE), lastPlayedBy: 1, lastMove: { seq: 3, kind: 'play', seat: 1 } }))
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(onFelt(ACE)).toBeTruthy();
    expect(onFelt(KING)).toBeNull();

    await r.unmount();
  });

  describe('with motion on', () => {
    beforeEach(() => setMotion('off'));

    const swept = (card: Card) =>
      within(screen.getByTestId('sweep-cards', { includeHiddenElements: true })).queryByLabelText(cardSpokenName(card, t), { includeHiddenElements: true });
    const travelled = () => {
      const { transform } = getAnimatedStyle(screen.getByTestId('sweep-cards', { includeHiddenElements: true })) as { transform: readonly { translateX?: number; translateY?: number }[] };
      return Math.hypot(transform[0].translateX ?? 0, transform[1].translateY ?? 0);
    };

    it('sweeps the winning cards off the felt once the hold ends', async () => {
      const r = await render(table(LED));
      await act(async () => r.rerender(table(CLOSED)));
      await act(async () => {
        jest.advanceTimersByTime(TRICK_WINNER_MS + 1);
      });
      expect(swept(KING)).toBeTruthy();
      expect(onFelt(KING)).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(Motion.duration.travel / 2);
      });
      expect(travelled()).toBeGreaterThan(1);
      await act(async () => {
        jest.advanceTimersByTime(Motion.duration.travel / 2);
      });
      expect(screen.queryByTestId('sweep-cards')).toBeNull();

      await r.unmount();
    });

    it('still sweeps them when a bot leads inside the hold', async () => {
      const r = await render(table(LED));
      await act(async () => r.rerender(table(CLOSED)));
      await act(async () => {
        jest.advanceTimersByTime(BOT_THINK_MS);
        r.rerender(
          table(state({ lastPlayedCombination: single(ACE), lastPlayedBy: 1, lastMove: { seq: 3, kind: 'play', seat: 1 } }))
        );
      });
      expect(swept(KING)).toBeTruthy();
      expect(swept(ACE)).toBeNull();
      expect(onFelt(KING)).toBeNull();

      await r.unmount();
    });
  });
});
