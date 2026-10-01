// tests/native/dealPool.test.tsx — the deal flies on a pool of backs, each posing one leg at a time,
// and its clock stops at the deal's end (#1259).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle, makeMutable, type FrameCallback } from 'react-native-reanimated';

const mockFrameCallbacks: FrameCallback[] = [];
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    useFrameCallback: (...args: Parameters<typeof actual.useFrameCallback>) => {
      const frames = actual.useFrameCallback(...args);
      mockFrameCallbacks.push(frames);
      return frames;
    },
  };
});
jest.mock('@/components/table/dealSlots', () => {
  const actual = jest.requireActual<typeof import('@/components/table/dealSlots')>('@/components/table/dealSlots');
  return { ...actual, __esModule: true, dealSlots: jest.fn(actual.dealSlots) };
});

import { GameTable } from '@/components/GameTable';
import { DealFlights } from '@/components/table/deal';
import { dealPose } from '@/components/table/dealPose';
import { dealFlightsFor, dealLegs, dealSlots, legAt } from '@/components/table/dealSlots';
import { dealCards, type GameState, type Player } from '@/lib/game/gameEngine';
import { GEOMETRY, frames } from './helpers/exchangeLegs';
import { busiest, inAir } from './helpers/dealSweep';
import { bootFeedback } from './helpers/feedback';

const backs = () => screen.queryAllByTestId('dealt-back').map((b) => getAnimatedStyle(b));
const slotted = () => jest.mocked(dealSlots).mock;

const freshDeal = (seats: number): GameState => ({
  players: dealCards(seats).hands.map((hand, i) => ({ id: `p${i}`, name: `P${i}`, hand, type: 'human' }) as Player),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: false,
});

const table = (gameState: GameState) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
    <GameTable gameState={gameState} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} />
  </SafeAreaProvider>
);

describe('the deal flies on a pool of backs', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    [2, 14, 7],
    [3, 36, 9],
    [4, 40, 16],
  ])('draws %i players’ %i legs with as many backs as are ever in the air at once, %i on the 844 × 390 table', async (seats, legCount, pool) => {
    const view = await render(table(freshDeal(seats)));
    const legs = slotted().calls.at(-1)![0];
    expect(legs).toHaveLength(legCount);
    expect(backs()).toHaveLength(busiest(legs));
    expect(backs()).toHaveLength(pool);
    await view.unmount();
  });

  it('keeps its legs and pooled slots through a re-render of the table mid-deal', async () => {
    const gameState = freshDeal(4);
    const view = await render(table(gameState));
    await frames(400);
    const calls = slotted().calls.length;
    const pooled = slotted().results.at(-1)!.value;
    expect(backs().length).toBeGreaterThan(0);

    await view.rerender(table({ ...gameState }));
    await frames(32);

    expect(slotted().calls.length).toBe(calls);
    expect(slotted().results.at(-1)!.value).toBe(pooled);
    expect(backs().length).toBeGreaterThan(0);
    await view.unmount();
  });

  it('poses every leg in the air, each back one leg at a time, and stops its clock at the end', async () => {
    const counts = [14, 14, 13, 13];
    const legs = dealLegs(GEOMETRY, { key: 1, offsetMs: 100, counts, flightsMs: dealFlightsFor(GEOMETRY) });
    const slots = dealSlots(legs);
    const endMs = Math.max(...legs.map((l) => l.leaveMs + l.flightMs));
    const clock = makeMutable(-1);
    const onLanded = jest.fn();
    mockFrameCallbacks.length = 0;
    const view = await render(
      <DealFlights cards={legs} scale={1} clock={clock} startMs={100} endMs={endMs} onStarted={() => {}} onLanded={onLanded} />
    );
    expect(backs()).toHaveLength(slots.length);
    expect(slots.length * 2).toBeLessThanOrEqual(legs.length);

    const flown = new Set<string>();
    await frames(endMs + 200, () => {
      const t = clock.value;
      const poses = backs();
      slots.forEach((slot, i) => expect(poses[i]).toMatchObject(dealPose(legAt(slot, t), t)));
      expect(poses.filter((p) => p.opacity === 1)).toHaveLength(legs.filter((l) => inAir(l, t)).length);
      for (const slot of slots) if (inAir(legAt(slot, t), t)) flown.add(legAt(slot, t).key);
    });

    expect(flown.size).toBe(legs.length);
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(mockFrameCallbacks.length).toBeGreaterThan(0);
    expect(mockFrameCallbacks.at(-1)!.isActive).toBe(false);
    await view.unmount();
  });
});
