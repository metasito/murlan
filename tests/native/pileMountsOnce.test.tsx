// tests/native/pileMountsOnce.test.tsx — a played card is one view from the throw to the sweep.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { FrameCallback } from 'react-native-reanimated';
import type { FlightClock } from '@/components/table/useFlightClock';

const mockMounts: { id: string; kind: 'mount' | 'unmount'; at: number }[] = [];
const mockBegins: string[] = [];
const mockFrames = { capturing: false, all: new Set<FrameCallback>() };

jest.mock('@/components/CardView', () => {
  const actual = jest.requireActual<typeof import('@/components/CardView')>('@/components/CardView');
  const { useEffect, useState } = jest.requireActual<typeof import('react')>('react');
  function Logged(props: React.ComponentProps<typeof actual.CardView>) {
    const [id] = useState(props.testID === 'pile-card' ? props.card.id : null);
    useEffect(() => {
      if (id === null) return;
      mockMounts.push({ id, kind: 'mount', at: performance.now() });
      return () => void mockMounts.push({ id, kind: 'unmount', at: performance.now() });
    }, [id]);
    return <actual.CardView {...props} />;
  }
  return { ...actual, CardView: Logged };
});

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    useFrameCallback: (cb: Parameters<typeof actual.useFrameCallback>[0], auto?: boolean) => {
      const frames = actual.useFrameCallback(cb, auto);
      if (mockFrames.capturing) mockFrames.all.add(frames);
      return frames;
    },
  };
});

jest.mock('@/components/table/useFlightClock', () => {
  const actual = jest.requireActual<typeof import('@/components/table/useFlightClock')>('@/components/table/useFlightClock');
  const wrapped = new WeakMap<FlightClock, FlightClock>();
  return {
    ...actual,
    useFlightClock: (...args: Parameters<typeof actual.useFlightClock>) => {
      mockFrames.capturing = true;
      const clock = actual.useFlightClock(...args);
      mockFrames.capturing = false;
      if (!wrapped.has(clock)) wrapped.set(clock, { ...clock, begin: (spec) => (mockBegins.push(spec.key), clock.begin(spec)) });
      return wrapped.get(clock)!;
    },
  };
});

import { GameTable } from '@/components/GameTable';
import { comboKey } from '@/components/flightPhysics';
import { initializeGame, type GameState } from '@/lib/game/gameEngine';
import { offlineBotMove } from '@/lib/game/autoMove';
import { setMotionPreference } from '@/lib/accessibility';
import { bootFeedback, settle } from './helpers/feedback';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};
const HOLD_MS = 1800;
const table = (s: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable gameState={s} viewerSeat={0} selectedIds={[]} onSelectCard={noop} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} handScores={{}} />
  </SafeAreaProvider>
);

describe.each<[string, 'on' | 'off']>([['reduced', 'on'], ['full', 'off']])('four tricks under %s motion', (_, preference) => {
  beforeEach(async () => {
    mockMounts.length = 0;
    mockBegins.length = 0;
    mockFrames.all.clear();
    jest.useFakeTimers();
    await bootFeedback();
    await act(async () => setMotionPreference(preference));
  });
  afterEach(async () => {
    await act(async () => setMotionPreference('system'));
    jest.useRealTimers();
  });

  it('draws each played card with one view from its throw until its trick is swept', async () => {
    let state = initializeGame(['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'ai' as const })), 'free_for_all');
    const view = await render(table(state));
    await settle(1100);
    const plays: string[] = [];
    const sweptFrom = new Map<string, number>();
    let round: string[] = [];
    let closedAt: number | null = null;
    let closed = 0;
    while (closed < 4 || closedAt !== null) {
      const next = offlineBotMove(state);
      if (!next) break;
      const lead = state.lastPlayedCombination === null && next.lastPlayedCombination !== null;
      if (lead && closedAt !== null) {
        await settle(closed % 2 === 1 ? 300 : HOLD_MS + 700);
        const sweepAt = Math.min(performance.now(), closedAt + HOLD_MS);
        round.forEach((id) => sweptFrom.set(id, sweepAt));
        round = [];
        closedAt = null;
      }
      state = next;
      await act(async () => view.rerender(table(state)));
      for (let r = 0; r < 3; r++) {
        await settle(16);
        await act(async () => view.rerender(table({ ...state })));
      }
      if (state.lastPlayedCombination !== null && comboKey(state.lastPlayedCombination, state.lastPlayedBy) !== plays.at(-1)) {
        plays.push(comboKey(state.lastPlayedCombination, state.lastPlayedBy));
        round.push(...state.lastPlayedCombination.cards.map((c) => c.id));
      }
      if (state.lastPlayedCombination === null && state.roundWinner !== null && round.length > 0 && closedAt === null) {
        closed += 1;
        closedAt = performance.now();
        continue;
      }
      await settle(1500);
    }
    await settle(3000);

    expect(closed).toBeGreaterThanOrEqual(4);
    const played = new Set(mockMounts.map((m) => m.id));
    expect(played.size).toBeGreaterThan(4);
    for (const id of played) {
      const mine = mockMounts.filter((m) => m.id === id);
      expect(mine.filter((m) => m.kind === 'mount')).toHaveLength(1);
      const gone = mine.find((m) => m.kind === 'unmount');
      if (sweptFrom.has(id)) expect(gone?.at).toBeGreaterThanOrEqual(sweptFrom.get(id)!);
      else expect(gone).toBeUndefined();
    }
    expect([...sweptFrom.keys()].every((id) => played.has(id))).toBe(true);
    expect(mockBegins.slice().sort()).toEqual(plays.slice().sort());
    expect(mockFrames.all.size).toBeGreaterThan(4);
    expect([...mockFrames.all].filter((f) => f.isActive)).toEqual([]);
    await view.unmount();
  }, 120_000);
});
