// tests/native/seatDealArrival.test.tsx — an opponent's hand is dealt to it
// card by card, and its badge counts only what has landed (#1102).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';

let mockReduce = false;
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduce,
  setMotionPreference: () => {},
  getMotionPreference: () => (mockReduce ? 'on' : 'off'),
}));

jest.mock('@/components/table/dealSlots', () => {
  const actual = jest.requireActual<typeof import('@/components/table/dealSlots')>('@/components/table/dealSlots');
  return { ...actual, __esModule: true, dealSlots: jest.fn(actual.dealSlots) };
});

jest.mock('@/components/table/lampRig', () => {
  const actual = jest.requireActual<typeof import('@/components/table/lampRig')>('@/components/table/lampRig');
  return {
    ...actual,
    __esModule: true,
    restingLamp: jest.fn(actual.restingLamp),
    lampControls: { ...actual.lampControls, setLevel: jest.fn(actual.lampControls.setLevel) },
  };
});

jest.mock('@/components/table/particles', () => {
  const actual = jest.requireActual<typeof import('@/components/table/particles')>('@/components/table/particles');
  return { ...actual, __esModule: true, dealSpecks: jest.fn(actual.dealSpecks) };
});

jest.mock('@/components/table/dealPose', () => {
  const actual = jest.requireActual<typeof import('@/components/table/dealPose')>('@/components/table/dealPose');
  return { ...actual, __esModule: true, handDealArc: jest.fn(actual.handDealArc) };
});

import { GameTable } from '@/components/GameTable';
import { handDealArc } from '@/components/table/dealPose';
import { dealSlots } from '@/components/table/dealSlots';
import { lampControls, restingLamp } from '@/components/table/lampRig';
import { dealSpecks } from '@/components/table/particles';
import { busiest } from './helpers/dealSweep';
import { bootFeedback, startsOf } from './helpers/feedback';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const NAMES = ['Ana', 'Besi', 'Cimi', 'Drin'];
const handOf = (seatIdx: number, n: number): Card[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${seatIdx}_${i}`, rank: '3', suit: 'spades', isJoker: false }) as Card);
const players: Player[] = NAMES.map((name, i) => ({ id: `player_${i}`, name, hand: handOf(i, 13), type: 'human' }));

const freshDeal: GameState = {
  players,
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: false,
};

const noop = () => {};
const table = (gameState: GameState = freshDeal) => (
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

const SEATS = ['top-seat', 'side-seat-left', 'side-seat-right'];
const counted = (testID: string) => {
  const badge = within(screen.getByTestId(testID)).queryByText(/^[0-9]+$/);
  return badge ? Number(badge.props.children) : 0;
};
const seated = () => SEATS.reduce((sum, id) => sum + counted(id), 0);

type Pose = { opacity?: number; transform?: Record<string, number | string>[] };
const backs = () => screen.queryAllByTestId('dealt-back').map((b) => getAnimatedStyle(b) as Pose);
const along = (p: Pose, key: string) => Number(p.transform?.find((t) => key in t)?.[key] ?? 1);
const reach = (p: Pose) => Math.hypot(along(p, 'translateX'), along(p, 'translateY'));
const breath = () => along(getAnimatedStyle(screen.getByTestId('table-felt', { includeHiddenElements: true })) as Pose, 'scale');
const landedSince = (before: Pose[], after: Pose[]) =>
  after.filter((p, i) => before[i]?.opacity === 1 && (p.opacity !== 1 || reach(p) < reach(before[i]))).length;

const handPoses = () =>
  screen.getAllByTestId('card-box').map((box) => {
    let n = box.parent;
    while (n && !(n.props.jestAnimatedStyle && typeof StyleSheet.flatten(n.props.style)?.left === 'number')) n = n.parent;
    return getAnimatedStyle(n!) as Pose;
  });

const frame = () => act(async () => void jest.advanceTimersByTime(16));

describe("an opponent's hand arrives with the deal", () => {
  beforeEach(async () => {
    mockReduce = false;
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts at each seat exactly the backs whose flight has reached it, frame by frame', async () => {
    const r = await render(table());
    const legs = jest.mocked(dealSlots).mock.calls.at(-1)![0];
    expect(legs).toHaveLength(39);
    expect(backs()).toHaveLength(busiest(legs));
    expect(seated()).toBe(0);
    expect(startsOf('deal')).toEqual([]);

    let frames = 0;
    let sawCount = false;
    let arrived = 0;
    let before = backs();
    while (screen.queryAllByTestId('dealt-back').length > 0 && frames++ < 2000) {
      await frame();
      if (screen.queryAllByTestId('dealt-back').length === 0) break;
      arrived += landedSince(before, (before = backs()));
      expect(startsOf('deal')).toHaveLength(1);
      expect(seated()).toBe(arrived);
      sawCount ||= seated() > 0 && seated() < 39;
    }

    expect(sawCount).toBe(true);
    for (const id of SEATS) expect(counted(id)).toBe(13);
    await r.unmount();
  }, 20_000);

  it('keeps the landed count through a re-render of the table mid-deal', async () => {
    const r = await render(table());
    let frames = 0;
    while (seated() < 10 && frames++ < 2000) await frame();
    const before = seated();
    expect(before).toBeGreaterThan(0);

    await r.rerender(table());
    expect(seated()).toBeGreaterThanOrEqual(before);

    await r.unmount();
  });

  it("deals the viewer's hand only with the table's deal", async () => {
    const dealt = await render(table());
    await frame();
    expect(handPoses().some((p) => p.opacity !== 1)).toBe(true);
    await dealt.unmount();

    const resumed = await render(table({ ...freshDeal, firstPlayMade: true }));
    await frame();
    expect(backs()).toHaveLength(0);
    expect(handPoses()).toHaveLength(13);
    expect(handPoses().every((p) => p.opacity === 1)).toBe(true);
    await resumed.unmount();
  });

  it('seats every hand at once under reduced motion, and still sounds the deal', async () => {
    mockReduce = true;
    const r = await render(table());
    await frame();

    expect(within(screen.getByTestId('side-seat-left')).getByText('13')).toBeTruthy();
    expect(screen.queryAllByTestId('dealt-back').length).toBe(0);
    expect(startsOf('deal')).toHaveLength(1);

    await r.unmount();
  });

  it("breathes the felt at the deal's onset, raises the lamp a lead after it, and throws specks as each of the viewer's cards lands", async () => {
    const r = await render(table());
    expect(jest.mocked(restingLamp).mock.calls[0][1]).toBe(0.75);
    const rises: number[] = [];
    const breaths: number[] = [];
    const scales = new Set<number>();
    for (let t = 16; t <= 1700; t += 16) {
      await frame();
      if (jest.mocked(lampControls.setLevel).mock.calls.some((c) => c[1] === 1)) rises.push(t);
      breaths.push(breath());
      for (const p of handPoses()) if (p.opacity === 1) scales.add(along(p, 'scale'));
    }
    expect(rises[0]).toBeGreaterThanOrEqual(600 + 40);
    expect(rises[0]).toBeLessThan(600 + 40 + 3 * 16);
    expect(Math.max(...breaths)).toBeGreaterThan(1.004);
    expect(Math.max(...breaths)).toBeLessThanOrEqual(1.006);
    expect(breaths.at(-1)).toBe(1);
    expect(Math.min(...scales)).toBeLessThan(0.9);
    expect(jest.mocked(dealSpecks).mock.calls).toHaveLength(13);
    await r.unmount();
  }, 20_000);

  it("lifts and turns each of the viewer's dealt cards by its arc", async () => {
    const actual = jest.requireActual<typeof import('@/components/table/dealPose')>('@/components/table/dealPose');
    const firstShown = async (lift: number) => {
      jest.mocked(handDealArc).mockImplementation(() => ({ lift, rot: 33, scale: 0.5 }));
      const r = await render(table());
      for (let i = 0; i < 80; i++) {
        await frame();
        const k = handPoses().findIndex((p) => p.opacity === 1);
        if (k < 0) continue;
        const p = handPoses()[k];
        await r.unmount();
        return { i, k, ty: along(p, 'translateY'), rot: p.transform?.find((t) => 'rotate' in t)?.rotate, scale: along(p, 'scale') };
      }
      throw new Error('no dealt card shown');
    };
    try {
      const flat = await firstShown(0);
      const lifted = await firstShown(100);
      expect([lifted.i, lifted.k]).toEqual([flat.i, flat.k]);
      expect(lifted.ty - flat.ty).toBeCloseTo(-100);
      expect([flat.rot, flat.scale]).toEqual(['33deg', 0.5]);
    } finally {
      jest.mocked(handDealArc).mockImplementation(actual.handDealArc);
    }
  }, 20_000);

  it('lays the hand in place when reduced motion comes on mid-deal', async () => {
    const r = await render(table());
    for (let t = 0; t < 400; t += 16) await frame();
    expect(handPoses().some((p) => p.opacity !== 1)).toBe(true);
    mockReduce = true;
    await r.rerender(table());
    for (let t = 0; t < 400; t += 16) await frame();
    expect(handPoses().map((p) => [p.opacity, along(p, 'scale')])).toEqual(Array(13).fill([1, 1]));
    await r.unmount();
  }, 20_000);

  it('lays the hand in place under reduced motion, with no breath, lamp rise or specks', async () => {
    mockReduce = true;
    const r = await render(table());
    expect(jest.mocked(restingLamp).mock.calls[0][1]).toBe(1);
    for (let t = 0; t < 1200; t += 16) {
      await frame();
      expect(handPoses().map((p) => [p.opacity, along(p, 'scale')])).toEqual(Array(13).fill([1, 1]));
      expect(breath()).toBe(1);
    }
    expect(lampControls.setLevel).not.toHaveBeenCalled();
    expect(dealSpecks).not.toHaveBeenCalled();
    await r.unmount();
  });
});
