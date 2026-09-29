// tests/native/tapLiftOnUiThread.test.tsx — a tap lifts its card on the UI thread, before the JS
// thread has heard of it.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle, makeMutable } from 'react-native-reanimated';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import { Motion } from '@/lib/theme';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { handRowHeadroom } from '@/components/seatLayout';
import { gesturesOf, type Captured } from './tapHelpers';

const mockHeld: { on: boolean; queue: (() => void)[] } = { on: false, queue: [] };
jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as { scheduleOnRN: (...a: unknown[]) => void };
  return {
    ...actual,
    scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      if (mockHeld.on) mockHeld.queue.push(() => fn(...args));
      else actual.scheduleOnRN(fn, ...args);
    },
  };
});

const mockRow: { gesture: Parameters<typeof gesturesOf>[0] | null } = { gesture: null };
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler') as Record<string, unknown>;
  return {
    ...actual,
    GestureDetector: ({ gesture, children }: { gesture: { gestures?: { type: string }[] }; children: React.ReactNode }) => {
      if (gesture.gestures?.some((g) => g.type === 'TapGestureHandler')) mockRow.gesture = gesture as never;
      return children;
    },
  };
});

const mockReduce = { on: false };
jest.mock('@/lib/accessibility', () => ({
  ...(jest.requireActual('@/lib/accessibility') as object),
  usePrefersReducedMotion: () => mockReduce.on,
}));

const { GameTable } = require('@/components/GameTable') as typeof import('@/components/GameTable');
const { StraightHand } = require('@/components/table/hand') as typeof import('@/components/table/hand');

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const HAND = [card('3', 'spades'), card('7', 'hearts'), card('9', 'clubs')];
const SEVEN = HAND[1];
const seat = (id: string, hand: Card[]): Player => ({ id, name: id, hand, type: 'human' });
const state: GameState = {
  players: [seat('player_0', HAND), seat('player_1', [card('K', 'spades')])],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};
const noop = () => {};

const step = async (ms: number) => {
  for (let at = 0; at < ms; at += 16) await act(async () => jest.advanceTimersByTime(16));
};
const wrapper = (c: Card) => screen.getByTestId(`hand-card-${c.id}`);
const lift = (c: Card) => {
  const { transform } = getAnimatedStyle(wrapper(c)) as unknown as { transform: Record<string, number | string>[] };
  return { y: transform[1].translateY as number, rot: parseFloat(transform[2].rotate as string) };
};
const selected = (c: Card) => screen.getByLabelText(cardSpokenName(c, t)).props.accessibilityState?.selected === true;
const onStrip = (c: Card) => ({ x: (StyleSheet.flatten(wrapper(c).props.style) as { left: number }).left + 2, y: 10 });
const call = (g: Captured, name: string, e: unknown) => (g.config[name] as (e: unknown, ok?: boolean) => void)(e, true);

async function tapOn(c: Card, between?: () => Promise<void>) {
  const { tap } = gesturesOf(mockRow.gesture!);
  const at = onStrip(c);
  await act(async () => call(tap, 'onBegin', at));
  await between?.();
  await act(async () => {
    call(tap, 'onActivate', at);
    call(tap, 'onFinalize', at);
  });
  await step(16);
}

async function mountTable() {
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable gameState={state} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
    </SafeAreaProvider>
  );
  await step(3000);
  return view;
}

describe('a tap on the hand', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockHeld.on = false;
    mockHeld.queue.length = 0;
    mockReduce.on = false;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is the row tap, simultaneous with the reorder, which travel fails and no length of press does', async () => {
    const view = await mountTable();
    const gesture = mockRow.gesture as unknown as { type: string };
    expect(gesture.type).toBe('SimultaneousGesture');
    const { tap } = gesturesOf(mockRow.gesture!);
    expect(tap.config.maxDist).toBe(10);
    expect(tap.config.maxDurationMs).toBe(2 ** 31 - 1);
    await view.unmount();
  });

  it('lifts its card within 300 ms with every hop to JS held back, and reports it selected only once they run', async () => {
    const view = await mountTable();
    const rest = lift(SEVEN);
    const headroom = handRowHeadroom(StyleSheet.flatten(wrapper(SEVEN).props.style).height as number);
    mockHeld.on = true;
    await tapOn(SEVEN);
    await step(300);

    expect(rest.y - lift(SEVEN).y).toBeGreaterThan(headroom * 0.8);
    expect(lift(SEVEN).rot).toBeLessThan(rest.rot - 2);
    expect(selected(SEVEN)).toBe(false);
    expect(mockHeld.queue).toHaveLength(1);

    mockHeld.on = false;
    await act(async () => mockHeld.queue.splice(0).forEach((run) => run()));
    expect(selected(SEVEN)).toBe(true);
    await view.unmount();
  });

  it('rises by timing under reduced motion, without the tilt', async () => {
    mockReduce.on = true;
    const view = await mountTable();
    const rest = lift(SEVEN);
    const headroom = handRowHeadroom(StyleSheet.flatten(wrapper(SEVEN).props.style).height as number);
    await tapOn(SEVEN);
    await step(Motion.duration.tap + 32);
    expect(rest.y - lift(SEVEN).y).toBeCloseTo(headroom, 3);
    expect(lift(SEVEN).rot).toBeCloseTo(rest.rot, 5);
    expect(selected(SEVEN)).toBe(true);
    await view.unmount();
  });

  it('acknowledges the finger on the card under it, and a second tap drops the card', async () => {
    const view = await mountTable();
    const rest = lift(SEVEN);
    await tapOn(SEVEN, async () => {
      await step(400);
      expect(rest.y - lift(SEVEN).y).toBeCloseTo(3, 0);
      expect(rest.rot - lift(SEVEN).rot).toBeCloseTo(1.5, 0);
    });
    expect(selected(SEVEN)).toBe(true);
    await tapOn(SEVEN);
    await step(1500);
    expect(selected(SEVEN)).toBe(false);
    expect(lift(SEVEN).y).toBeCloseTo(rest.y, 1);
    await view.unmount();
  });

  it('is still a press held long past the hold, and not one once the hold travels into a drag', async () => {
    const view = await mountTable();
    await tapOn(SEVEN, () => step(2000));
    expect(selected(SEVEN)).toBe(true);

    const { pan, tap } = gesturesOf(mockRow.gesture!);
    (globalThis as { _setGestureStateSync?: () => void })._setGestureStateSync = () => {};
    const at = onStrip(HAND[0]);
    const touch = (x: number) => ({ handlerTag: 1, allTouches: [{ x, y: at.y }] });
    await act(async () => {
      call(pan, 'onTouchesDown', touch(at.x));
      call(tap, 'onBegin', at);
    });
    await step(600);
    await act(async () => {
      call(pan, 'onTouchesMove', touch(at.x + 30));
      call(tap, 'onActivate', at);
      call(tap, 'onFinalize', at);
    });
    expect(selected(HAND[0])).toBe(false);
    await view.unmount();
  });
});

describe('in the exchange', () => {
  it('a card that cannot be given ignores the tap, and one that can takes it', async () => {
    const tap = jest.fn();
    const view = await render(
      <StraightHand
        cards={HAND}
        selectedIds={[]}
        selection={{ shown: makeMutable<string[]>([]), tap }}
        onActivate={noop}
        disabled={false}
        availW={600}
        roomW={456}
        giveableIds={[SEVEN.id]}
        giveHint="give"
        refuseHint="refuse"
      />
    );
    const g = gesturesOf(mockRow.gesture!).tap;
    for (const c of [HAND[0], SEVEN]) {
      await act(async () => {
        call(g, 'onBegin', onStrip(c));
        call(g, 'onActivate', onStrip(c));
        call(g, 'onFinalize', onStrip(c));
      });
    }
    expect(tap.mock.calls).toEqual([[SEVEN.id]]);
    await view.unmount();
  });
});
