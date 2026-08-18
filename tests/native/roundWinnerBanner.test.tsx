// tests/native/roundWinnerBanner.test.tsx — the round-winner tag over the pile
// is announced once per round, for every round.
//
// The seat that wins a round leads the next one, so the same seat winning two
// rounds in a row is ordinary play rather than an edge case: `roundWinner`
// goes seat → null → the same seat, and the tag has to appear both times.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { GameState, Player } from '@/lib/gameEngine';

// Reached through lib/sounds; the native module has no JS implementation here.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GameTable } = require('@/components/GameTable') as typeof import('@/components/GameTable');

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const WINNER = 'Besi';

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

const state = (roundWinner: number | null): GameState => ({
  players: [seat('u1', 'Ana'), seat('u2', WINNER)],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

const noop = () => {};

const table = (roundWinner: number | null) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={state(roundWinner)}
      viewerSeat={0}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      roundLabel="Partita"
    />
  </SafeAreaProvider>
);

/** The name in the tag over the pile, not the same name on its seat. */
const tagName = () => within(screen.getByTestId('pile-area')).queryByText(WINNER);

describe('the round-winner tag', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the winner, dismisses itself, and shows the same winner again next round', async () => {
    const r = await render(table(1));
    expect(tagName()).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(tagName()).toBeNull();

    // The pass that ends nothing: the engine clears roundWinner between rounds.
    await act(async () => r.rerender(table(null)));
    expect(tagName()).toBeNull();

    await act(async () => r.rerender(table(1)));
    expect(tagName()).toBeTruthy();

    await r.unmount();
  });
});
