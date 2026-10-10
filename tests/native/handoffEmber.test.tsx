// tests/native/handoffEmber.test.tsx — the turn hand-off's ember along the rim (#1264).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, render, type RenderResult } from '@testing-library/react-native';

const mockReduceMotion = { on: false };
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduceMotion.on,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));
jest.mock('@/components/table/ember', () => {
  const actual = jest.requireActual<typeof import('@/components/table/ember')>('@/components/table/ember');
  return { ...actual, emberFrame: jest.fn(actual.emberFrame) };
});

import { emberFrame, RIM } from '@/components/table/ember';
import { Ember } from '@/lib/tokens';
import { bootFeedback } from './helpers/feedback';
import { PAIR, tableAfter } from './helpers/landing';

type Spawns = ReturnType<typeof emberFrame>;
const heads = () =>
  jest.mocked(emberFrame).mock.results.flatMap((r) => (r.value as Spawns).filter((p) => p.col === Ember.head));
const angle = (p: { x: number; y: number }) => (Math.atan2((p.y - RIM.cy) / RIM.ry, (p.x - RIM.cx) / RIM.rx) * 180) / Math.PI;

async function frames(ms: number) {
  for (let t = 0; t < ms; t += 16) {
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
  }
}

async function settledOn(turn: number): Promise<RenderResult> {
  const view = await render(tableAfter({ by: 0, combo: PAIR, turn }));
  await frames(1500);
  jest.mocked(emberFrame).mockClear();
  return view;
}

describe('the hand-off ember', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockReduceMotion.on = false;
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs the rim from the outgoing seat to the next, and a second hand-off cuts the first short', async () => {
    const view = await settledOn(3);
    await act(async () => view.rerender(tableAfter({ by: 0, combo: PAIR, passCount: 1, turn: 2 })));
    await frames(100);
    await act(async () => view.rerender(tableAfter({ by: 0, combo: PAIR, passCount: 2, turn: 1 })));
    await frames(600);

    const all = heads().map(angle);
    const split = all.findIndex((a) => a >= -90);
    expect(split).toBeGreaterThan(2);
    expect(Math.min(...all.slice(0, split))).toBeCloseTo(-180, 0);
    expect(Math.max(...all.slice(0, split))).toBeLessThan(-150);
    expect(Math.min(...all.slice(split))).toBeCloseTo(-90, 0);
    expect(all.at(-1)).toBeCloseTo(0, 5);
    expect(all.filter((a, i) => i > 0 && a < all[i - 1])).toEqual([]);
    await view.unmount();
  });

  it('throws none under reduced motion', async () => {
    mockReduceMotion.on = true;
    const view = await settledOn(3);
    await act(async () => view.rerender(tableAfter({ by: 0, combo: PAIR, passCount: 1, turn: 2 })));
    await frames(600);
    expect(heads()).toEqual([]);
    await view.unmount();
  });
});
