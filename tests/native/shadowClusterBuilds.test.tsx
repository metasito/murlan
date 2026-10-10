// tests/native/shadowClusterBuilds.test.tsx — a card flight rebuilds only the shadow clusters a moving card belongs to (#1428).
import { describe, it, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import type { CardRect, CardRects } from '@/components/table/cardRects';
import { TABLE_AT_REST } from '@/components/table/cardRects';
import { shadowShape } from '@/components/table/cardShadows';
import { FeltCanvas } from '@/components/table/feltCanvas';
import { TABLE_CENTRE, restingLamp } from '@/components/table/lampRig';
import type { CardTable } from '@/components/table/useCardRects';
import { FeltGradient } from '@/lib/tokens';
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
  it('rebuilds every cluster a moving card is in, of every kind, each frame it moves, and one holding no moving card at most once', async () => {
    const shapes = new Map<string, string>();
    const moves = new Map<string, number>();
    const sample = () => {
      const rects = e2e.murlanCardRects?.() ?? {};
      for (const key of Object.keys(rects)) {
        const shape = shadowShape({ [key]: rects[key] });
        if (shapes.has(key) && shapes.get(key) !== shape) moves.set(key, (moves.get(key) ?? 0) + 1);
        shapes.set(key, shape);
      }
    };
    const view = await throwPair(3);
    await frames(2000, sample);

    const builds = Object.entries(e2e.murlanShadowClusterBuilds ?? {});
    const still = builds.filter(([cluster]) => cluster.split('|')[1].split(',').every((key) => !moves.has(key)));
    const movedIn = new Map<string, number>();
    for (const [cluster, n] of builds) {
      const [kind, members] = cluster.split('|');
      for (const key of members.split(',')) if (moves.has(key)) movedIn.set(`${kind}|${key}`, (movedIn.get(`${kind}|${key}`) ?? 0) + n);
    }
    const kinds = new Set([...movedIn.keys()].map((at) => at.split('|')[0]));
    expect(still.length).toBeGreaterThan(0);
    expect(kinds.size).toBeGreaterThan(1);
    expect([...movedIn].filter(([at, n]) => n < moves.get(at.split('|')[1])!)).toEqual([]);
    expect(still.filter(([, n]) => n > 1)).toEqual([]);
    await view.unmount();
  }, 120_000);
});

describe('the felt on a resize', () => {
  const rect = (over: Partial<CardRect> = {}): CardRect => ({ x: 200, y: 200, w: 64, h: 90, rot: 0, back: false, lift: 0, glow: 0, seen: 1, ...over });

  it('rebuilds every cluster when the felt scale or the hand centre changes and no card moves', async () => {
    const rects = makeMutable<CardRects>({ 'pile:a': rect(), 'pile:b': rect({ x: 600 }), 'fan:top:0': rect({ x: 400, y: 60, back: true }) });
    const at = { x: 0, y: 0 };
    const table = (sx: number, handX: number) =>
      ({ rects, felt: { sx, sy: 1, s: 1, kickAt: at, shakeAt: at }, motion: makeMutable(TABLE_AT_REST), pile: at, hand: { x: handX, y: 0 }, seats: {} }) as unknown as CardTable;
    const felt = (sx: number, handX: number) => (
      <FeltCanvas lamp={makeMutable(restingLamp(TABLE_CENTRE))} sx={1} sy={1} stops={FeltGradient} cards={table(sx, handX)} />
    );
    const counts = () => Object.values(e2e.murlanShadowClusterBuilds ?? {});

    const view = await render(felt(1, 0));
    await frames(48);
    expect(counts().length).toBeGreaterThan(1);
    expect(counts()).toEqual(counts().map(() => 1));
    await view.rerender(felt(1.1, 0));
    await frames(48);
    expect(counts()).toEqual(counts().map(() => 2));
    await view.rerender(felt(1.1, 30));
    await frames(48);
    expect(counts()).toEqual(counts().map(() => 3));
    await view.unmount();
  });
});
