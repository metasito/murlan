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
import { setMotionPreference } from '@/lib/accessibility';
import { bootFeedback, sounds } from './helpers/feedback';
import { choiceOpensAt } from '@/lib/game/exchangeTimeline';
import { activate, gesturesOf, storeOf, type Captured } from './tapHelpers';

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
jest.mock('@/lib/accessibility', () => {
  const actual = jest.requireActual('@/lib/accessibility') as typeof import('@/lib/accessibility');
  return { ...actual, usePrefersReducedMotion: () => actual.usePrefersReducedMotion() || mockReduce.on };
});

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
const box = (c: Card) => StyleSheet.flatten(wrapper(c).props.style) as { left: number; bottom: number; height: number };
const rowH = () => StyleSheet.flatten(screen.getByTestId('hand-row').props.style).height as number;
const onStrip = (c: Card) => ({ x: box(c).left + 2, y: rowH() - box(c).bottom - 1 });
const aboveTop = (c: Card) => ({ x: box(c).left + 2, y: rowH() - box(c).bottom - box(c).height - 1 });
const call = (g: Captured, name: string, e: unknown) => (g.config[name] as (e: unknown, ok?: boolean) => void)(e, true);

async function tapOn(c: Card, between?: () => Promise<void>, at = onStrip(c)) {
  const { tap } = gesturesOf(mockRow.gesture!);
  await act(async () => call(tap, 'onBegin', at));
  await between?.();
  await act(async () => {
    call(tap, 'onActivate', at);
    call(tap, 'onFinalize', at);
  });
  await step(16);
}

const table = (s: GameState, spectating = false) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable gameState={s} viewerSeat={0} spectating={spectating} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
  </SafeAreaProvider>
);

async function mountTable(s = state, settleMs = 3000) {
  const view = await render(table(s));
  await step(settleMs);
  return view;
}

const releaseHops = async () => {
  mockHeld.on = false;
  await act(async () => mockHeld.queue.splice(0).forEach((run) => run()));
  await step(1500);
};
const priorSync = (globalThis as { _setGestureStateSync?: unknown })._setGestureStateSync;

describe('a tap on the hand', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockHeld.on = false;
    mockHeld.queue.length = 0;
    mockReduce.on = false;
  });
  afterEach(() => {
    jest.useRealTimers();
    (globalThis as { _setGestureStateSync?: unknown })._setGestureStateSync = priorSync;
    setMotionPreference('system');
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

  it("is still a press held long past the hold, and not one once a drag picks the card (the tap's own maxDistance is pinned as config only)", async () => {
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

  it('keeps a selected card at the lift and tilt of the moment when its turn resizes it or motion is reduced', async () => {
    const view = await mountTable();
    const rest = lift(SEVEN);
    await tapOn(SEVEN);
    await step(1500);
    const before = box(SEVEN).height;
    await view.rerender(table({ ...state, currentTurnIndex: 0 }));
    await step(1500);
    expect(box(SEVEN).height).toBeGreaterThan(before);
    expect(lift(SEVEN).y).toBeCloseTo(-handRowHeadroom(box(SEVEN).height), 1);

    await act(async () => setMotionPreference('on'));
    await step(Motion.duration.tap + 32);
    expect(lift(SEVEN).rot).toBeCloseTo(rest.rot, 5);
    await view.unmount();
  });

  it('re-bases a tap on the store when it reaches JS, so a write that landed in between is kept on both threads', async () => {
    const view = await mountTable();
    const rests = HAND.map((c) => lift(c).y);
    mockHeld.on = true;
    await tapOn(SEVEN);
    await activate(screen.getByLabelText(cardSpokenName(HAND[0], t)));
    await releaseHops();
    HAND.forEach((c, i) => expect(lift(c).y < rests[i] - 1).toBe(selected(c)));
    expect(selected(SEVEN)).toBe(true);
    await view.unmount();
  });

  it('selects nothing from the felt above a card, nor from a card lifted out of the row', async () => {
    const view = await mountTable();
    await tapOn(SEVEN, undefined, aboveTop(SEVEN));
    await step(500);
    expect(selected(SEVEN)).toBe(false);
    await view.unmount();

    const lifted = makeMutable<string[]>([SEVEN.id]);
    const tap = jest.fn();
    const alone = await render(
      <StraightHand cards={HAND} store={storeOf()} selection={{ shown: makeMutable<string[]>([]), tap }} onActivate={noop}
        disabled={false} availW={600} roomW={456} lifted={lifted} />
    );
    await tapOn(SEVEN);
    expect(tap).not.toHaveBeenCalled();
    await alone.unmount();
  });

  it.each([
    ['the manche ends for this seat', (view: Awaited<ReturnType<typeof mountTable>>) =>
      view.rerender(table({ ...state, players: [{ ...state.players[0], finishPosition: 1 }, state.players[1]] }))],
    ['the seat turns spectator', (view: Awaited<ReturnType<typeof mountTable>>) => view.rerender(table(state, true))],
  ])('drops a tap still on its way to JS when %s', async (_, close) => {
    await bootFeedback();
    const view = await mountTable();
    mockHeld.on = true;
    await tapOn(SEVEN);
    await close(view);
    await releaseHops();
    expect(sounds()).not.toContain('select');
    await view.unmount();
  });

  it('takes no tap in the exchange before the choice opens', async () => {
    const exchange: GameState = {
      ...state,
      currentTurnIndex: 0,
      exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card('2', 'spades'), bothJokersException: false },
    };
    const view = await mountTable(exchange, choiceOpensAt(false) - 400);
    const rest = lift(SEVEN).y;
    await tapOn(SEVEN);
    await step(300);
    expect(selected(SEVEN)).toBe(false);
    expect(lift(SEVEN).y).toBeCloseTo(rest, 1);
    await view.unmount();
  });
});

describe('in the exchange', () => {
  it('a card that cannot be given ignores the tap, and one that can takes it', async () => {
    const tap = jest.fn();
    const view = await render(
      <StraightHand
        cards={HAND}
        store={storeOf()}
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

describe('the drag and the tap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    (globalThis as { _setGestureStateSync?: unknown })._setGestureStateSync = priorSync;
  });

  it('pick the same card at every edge of every strip', async () => {
    (globalThis as { _setGestureStateSync?: () => void })._setGestureStateSync = () => {};
    const mount = (tap: (id: string) => void) =>
      render(
        <StraightHand cards={HAND} store={storeOf()} selection={{ shown: makeMutable<string[]>([]), tap }}
          onActivate={noop} onReorder={noop} disabled={false} availW={600} roomW={456} />
      );
    const probe = await mount(noop);
    const lefts = HAND.map((c) => box(c).left);
    const y = rowH() - 1;
    await probe.unmount();
    const xs = lefts.flatMap((l, i) => [l - 1, l + 1, (lefts[i + 1] ?? l + 40) - 1]);
    const seen = new Set<string | undefined>();
    for (const x of xs) {
      const tap = jest.fn<(id: string) => void>();
      const view = await mount(tap);
      const g = gesturesOf(mockRow.gesture!);
      await act(async () => {
        call(g.tap, 'onBegin', { x, y });
        call(g.tap, 'onActivate', { x, y });
        call(g.tap, 'onFinalize', { x, y });
      });
      const touch = (at: number) => ({ handlerTag: 1, allTouches: [{ x: at, y }] });
      await act(async () => call(g.pan, 'onTouchesDown', touch(x)));
      await step(600);
      await act(async () => call(g.pan, 'onTouchesMove', touch(x + 30)));
      await step(16);
      const picked = HAND.find((c) => screen.queryByTestId(`hand-card-${c.id}`) === null)?.id;
      expect([x, picked]).toEqual([x, tap.mock.calls[0]?.[0]]);
      seen.add(picked);
      await view.unmount();
    }
    expect(seen).toEqual(new Set([undefined, ...HAND.map((c) => c.id)]));
  });
});

describe('a tap on a rotated card', () => {
  const RANKS: Card['rank'][] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const WIDE = RANKS.map((r) => card(r, 'diamonds'));
  const LAST = WIDE[WIDE.length - 1];
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** The row point at (u, v) from the card's own centre, turned with the card as it is drawn. */
  const onCard = (c: Card, u: number, v: number) => {
    const { transform } = getAnimatedStyle(wrapper(c)) as unknown as { transform: Record<string, number | string>[] };
    const b = StyleSheet.flatten(wrapper(c).props.style) as { left: number; bottom: number; width: number; height: number };
    const rad = (parseFloat(transform[2].rotate as string) * Math.PI) / 180;
    const cx = b.left + (transform[0].translateX as number) + b.width / 2;
    const cy = rowH() - b.bottom - b.height / 2 + (transform[1].translateY as number);
    const at = { x: cx + u * Math.cos(rad) - v * Math.sin(rad), y: cy + u * Math.sin(rad) + v * Math.cos(rad) };
    return { at, flatTop: cy - b.height / 2, w: b.width, h: b.height };
  };

  async function tapsAt(shown: string[], pick: () => { x: number; y: number }) {
    const tap = jest.fn<(id: string) => void>();
    const view = await render(
      <StraightHand cards={WIDE} store={storeOf(shown)} selection={{ shown: makeMutable(shown), tap }}
        onActivate={noop} disabled={false} availW={600} roomW={456} />
    );
    await step(1500);
    const at = pick();
    const g = gesturesOf(mockRow.gesture!).tap;
    await act(async () => {
      call(g, 'onBegin', at);
      call(g, 'onActivate', at);
      call(g, 'onFinalize', at);
    });
    await view.unmount();
    return tap.mock.calls.map((c) => c[0]);
  }

  it('takes the raised top-left corner of a card right of centre, above where an unturned card would end', async () => {
    const c = WIDE[9];
    let raised = false;
    const picked = await tapsAt([], () => {
      const probe = onCard(c, 0, 0);
      const corner = onCard(c, -probe.w / 2 + 1, -probe.h / 2 + 0.5);
      raised = corner.at.y < corner.flatTop;
      return corner.at;
    });
    expect(raised).toBe(true);
    expect(picked).toEqual([c.id]);
  });

  it('takes the raised top corner of the selected end card, turned by its tilt as well as the arc', async () => {
    let raised = false;
    const picked = await tapsAt([LAST.id], () => {
      const probe = onCard(LAST, 0, 0);
      const rot = parseFloat((getAnimatedStyle(wrapper(LAST)) as unknown as { transform: { rotate: string }[] }).transform[2].rotate);
      const corner = onCard(LAST, rot > 0 ? -probe.w / 2 + 1 : probe.w / 2 - 1, -probe.h / 2 + 0.5);
      raised = corner.at.y < corner.flatTop;
      return corner.at;
    });
    expect(raised).toBe(true);
    expect(picked).toEqual([LAST.id]);
  });

  it('refuses a finger just above the turned edge', async () => {
    const c = WIDE[9];
    const picked = await tapsAt([], () => {
      const probe = onCard(c, 0, 0);
      return onCard(c, -probe.w / 2 + 1, -probe.h / 2 - 1).at;
    });
    expect(picked).toEqual([]);
  });
});
