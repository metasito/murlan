import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render } from '@testing-library/react-native';

let mockReduce = false;
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduce,
  setMotionPreference: () => {},
  getMotionPreference: () => (mockReduce ? 'on' : 'off'),
}));

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

import { handDealArc } from '@/components/table/dealPose';
import { lampControls, restingLamp } from '@/components/table/lampRig';
import { dealSpecks } from '@/components/table/particles';
import { along, breath, frame, handPoses, table } from './helpers/dealTable';
import { bootFeedback } from './helpers/feedback';

describe("the viewer's hand is dealt with the felt's breath, the lamp's rise and specks", () => {
  beforeEach(async () => {
    mockReduce = false;
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
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

  it('lays the hand in place and lights the lamp when reduced motion comes on mid-deal', async () => {
    const r = await render(table());
    for (let t = 0; t < 400; t += 16) await frame();
    expect(handPoses().some((p) => p.opacity !== 1)).toBe(true);
    const levels = () => jest.mocked(lampControls.setLevel).mock.calls.map((c) => c[1]);
    expect(levels()).toEqual([0.75]);
    mockReduce = true;
    await r.rerender(table());
    for (let t = 0; t < 400; t += 16) await frame();
    expect(handPoses().map((p) => [p.opacity, along(p, 'scale')])).toEqual(Array(13).fill([1, 1]));
    const [lamp, to] = jest.mocked(lampControls.setLevel).mock.calls.at(-1)!;
    expect([to, lamp.lvl]).toEqual([1, 1]);
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
