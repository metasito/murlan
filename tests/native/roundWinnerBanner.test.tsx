// tests/native/roundWinnerBanner.test.tsx — the round-winner tag over the pile
// is announced once per round, for every round.
//
// The seat that wins a round leads the next one, so the same seat winning two
// rounds in a row is ordinary play rather than an edge case. `roundWinner`
// survives the round the winner then leads — `processPlay` never touches it —
// so with two players it goes seat → seat with nothing in between, and with
// three it goes seat → null → seat. The tag and its sting have to arrive both
// times either way.
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

// Reduced motion collapses a played card's flight to a single timer, so the
// pile reaches its settled state on a tick rather than on a spring callback.
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { playRoundWin } from '@/lib/sounds';
import { GameTable } from '@/components/GameTable';
import { getVisibleText } from './visibilityHelpers';
import type { Card, Combination, GameState, Player } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const WINNER = 'Besi';
const WINNER_SEAT = 1;

const KING: Card = { id: 'K_hearts', rank: 'K', suit: 'hearts', isJoker: false };
const LED: Combination = { type: 'single', cards: [KING], strength: 13 };

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

const state = (over: Partial<GameState>): GameState => ({
  players: [seat('player_0', 'Ana'), seat('player_1', WINNER)],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: WINNER_SEAT,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
  ...over,
});

/** The pass that closed the round in the winner's favour. */
const closed = () => state({ roundWinner: WINNER_SEAT });
/** The winner leading the next round; `roundWinner` still stands. */
const leading = () => state({ lastPlayedCombination: LED, roundWinner: WINNER_SEAT });
/** A pass that closed nothing, three-handed. */
const between = () => state({ roundWinner: null });

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

/** The tag's scope over the pile, not the same name on its seat. */
const pileArea = () => within(screen.getByTestId('pile-area'));
/** Not present, hidden or otherwise — the tag unmounts on dismissal rather
 *  than fading in place, so a plain absence check is the real claim here. */
const tagGone = () => pileArea().queryByText(WINNER, { includeHiddenElements: true }) === null;

describe('the round-winner tag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the winner, dismisses itself, and shows the same winner again next round', async () => {
    const r = await render(table(closed()));
    getVisibleText(pileArea(), WINNER);
    expect(playRoundWin).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(tagGone()).toBe(true);

    // The pass that ends nothing: three-handed, the engine clears roundWinner.
    await act(async () => r.rerender(table(between())));
    expect(tagGone()).toBe(true);

    await act(async () => r.rerender(table(closed())));
    getVisibleText(pileArea(), WINNER);
    expect(playRoundWin).toHaveBeenCalledTimes(2);

    await r.unmount();
  });

  it('announces the second win when roundWinner never changes value', async () => {
    // Two-handed: the winner leads the next round and takes it as well, so
    // `roundWinner` reads the same seat from the first close to the second.
    const r = await render(table(closed()));
    getVisibleText(pileArea(), WINNER);
    expect(playRoundWin).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(tagGone()).toBe(true);

    await act(async () => r.rerender(table(leading())));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(tagGone()).toBe(true);

    await act(async () => r.rerender(table(closed())));
    getVisibleText(pileArea(), WINNER);
    expect(playRoundWin).toHaveBeenCalledTimes(2);

    await r.unmount();
  });
});
