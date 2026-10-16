// tests/native/clockCrossFade.test.tsx — the turn clocks across a hand-off (#1264): the outgoing
// fades out over 100 ms, then the incoming in over the next 100 ms, the viewer's count in the
// turn pill standing in for a seat's ring.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, render, within, type RenderResult } from '@testing-library/react-native';
import Animated, { getAnimatedStyle, useAnimatedStyle } from 'react-native-reanimated';

const mockReduceMotion = { on: false };
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduceMotion.on,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

// While held, every UI-to-JS report waits in `queue` until the test lets the hop land.
const mockHop: { held: boolean; queue: (() => void)[] } = { held: false, queue: [] };
jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as typeof import('react-native-worklets');
  return {
    ...actual,
    scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
      mockHop.held ? mockHop.queue.push(() => fn(...args)) : actual.scheduleOnRN(fn, ...args),
  };
});

import { useClockFade } from '@/components/table/useClockFade';
import { bootFeedback } from './helpers/feedback';
import { PAIR, tableAfter } from './helpers/landing';

const SEATS = { 1: 'side-seat-right', 2: 'top-seat', 3: 'side-seat-left' } as Record<number, string>;
const all = { includeHiddenElements: true };
const opacity = (el: Parameters<typeof getAnimatedStyle>[0]) => (getAnimatedStyle(el) as { opacity?: number }).opacity ?? 1;

/** Every clock on the table, by seat (0 is the viewer's count in the pill), with its opacity. */
const clocks = (view: RenderResult) => [
  ...Object.entries(SEATS).flatMap(([seat, id]) =>
    within(view.getByTestId(id)).queryAllByTestId('seat-turn-clock', all).map((el) => [Number(seat), opacity(el)] as const)
  ),
  ...view.queryAllByTestId('turn-chip-clock', all).map((el) => [0, opacity(el)] as const),
];

async function handOff(from: number, to: number) {
  const view = await render(tableAfter({ by: 0, combo: PAIR, turn: from, turnSeconds: 30 }));
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  expect(clocks(view)).toEqual([[from, 1]]);
  await act(async () => view.rerender(tableAfter({ by: 0, combo: PAIR, passCount: 1, turn: to, turnSeconds: 30 })));
  const seen: (readonly (readonly [number, number])[])[] = [];
  let arrived = -1;
  for (let f = 0; f < 120 && (arrived < 0 || performance.now() < arrived + 250); f++) {
    const now = clocks(view);
    seen.push(now);
    if (arrived < 0 && now.some(([seat]) => seat === to)) arrived = performance.now();
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
  }
  return { view, seen, end: clocks(view) };
}

describe('the turn clocks across a hand-off', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockReduceMotion.on = false;
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  for (const [from, to, what] of [[3, 2, 'seat to seat'], [1, 0, 'a seat to the viewer'], [0, 3, 'the viewer to a seat']] as const) {
    it(`fades out, then in, from ${what}: never two clocks drawn, never none there`, async () => {
      const { view, seen, end } = await handOff(from, to);
      for (const frame of seen) {
        expect(frame.length).toBeGreaterThan(0);
        expect(frame.filter(([, o]) => o > 0).length).toBeLessThanOrEqual(1);
      }
      const of = (seat: number) => seen.flatMap((frame, f) => frame.filter(([s]) => s === seat).map(([, o]) => [f, o] as const));
      const lastOut = Math.max(...of(from).filter(([, o]) => o > 0).map(([f]) => f));
      const firstIn = Math.min(...of(to).filter(([, o]) => o > 0).map(([f]) => f));
      expect(of(from).some(([, o]) => o > 0 && o < 1)).toBe(true);
      expect(of(to).some(([, o]) => o > 0 && o < 1)).toBe(true);
      expect(firstIn).toBeGreaterThan(lastOut);
      expect(end).toEqual([[to, 1]]);
      await view.unmount();
    });
  }

  it('swaps at once under reduced motion', async () => {
    mockReduceMotion.on = true;
    const { view, seen, end } = await handOff(3, 2);
    for (const frame of seen) expect(frame.map(([, o]) => o)).toEqual([1]);
    expect(end).toEqual([[2, 1]]);
    await view.unmount();
  });

  it('lets the old clock go when reduced motion turns on mid-fade', async () => {
    const view = await render(tableAfter({ by: 0, combo: PAIR, turn: 3, turnSeconds: 30 }));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    const next = tableAfter({ by: 0, combo: PAIR, passCount: 1, turn: 2, turnSeconds: 30 });
    await act(async () => view.rerender(next));
    await act(async () => {
      jest.advanceTimersByTime(48);
    });
    expect(clocks(view).filter(([seat, o]) => seat === 3 && o > 0 && o < 1)).toHaveLength(1);
    mockReduceMotion.on = true;
    await act(async () => view.rerender(tableAfter({ by: 0, combo: PAIR, passCount: 1, turn: 2, turnSeconds: 30 })));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(clocks(view)).toEqual([[2, 1]]);
    await view.unmount();
  });

  function Clock({ clock }: { clock: string | null }) {
    const { shown, opacity } = useClockFade(clock, (c) => c);
    const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
    return shown === null ? null : <Animated.View testID="clock" style={style} />;
  }

  for (const [firstFadeMs, onMs, what] of [[48, 0, 'cut short'], [150, 150, 'run out']] as const) {
    it(`a fade ${what} inside one UI-to-JS hop cannot end the fade after it: off, on, off`, async () => {
      const view = await render(<Clock clock="a" />);
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      mockHop.held = true;
      await act(async () => view.rerender(<Clock clock={null} />));
      await act(async () => {
        jest.advanceTimersByTime(firstFadeMs);
      });
      await act(async () => view.rerender(<Clock clock="a" />));
      await act(async () => {
        jest.advanceTimersByTime(onMs);
      });
      await act(async () => view.rerender(<Clock clock={null} />));
      expect(mockHop.queue.length).toBeGreaterThan(0);
      mockHop.held = false;
      await act(async () => mockHop.queue.splice(0).forEach((land) => land()));
      await act(async () => {
        jest.advanceTimersByTime(32);
      });
      const fading = view.queryByTestId('clock', all);
      expect(fading).not.toBeNull();
      expect(opacity(fading!)).toBeGreaterThan(0);
      expect(opacity(fading!)).toBeLessThan(1);
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(view.queryByTestId('clock', all)).toBeNull();
      await view.unmount();
    });
  }
});
