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

import { GameTable } from '@/components/GameTable';
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
const spin = (p: Pose) => parseFloat(String(p.transform?.find((t) => 'rotate' in t)?.rotate ?? 0));
const landedSince = (before: Pose[], after: Pose[]) =>
  after.filter((p, i) => before[i]?.opacity === 1 && (p.opacity !== 1 || spin(p) < spin(before[i]))).length;

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
    expect(backs().length).toBeLessThanOrEqual(39 / 2);
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
  });

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
});
