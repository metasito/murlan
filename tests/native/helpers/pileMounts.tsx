import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, type RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { FrameCallback } from 'react-native-reanimated';
import type { FlightClock } from '@/components/table/useFlightClock';

const mounts: { id: string; kind: 'mount' | 'unmount'; at: number }[] = [];
const begins: string[] = [];
const frames = { capturing: false, all: new Set<FrameCallback>() };

export function cardViewModule() {
  const actual = jest.requireActual<typeof import('@/components/CardView')>('@/components/CardView');
  const { useEffect, useState } = jest.requireActual<typeof import('react')>('react');
  function Logged(props: React.ComponentProps<typeof actual.CardView>) {
    const [id] = useState(props.testID === 'pile-card' ? props.card.id : null);
    useEffect(() => {
      if (id === null) return;
      mounts.push({ id, kind: 'mount', at: performance.now() });
      return () => void mounts.push({ id, kind: 'unmount', at: performance.now() });
    }, [id]);
    return <actual.CardView {...props} />;
  }
  return { ...actual, CardView: Logged };
}

export function reanimatedModule() {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    useFrameCallback: (cb: Parameters<typeof actual.useFrameCallback>[0], auto?: boolean) => {
      const callback = actual.useFrameCallback(cb, auto);
      if (frames.capturing) frames.all.add(callback);
      return callback;
    },
  };
}

export function flightClockModule() {
  const actual = jest.requireActual<typeof import('@/components/table/useFlightClock')>('@/components/table/useFlightClock');
  const wrapped = new WeakMap<FlightClock, FlightClock>();
  return {
    ...actual,
    useFlightClock: (...args: Parameters<typeof actual.useFlightClock>) => {
      frames.capturing = true;
      const clock = actual.useFlightClock(...args);
      frames.capturing = false;
      if (!wrapped.has(clock)) wrapped.set(clock, { ...clock, begin: (spec) => (begins.push(spec.key), clock.begin(spec)) });
      return wrapped.get(clock)!;
    },
  };
}

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};
const HOLD_MS = 1800;
const OVERLAPPING = 2;
const outOfSight = (n: TestInstance | null): boolean => !!n && (StyleSheet.flatten(n.props.style)?.display === 'none' || outOfSight(n.parent));
const fliers = (view: RenderResult) => view.queryAllByTestId('flying-cards', { includeHiddenElements: true });

/** The pile-mounting scenario under one motion preference; the calling file mocks the three modules above with the factories here. */
export function fourTricks(name: string, preference: 'on' | 'off') {
  const { GameTable } = require('@/components/GameTable') as typeof import('@/components/GameTable');
  const { comboKey } = require('@/components/flightPhysics') as typeof import('@/components/flightPhysics');
  const { initializeGame } = require('@/lib/game/gameEngine') as typeof import('@/lib/game/gameEngine');
  const { offlineBotMove } = require('@/lib/game/autoMove') as typeof import('@/lib/game/autoMove');
  const { setMotionPreference } = require('@/lib/accessibility') as typeof import('@/lib/accessibility');
  const { bootFeedback, settle } = require('./feedback') as typeof import('./feedback');
  type GameState = import('@/lib/game/gameEngine').GameState;

  const table = (s: GameState) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable gameState={s} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} handScores={{}} />
    </SafeAreaProvider>
  );

  describe(`four tricks under ${name} motion`, () => {
    beforeEach(async () => {
      mounts.length = 0;
      begins.length = 0;
      frames.all.clear();
      jest.useFakeTimers();
      await bootFeedback();
      await act(async () => setMotionPreference(preference));
    });
    afterEach(async () => {
      await act(async () => setMotionPreference('system'));
      jest.useRealTimers();
    });

    it('draws each played card with one view from its throw until its trick is swept', async () => {
      let state = initializeGame(['A', 'B', 'C', 'D'].map((n) => ({ name: n, type: 'ai' as const })), 'free_for_all');
      const view = await render(table(state));
      await settle(1100);
      const plays: string[] = [];
      const sweptFrom = new Map<string, number>();
      let round: string[] = [];
      let closedAt: number | null = null;
      let closed = 0;
      let unseen = 0;
      let inAir = 0;
      while (closed < 4 || closedAt !== null || (preference === 'off' && inAir < 3)) {
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
        inAir = Math.max(inAir, fliers(view).length);
        unseen += fliers(view).filter(outOfSight).length;
        await settle(closed >= OVERLAPPING ? 60 : 1500);
      }
      await settle(3000);

      expect(closed).toBeGreaterThanOrEqual(4);
      expect(unseen).toBe(0);
      if (preference === 'off') expect(inAir).toBeGreaterThanOrEqual(3);
      const played = new Set(mounts.map((m) => m.id));
      expect(played.size).toBeGreaterThan(4);
      for (const id of played) {
        const mine = mounts.filter((m) => m.id === id);
        expect(mine.filter((m) => m.kind === 'mount')).toHaveLength(1);
        const gone = mine.find((m) => m.kind === 'unmount');
        if (sweptFrom.has(id)) expect(gone?.at).toBeGreaterThanOrEqual(sweptFrom.get(id)!);
        else expect(gone).toBeUndefined();
      }
      expect([...sweptFrom.keys()].every((id) => played.has(id))).toBe(true);
      expect(begins.slice().sort()).toEqual(plays.slice().sort());
      expect(frames.all.size).toBeGreaterThan(4);
      expect([...frames.all].filter((f) => f.isActive && f.callbackId !== -1)).toEqual([]);
      await view.unmount();
    }, 120_000);
  });
}
