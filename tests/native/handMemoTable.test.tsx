import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockCardRenders = { n: 0 };
jest.mock('@/lib/cosmetics', () => {
  const actual = jest.requireActual('@/lib/cosmetics') as typeof import('@/lib/cosmetics');
  return {
    ...actual,
    useCardBack: () => {
      mockCardRenders.n += 1;
      return actual.useCardBack();
    },
  };
});

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}));

import { GameTable } from '@/components/GameTable';
import type { Card, GameState, Rank } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const RANKS: Rank[] = ['3', '4', '5', '6', '7'];

const hand = (ranks: Rank[] = RANKS): Card[] =>
  ranks.map((rank) => ({ id: `${rank}_spades`, suit: 'spades', rank, isJoker: false }));

const state = (cards: Card[], passCount: number): GameState => ({
  players: [
    { id: 'player_0', name: 'Ana', hand: cards, type: 'human' },
    { id: 'player_1', name: 'Besi', hand: [], type: 'human' },
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

const noop = () => {};

const table = (s: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={s}
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

// Through the real GameTable, so `arrange` reaches every card as `onMove`.
describe('an unrelated game:state does not rebuild an arrangeable hand', () => {
  beforeEach(() => {
    mockCardRenders.n = 0;
  });

  it('commits no card render when only the rest of the state changed', async () => {
    const r = await render(table(state(hand(), 0)));
    const afterMount = mockCardRenders.n;
    expect(afterMount).toBeGreaterThanOrEqual(RANKS.length);

    await r.rerender(table(state(hand(), 1)));
    expect(mockCardRenders.n).toBe(afterMount);
    await r.unmount();
  });

  it('still rebuilds when the hand itself changed', async () => {
    const r = await render(table(state(hand(), 0)));
    mockCardRenders.n = 0;

    await r.rerender(table(state(hand(['3', '4', '5', '6']), 0)));
    expect(mockCardRenders.n).toBeGreaterThan(0);
    await r.unmount();
  });
});
