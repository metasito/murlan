// tests/native/oneEventPerCommit.test.tsx — a throw's commit sends its sounds as one event per
// anchor, at the flight's own reported times: the landing at contact, the turn at the hand-off.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, render, renderHook } from '@testing-library/react-native';

const mockDiag = jest.fn();
jest.mock('@/lib/diagnostics', () => ({
  ...(jest.requireActual('@/lib/diagnostics') as object),
  DIAGNOSTICS: true,
  diag: (...args: unknown[]) => mockDiag(...args),
}));

import { useTableTimeline } from '@/components/table/tableTimeline';
import { Hold } from '@/lib/tokens';
import type { Combination } from '@/lib/game/gameEngine';
import { bootFeedback, ctxAt, startsOf } from './helpers/feedback';
import { card, farthest, frameOfFirst, PAIR, tableAfter, throwPair } from './helpers/landing';

const FRAME_S = 0.017;
const BOMB: Combination = {
  type: 'bomb',
  cards: (['clubs', 'diamonds', 'hearts', 'spades'] as const).map((s) => card(`9${s}`, '9', s)),
  strength: 9,
};

describe('one event per anchor, at the flight’s own times', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sounds the landing at contact and the turn at the rest frame plus the hold, two calls', async () => {
    const view = await throwPair();
    expect(startsOf('combo')).toEqual([]);
    expect(startsOf('turn')).toEqual([]);
    const { frame, drawn, now } = await frameOfFirst(view, () => farthest(view) === 0);
    const contact = drawn.findIndex((d) => d <= 1);
    expect(startsOf('combo')).toHaveLength(1);
    expect(Math.abs(startsOf('combo')[0] - ctxAt(now[contact]))).toBeLessThanOrEqual(FRAME_S);
    expect(startsOf('turn')).toHaveLength(1);
    expect(Math.abs(startsOf('turn')[0] - ctxAt(now[frame] + Hold.land))).toBeLessThanOrEqual(FRAME_S);
    await view.unmount();
  });

  it('sounds a later commit’s pass now', async () => {
    const view = await throwPair();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    const at = performance.now();
    await act(async () => view.rerender(tableAfter({ by: 3, combo: PAIR, passCount: 1 })));
    expect(startsOf('pass')).toEqual([expect.closeTo(ctxAt(at), 2)]);
    await view.unmount();
  });

  it('lets a bomb’s landing choose the bomb’s sound', async () => {
    const view = await render(tableAfter({ by: 3, combo: BOMB }));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(startsOf('bomb')).toHaveLength(1);
    await view.unmount();
  });
});

describe('a landing the JS side reports late', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  async function reportedLate(byMs: number) {
    const { result, unmount } = await renderHook(() => useTableTimeline());
    await act(async () => {
      result.current.awaitFlight('k');
      result.current.moment({ kind: 'landing', cards: 2, bomb: false, mine: false });
      result.current.flush();
    });
    const reported = performance.now();
    await act(async () => result.current.flightStarted('k', reported - byMs, reported + 100));
    await unmount();
    return reported;
  }

  it('20 ms late still sounds, now', async () => {
    const now = await reportedLate(20);
    expect(startsOf('combo')).toEqual([expect.closeTo(ctxAt(now), 2)]);
  });

  it('100 ms late is dropped, and recorded', async () => {
    await reportedLate(100);
    expect(startsOf('combo')).toEqual([]);
    expect(mockDiag).toHaveBeenCalledWith(expect.objectContaining({ k: 'dropped', name: 'landing' }));
  });
});
