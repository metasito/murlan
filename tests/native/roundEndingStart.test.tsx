// tests/native/roundEndingStart.test.tsx — the round ending starts from the landing of the play
// that ended it, never while that play is still pending or in flight, and starts with nothing
// thrown at all when the round ends without a play.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import { useRoundEnding } from '@/components/table/useRoundEnding';
import type { Combination, GameState, Player } from '@/lib/game/gameEngine';
import { card, PAIR } from './helpers/landing';
import { aThreePlayed } from '../support/game';

async function mount(landed: number | null) {
  const onLanded = jest.fn<(at: number) => void>();
  const view = await renderHook(
    (at: number | null) => useRoundEnding({ ended: true, landed: at, pileEmpty: false, onLanded }),
    { initialProps: landed }
  );
  return {
    onLanded,
    clock: () => view.result.current.clock.get(),
    skip: () => view.result.current.skip(),
    rerender: (at: number | null) => act(async () => view.rerender(at)),
    unmount: () => view.unmount(),
  };
}

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};
const noop = () => {};
const ORDER = ['player_1', 'player_2', 'player_3', 'player_0'];
const CLOSING: Combination = { type: 'pair', cards: [card('k1', 'K', 'clubs'), card('k2', 'K', 'diamonds')], strength: 13 };
const seat = (i: number): Player => ({ id: `player_${i}`, name: `P${i}`, hand: [], type: 'human' });

function table(onRoundLanded: (at: number) => void, over: boolean, last: Combination = PAIR) {
  const state: GameState = {
    players: [0, 1, 2, 3].map(seat),
    currentTurnIndex: 3,
    lastPlayedCombination: last,
    lastPlayedBy: last === PAIR ? 2 : 3,
    passCount: 0,
    gameMode: 'free_for_all',
    roundOver: over,
    finishingOrder: over ? ORDER : [],
    openingCard: null,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: 'deal' },
  };
  const placementPoints = over ? Object.fromEntries(ORDER.map((id, i) => [id, 3 - i])) : {};
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable
        gameState={state}
        placementPoints={placementPoints}
        viewerSeat={0}
        onPlay={noop}
        onPass={noop}
        onQuit={noop}
        onExchangeGive={noop}
        onRoundLanded={onRoundLanded}
      />
    </SafeAreaProvider>
  );
}
const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the start of a round ending', () => {
  it('waits for the landing, and starts there once', async () => {
    const { onLanded, rerender, unmount } = await mount(null);
    jest.advanceTimersByTime(300);
    await rerender(null);
    expect(onLanded).not.toHaveBeenCalled();

    const landsAt = performance.now();
    await rerender(landsAt);
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(onLanded).toHaveBeenCalledWith(landsAt);
    await rerender(landsAt + 50);
    expect(onLanded).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('holds the pill on the standings before the round until the landing, a tap included', async () => {
    const { clock, skip, unmount } = await mount(null);
    expect(clock()).toBe(0);
    await act(async () => skip());
    jest.advanceTimersByTime(100);
    expect(clock()).toBe(0);
    await unmount();
  });

  it('runs a started ending on through the deal, whatever the table does next', async () => {
    const view = await renderHook(
      ({ ended, landed }: { ended: boolean; landed: number | null }) => useRoundEnding({ ended, landed, pileEmpty: false }),
      { initialProps: { ended: true, landed: performance.now() as number | null } }
    );
    await act(async () => void jest.advanceTimersByTime(2500));
    await act(async () => view.rerender({ ended: false, landed: null }));
    await act(async () => void jest.advanceTimersByTime(100));
    expect(view.result.current.clock.get()).toBeGreaterThan(2500);
    await view.unmount();
  });

  it('starts at the ending itself when the landing came before it', async () => {
    const endedAt = performance.now();
    const { onLanded, unmount } = await mount(endedAt - 1000);
    expect(onLanded).toHaveBeenCalledWith(endedAt);
    await unmount();
  });

  it('on the table, waits for the closing throw to land', async () => {
    const landed = jest.fn<(at: number) => void>();
    const view = await render(table(landed, false));
    await advance(2000);
    await act(async () => view.rerender(table(landed, true, CLOSING)));
    await advance(16);
    expect(landed).not.toHaveBeenCalled();
    await advance(1500);
    expect(landed).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('on the table, starts a round that ends with nothing thrown, as an online abandonment does', async () => {
    const landed = jest.fn<(at: number) => void>();
    const view = await render(table(landed, false));
    await advance(2000);
    const endedAt = performance.now();
    await act(async () => view.rerender(table(landed, true)));
    await advance(16);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(landed.mock.calls[0][0]).toBeGreaterThanOrEqual(endedAt);
    await view.unmount();
  });
});
