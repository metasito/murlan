// tests/native/shadowClusterBuilds.test.tsx — a card flight rebuilds only the shadow clusters a moving card belongs to (#1428).
import { describe, it, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';

import type { CardRects } from '@/components/table/cardRects';
import { shadowShape } from '@/components/table/cardShadows';
import { frames } from './helpers/exchangeLegs';
import { throwPair } from './helpers/landing';
import { bootFeedback } from './helpers/feedback';

jest.mock('@/components/table/cardShadows', () => jest.requireActual('@/components/table/cardShadows'));

const e2e = globalThis as { murlanCardRects?: () => CardRects; murlanShadowClusterBuilds?: Record<string, number> };

beforeAll(() => {
  process.env.EXPO_PUBLIC_E2E_FAST = '1';
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_E2E_FAST;
});
beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
  delete e2e.murlanShadowClusterBuilds;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the felt during a bot throw', () => {
  it('rebuilds a cluster each frame a card in it moves, and one holding no moving card at most once', async () => {
    const shapes = new Map<string, string>();
    const moving = new Set<string>();
    let moves = 0;
    const sample = () => {
      const rects = e2e.murlanCardRects?.() ?? {};
      let moved = false;
      for (const key of Object.keys(rects)) {
        const shape = shadowShape({ [key]: rects[key] });
        if (shapes.has(key) && shapes.get(key) !== shape) moving.add(key), (moved = true);
        shapes.set(key, shape);
      }
      if (moved) moves++;
    };
    const view = await throwPair(3);
    await frames(2000, sample);

    const builds = Object.entries(e2e.murlanShadowClusterBuilds ?? {});
    const still = builds.filter(([cluster]) => cluster.split('|')[1].split(',').every((key) => !moving.has(key)));
    const movedFaces = builds.filter(([cluster]) => cluster.startsWith('face|') && !still.some(([c]) => c === cluster));
    expect(moves).toBeGreaterThan(0);
    expect(still.length).toBeGreaterThan(0);
    expect(movedFaces.reduce((sum, [, n]) => sum + n, 0)).toBeGreaterThanOrEqual(moves);
    expect(still.filter(([, n]) => n > 1)).toEqual([]);
    await view.unmount();
  }, 120_000);
});
