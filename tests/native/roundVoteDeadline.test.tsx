// The next-round vote's deadline (docs/GAME-RULES.md § Decisions) counts down on
// the results screen in the turn clock's chip, which no turn holds there.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import type { RoundVoteNote } from '@/components/table/notices/netNotes';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (i: number): Player => ({
  id: `player_${i}`,
  name: ['Ana', 'Besi'][i],
  hand: i === 1 ? [{ id: '3_spades', rank: '3', suit: 'spades', isJoker: false } as Card] : [],
  type: 'human',
});

const results: GameState = {
  players: [seat(0), seat(1)],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: true,
  finishingOrder: ['player_0', 'player_1'],
  firstPlayMade: true,
  lastMove: { seq: 0, kind: 'deal' },
};

const noop = () => {};

const table = (roundVote: RoundVoteNote) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      ownLink="up"
      gameState={results}
      viewerSeat={0}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      turnTimer={{ seconds: 0, includeNewTrick: true }}
      roundVote={roundVote}
    />
  </SafeAreaProvider>
);

const vote = { voted: false, votes: 0, total: 2, onPress: noop };
const count = () => screen.queryByTestId('turn-chip-count', { includeHiddenElements: true })?.props.children;
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

describe('the next-round vote deadline on the results screen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts down from the seconds the server sent', async () => {
    const view = await render(table({ ...vote, deadline: { seconds: 30, resetKey: '1000' } }));
    await advance(0);
    expect(count()).toBe(30);

    await advance(5000);
    expect(count()).toBe(25);

    await view.rerender(table({ ...vote, deadline: { seconds: 12, resetKey: '1000' } }));
    await advance(0);
    expect(count()).toBe(12);
    await view.unmount();
  });

  it('shows no count while the vote carries no deadline', async () => {
    const view = await render(table(vote));
    await advance(1000);
    expect(count()).toBeUndefined();
    await view.unmount();
  });
});
