// tests/native/roundClose.test.tsx — winning a round pays off on the cards
// that won it.
//
// `processPass` clears `lastPlayedCombination` and credits `roundWinner` in the
// same transition, so the table sees both on one commit. Taken naively that
// wipes the felt at the exact moment the winner tag goes up, and plays the
// new-round sting ahead of the round-win sting.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
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
  ensureAudioMode: jest.fn(async () => {}),
}));

// Reduced motion collapses the card's flight to a single timer, so the pile
// reaches its settled state on a tick rather than on a spring callback.
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { playRoundStart, playRoundWin } from '@/lib/sounds';
import { GameTable } from '@/components/GameTable';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import type { Card, Combination, GameState, Player } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

/** How long the winning cards are held. Mirrors ROUND_WINNER_MS. */
const HOLD_MS = 1800;

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
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
  ...over,
});

const noop = () => {};

const table = (gameState: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      selectedIds={[]}
      onSelectCard={noop}
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

/** Seat 1 leads the King; seat 0's pass closes the round in seat 1's favour. */
const LED = state({ lastPlayedCombination: single(KING), lastPlayedBy: 1, currentTurnIndex: 0 });
const CLOSED = state({ lastPlayedCombination: null, lastPlayedBy: 1, roundWinner: 1 });

describe('the pass that closes a round', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
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
      jest.advanceTimersByTime(HOLD_MS - 1);
    });
    expect(onFelt(KING)).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(2);
    });
    expect(onFelt(KING)).toBeNull();

    await r.unmount();
  });

  it('plays the round-win sting before the new-round sting', async () => {
    const r = await render(table(LED));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    jest.clearAllMocks();

    await act(async () => r.rerender(table(CLOSED)));
    expect(playRoundWin).toHaveBeenCalledTimes(1);
    expect(playRoundStart).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS + 1);
    });
    expect(playRoundStart).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(playRoundWin).mock.invocationCallOrder[0]
    ).toBeLessThan(jest.mocked(playRoundStart).mock.invocationCallOrder[0]);

    await r.unmount();
  });

  it('lets the next lead end the hold early, landing on a cleared pile', async () => {
    const r = await render(table(LED));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await act(async () => r.rerender(table(CLOSED)));
    // Seat 1 won the round, so seat 1 leads the next one — well inside the hold.
    await act(async () => {
      jest.advanceTimersByTime(200);
      r.rerender(
        table(state({ lastPlayedCombination: single(ACE), lastPlayedBy: 1, roundWinner: 1 }))
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(onFelt(ACE)).toBeTruthy();
    expect(onFelt(KING)).toBeNull();

    await r.unmount();
  });
});
